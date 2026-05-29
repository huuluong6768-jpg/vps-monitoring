import { Client as SSHClient } from 'ssh2';
import { connectDB, DirectCloneJob } from '@vps-monitoring/shared';
import type { IDirectCloneJob } from '@vps-monitoring/shared';
import { Types } from 'mongoose';

interface DirectCloneJobDoc extends IDirectCloneJob {
  _id: Types.ObjectId;
  save(): Promise<void>;
}

function appendLog(job: DirectCloneJobDoc, msg: string) {
  job.logs.push(`[${new Date().toISOString()}] ${msg}`);
}

function connectSSH(opts: {
  ip: string; port: number; username: string;
  sshPrivateKey?: string; password?: string;
}): Promise<SSHClient> {
  return new Promise((resolve, reject) => {
    const conn = new SSHClient();
    const config: Record<string, unknown> = {
      host: opts.ip,
      port: opts.port,
      username: opts.username,
      readyTimeout: 30000,
    };
    if (opts.sshPrivateKey) {
      config.privateKey = opts.sshPrivateKey;
    } else if (opts.password) {
      config.password = opts.password;
    }
    conn.on('ready', () => resolve(conn));
    conn.on('error', (err: Error) => reject(err));
    conn.connect(config);
  });
}

function execSSH(conn: SSHClient, cmd: string, timeoutMs = 600000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Command timed out after ${timeoutMs / 1000}s`)), timeoutMs);
    conn.exec(cmd, (err, stream) => {
      if (err) { clearTimeout(timer); return reject(err); }
      let stdout = '';
      let stderr = '';
      stream.on('data', (data: Buffer) => { stdout += data.toString(); });
      stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
      stream.on('close', (code: number) => {
        clearTimeout(timer);
        resolve({ code: code ?? 0, stdout, stderr });
      });
    });
  });
}

async function processDirectCloneJob(job: DirectCloneJobDoc): Promise<void> {
  let sourceConn: SSHClient | null = null;
  let targetConn: SSHClient | null = null;

  try {
    await connectDB();

    // Step 1: Connect to source server
    job.status = 'connecting';
    job.currentStep = 'Connecting to source server';
    job.progress = 2;
    appendLog(job, `Connecting to source ${job.sourceServer.ip}:${job.sourceServer.port}`);
    await job.save();

    sourceConn = await connectSSH({
      ip: job.sourceServer.ip,
      port: job.sourceServer.port,
      username: job.sourceServer.username,
      sshPrivateKey: job.sourceServer.sshPrivateKey,
      password: job.sourceServer.password,
    });
    appendLog(job, 'Source SSH connected');

    // Step 2: Connect to target server
    job.currentStep = 'Connecting to target server';
    job.progress = 5;
    appendLog(job, `Connecting to target ${job.targetServer.ip}:${job.targetServer.port}`);
    await job.save();

    targetConn = await connectSSH({
      ip: job.targetServer.ip,
      port: job.targetServer.port,
      username: job.targetServer.username,
      sshPrivateKey: job.targetServer.sshPrivateKey,
      password: job.targetServer.password,
    });
    appendLog(job, 'Target SSH connected');

    // Step 3: Install rsync on both servers
    job.currentStep = 'Installing dependencies';
    job.progress = 8;
    await job.save();

    await execSSH(sourceConn, 'which rsync >/dev/null 2>&1 || (apt-get update -y >/dev/null 2>&1 && apt-get install -y rsync >/dev/null 2>&1) || (yum install -y rsync >/dev/null 2>&1) || true');
    await execSSH(targetConn, 'which rsync >/dev/null 2>&1 || (apt-get update -y >/dev/null 2>&1 && apt-get install -y rsync >/dev/null 2>&1) || (yum install -y rsync >/dev/null 2>&1) || true');
    appendLog(job, 'Dependencies verified on both servers');

    // Step 4: Generate temporary SSH key on source for connecting to target
    job.currentStep = 'Setting up SSH tunnel';
    job.progress = 10;
    await job.save();

    const keyPath = '/tmp/.clone_key_' + job._id.toString();
    await execSSH(sourceConn, `rm -f ${keyPath} ${keyPath}.pub && ssh-keygen -t ed25519 -f ${keyPath} -N "" -q`);
    const pubKeyResult = await execSSH(sourceConn, `cat ${keyPath}.pub`);
    const pubKey = pubKeyResult.stdout.trim();

    if (!pubKey) throw new Error('Failed to generate temporary SSH key on source');

    // Add pubkey to target authorized_keys
    await execSSH(targetConn, `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '${pubKey}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`);
    appendLog(job, 'Temporary SSH key installed on target');

    // Step 5: Build rsync command based on mode and options
    job.status = 'syncing';
    job.currentStep = 'Building sync plan';
    job.progress = 15;
    await job.save();

    const excludes = [...(job.options.excludePaths || [])];
    // Always exclude these
    const alwaysExclude = ['/proc', '/sys', '/dev', '/run', '/tmp', '/lost+found', '/swapfile', '/swap.img'];
    for (const p of alwaysExclude) {
      if (!excludes.includes(p)) excludes.push(p);
    }

    // Build include/exclude paths based on options
    const syncPaths: string[] = [];

    if (job.mode === 'full') {
      // Full mode: sync entire filesystem
      syncPaths.push('/');
    } else {
      // Incremental mode: sync specific paths
      if (job.options.syncSystemConfigs) {
        syncPaths.push('/etc/');
        syncPaths.push('/root/');
        syncPaths.push('/var/spool/cron/');
      }
      if (job.options.syncDocker) {
        syncPaths.push('/var/lib/docker/');
        syncPaths.push('/etc/docker/');
      }
      if (job.options.syncUserData) {
        syncPaths.push('/home/');
        syncPaths.push('/opt/');
        syncPaths.push('/srv/');
      }
      if (job.options.customPaths.length > 0) {
        syncPaths.push(...job.options.customPaths);
      }
      if (syncPaths.length === 0) {
        syncPaths.push('/etc/', '/root/', '/home/', '/opt/');
      }
    }

    // Step 6: Database dumps if requested
    if (job.options.syncDatabases) {
      job.currentStep = 'Dumping databases on source';
      job.progress = 18;
      await job.save();

      const dumpDir = '/tmp/clone_db_dumps';
      await execSSH(sourceConn, `mkdir -p ${dumpDir}`);

      // MySQL/MariaDB
      const mysqlCheck = await execSSH(sourceConn, 'which mysqldump 2>/dev/null && echo "found" || docker exec $(docker ps -qf "ancestor=mysql" 2>/dev/null | head -1) echo "found" 2>/dev/null || docker exec $(docker ps -qf "ancestor=mariadb" 2>/dev/null | head -1) echo "found" 2>/dev/null || echo "not_found"');
      if (mysqlCheck.stdout.includes('found')) {
        appendLog(job, 'Dumping MySQL/MariaDB databases...');
        await execSSH(sourceConn, `mysqldump --all-databases > ${dumpDir}/mysql_all.sql 2>/dev/null || docker exec $(docker ps -qf "ancestor=mysql" 2>/dev/null || docker ps -qf "ancestor=mariadb" 2>/dev/null | head -1) mysqldump --all-databases > ${dumpDir}/mysql_all.sql 2>/dev/null || true`, 120000);
        appendLog(job, 'MySQL dump completed');
      }

      // PostgreSQL
      const pgCheck = await execSSH(sourceConn, 'which pg_dumpall 2>/dev/null && echo "found" || docker exec $(docker ps -qf "ancestor=postgres" 2>/dev/null | head -1) echo "found" 2>/dev/null || echo "not_found"');
      if (pgCheck.stdout.includes('found')) {
        appendLog(job, 'Dumping PostgreSQL databases...');
        await execSSH(sourceConn, `pg_dumpall > ${dumpDir}/postgres_all.sql 2>/dev/null || docker exec $(docker ps -qf "ancestor=postgres" 2>/dev/null | head -1) pg_dumpall -U postgres > ${dumpDir}/postgres_all.sql 2>/dev/null || true`, 120000);
        appendLog(job, 'PostgreSQL dump completed');
      }

      // MongoDB
      const mongoCheck = await execSSH(sourceConn, 'which mongodump 2>/dev/null && echo "found" || docker exec $(docker ps -qf "ancestor=mongo" 2>/dev/null | head -1) echo "found" 2>/dev/null || echo "not_found"');
      if (mongoCheck.stdout.includes('found')) {
        appendLog(job, 'Dumping MongoDB databases...');
        await execSSH(sourceConn, `mongodump --out ${dumpDir}/mongodb/ 2>/dev/null || docker exec $(docker ps -qf "ancestor=mongo" 2>/dev/null | head -1) mongodump --out /tmp/mongodump/ 2>/dev/null && docker cp $(docker ps -qf "ancestor=mongo" 2>/dev/null | head -1):/tmp/mongodump/ ${dumpDir}/mongodb/ 2>/dev/null || true`, 120000);
        appendLog(job, 'MongoDB dump completed');
      }

      syncPaths.push(dumpDir + '/');
    }

    // Step 7: Stop Docker on target if syncing Docker data
    if (job.options.syncDocker && job.mode === 'full') {
      job.currentStep = 'Stopping Docker on target';
      job.progress = 20;
      await job.save();
      await execSSH(targetConn, 'systemctl stop docker 2>/dev/null || service docker stop 2>/dev/null || true');
      appendLog(job, 'Docker stopped on target');
    }

    // Step 8: Execute rsync for each path
    job.currentStep = 'Syncing data from source to target';
    job.progress = 25;
    await job.save();

    const targetAddr = job.targetServer.ip;
    const targetPort = job.targetServer.port;
    const targetUser = job.targetServer.username;
    const sshOpts = `-e "ssh -i ${keyPath} -p ${targetPort} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"`;
    const excludeArgs = excludes.map(p => `--exclude='${p}'`).join(' ');

    const rsyncBaseFlags = job.mode === 'full'
      ? '-aHAXxz --numeric-ids --delete'  // full: archive + hard links + ACLs + xattrs + one filesystem + compress + delete extra files
      : '-avz --update';  // incremental: archive + verbose + compress + only newer files

    const totalPaths = syncPaths.length;
    for (let i = 0; i < totalPaths; i++) {
      const syncPath = syncPaths[i];
      const pct = 25 + Math.round(((i + 1) / totalPaths) * 50);

      job.currentStep = `Syncing ${syncPath} (${i + 1}/${totalPaths})`;
      job.progress = pct;
      await job.save();

      appendLog(job, `Syncing ${syncPath}...`);

      // Ensure target directory exists
      await execSSH(sourceConn, `ssh -i ${keyPath} -p ${targetPort} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${targetUser}@${targetAddr} "mkdir -p ${syncPath}" 2>/dev/null || true`);

      const rsyncCmd = `rsync ${rsyncBaseFlags} ${excludeArgs} ${sshOpts} ${syncPath} ${targetUser}@${targetAddr}:${syncPath} 2>&1 || true`;

      const result = await execSSH(sourceConn, rsyncCmd, 1800000); // 30 min timeout per path
      if (result.stdout) {
        const lines = result.stdout.split('\n');
        const summary = lines.slice(-5).join('\n');
        appendLog(job, `Rsync ${syncPath}: ${summary}`);
      }
    }

    appendLog(job, 'Data sync completed');

    // Step 9: Sync Docker volumes separately if requested
    if (job.options.syncDockerVolumes && !syncPaths.includes('/var/lib/docker/')) {
      job.currentStep = 'Syncing Docker volumes';
      job.progress = 78;
      await job.save();

      const volumeResult = await execSSH(sourceConn, 'docker volume ls -q 2>/dev/null || echo ""');
      const volumes = volumeResult.stdout.trim().split('\n').filter(Boolean);

      if (volumes.length > 0) {
        appendLog(job, `Syncing ${volumes.length} Docker volume(s)...`);
        for (const vol of volumes) {
          const mountResult = await execSSH(sourceConn, `docker volume inspect ${vol} --format '{{.Mountpoint}}' 2>/dev/null || echo ""`);
          const mountPoint = mountResult.stdout.trim();
          if (mountPoint) {
            await execSSH(sourceConn, `rsync -az ${sshOpts} ${mountPoint}/ ${targetUser}@${targetAddr}:${mountPoint}/ 2>&1 || true`, 600000);
          }
        }
        appendLog(job, 'Docker volumes synced');
      }
    }

    // Step 10: Post-clone configuration
    job.status = 'post_config';
    job.currentStep = 'Post-clone configuration';
    job.progress = 82;
    await job.save();

    if (job.options.regenerateSshHostKeys) {
      await execSSH(targetConn, 'rm -f /etc/ssh/ssh_host_* && ssh-keygen -A 2>/dev/null && (systemctl restart sshd 2>/dev/null || service ssh restart 2>/dev/null) || true');
      appendLog(job, 'SSH host keys regenerated on target');
    }

    // Restore database dumps on target
    if (job.options.syncDatabases) {
      job.currentStep = 'Restoring databases on target';
      job.progress = 85;
      await job.save();

      const dumpDir = '/tmp/clone_db_dumps';
      const mysqlDump = await execSSH(targetConn, `ls ${dumpDir}/mysql_all.sql 2>/dev/null && echo "found" || echo "not_found"`);
      if (mysqlDump.stdout.includes('found')) {
        await execSSH(targetConn, `mysql < ${dumpDir}/mysql_all.sql 2>/dev/null || docker exec -i $(docker ps -qf "ancestor=mysql" 2>/dev/null || docker ps -qf "ancestor=mariadb" 2>/dev/null | head -1) mysql < ${dumpDir}/mysql_all.sql 2>/dev/null || true`, 120000);
        appendLog(job, 'MySQL restored on target');
      }

      const pgDump = await execSSH(targetConn, `ls ${dumpDir}/postgres_all.sql 2>/dev/null && echo "found" || echo "not_found"`);
      if (pgDump.stdout.includes('found')) {
        await execSSH(targetConn, `psql -f ${dumpDir}/postgres_all.sql 2>/dev/null || docker exec -i $(docker ps -qf "ancestor=postgres" 2>/dev/null | head -1) psql -U postgres -f ${dumpDir}/postgres_all.sql 2>/dev/null || true`, 120000);
        appendLog(job, 'PostgreSQL restored on target');
      }

      const mongoDump = await execSSH(targetConn, `ls -d ${dumpDir}/mongodb/ 2>/dev/null && echo "found" || echo "not_found"`);
      if (mongoDump.stdout.includes('found')) {
        await execSSH(targetConn, `mongorestore ${dumpDir}/mongodb/ 2>/dev/null || docker cp ${dumpDir}/mongodb/ $(docker ps -qf "ancestor=mongo" 2>/dev/null | head -1):/tmp/mongorestore/ && docker exec $(docker ps -qf "ancestor=mongo" 2>/dev/null | head -1) mongorestore /tmp/mongorestore/ 2>/dev/null || true`, 120000);
        appendLog(job, 'MongoDB restored on target');
      }

      // Cleanup dump files
      await execSSH(targetConn, `rm -rf ${dumpDir}`);
      await execSSH(sourceConn, 'rm -rf /tmp/clone_db_dumps');
    }

    if (job.options.restartDocker) {
      job.currentStep = 'Restarting Docker on target';
      job.progress = 88;
      await job.save();
      await execSSH(targetConn, 'systemctl restart docker 2>/dev/null || service docker restart 2>/dev/null || true');
      appendLog(job, 'Docker restarted on target');
    }

    if (job.options.restartCoolify) {
      await execSSH(targetConn, 'systemctl restart coolify 2>/dev/null || systemctl restart coolify-agent 2>/dev/null || true');
      appendLog(job, 'Coolify restarted on target');
    }

    // Execute post-clone custom commands
    if (job.options.postCloneCommands.length > 0) {
      for (const cmd of job.options.postCloneCommands) {
        const r = await execSSH(targetConn, cmd);
        appendLog(job, `Post-clone command: ${cmd} → exit ${r.code}`);
      }
    }

    // Step 11: Verify
    job.status = 'verifying';
    job.currentStep = 'Verifying clone';
    job.progress = 92;
    await job.save();

    const verifyResult = await execSSH(targetConn, 'hostname && uptime && (docker ps 2>/dev/null || echo "no docker") && df -h /');
    appendLog(job, `Verification: ${verifyResult.stdout.slice(0, 1500)}`);

    // Cleanup: remove temp SSH key from source and target
    await execSSH(sourceConn, `rm -f ${keyPath} ${keyPath}.pub`);
    await execSSH(targetConn, `sed -i '/${job._id.toString()}/d' ~/.ssh/authorized_keys 2>/dev/null || true`);
    // Also remove the pubkey by content
    if (pubKey) {
      const escapedKey = pubKey.replace(/\//g, '\\/').replace(/\+/g, '\\+');
      await execSSH(targetConn, `grep -v '${escapedKey}' ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.tmp 2>/dev/null && mv ~/.ssh/authorized_keys.tmp ~/.ssh/authorized_keys 2>/dev/null || true`);
    }

    // Done
    job.status = 'completed';
    job.progress = 100;
    job.currentStep = 'Clone completed';
    job.completedAt = new Date();
    appendLog(job, `Clone ${job.mode === 'full' ? '(full)' : '(incremental)'} completed successfully`);
    await job.save();

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    job.status = 'failed';
    job.errorMessage = msg;
    job.completedAt = new Date();
    appendLog(job, `Clone failed: ${msg}`);
    await job.save();
  } finally {
    if (sourceConn) sourceConn.end();
    if (targetConn) targetConn.end();
  }
}

let pollingTimer: ReturnType<typeof setInterval> | null = null;

export function startDirectCloneWorker(intervalMs = 10000): void {
  console.log('[DirectCloneWorker] Started — polling every', intervalMs, 'ms');

  const poll = async () => {
    try {
      await connectDB();
      const pendingJob = await DirectCloneJob.findOneAndUpdate(
        { status: 'pending' },
        { $set: { status: 'connecting', startedAt: new Date() } },
        { sort: { createdAt: 1 }, new: true },
      );
      if (pendingJob) {
        console.log(`[DirectCloneWorker] Processing job ${pendingJob._id}`);
        await processDirectCloneJob(pendingJob as unknown as DirectCloneJobDoc);
      }
    } catch (err) {
      console.error('[DirectCloneWorker] Poll error:', err);
    }
  };

  poll();
  pollingTimer = setInterval(poll, intervalMs);
}

export function stopDirectCloneWorker(): void {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}
