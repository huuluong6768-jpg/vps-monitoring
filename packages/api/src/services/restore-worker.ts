import { Client as SSHClient } from 'ssh2';
import {
  connectDB, RestoreJob, CloneSnapshot, ServerCloneConfig,
  CloudProvider, createCloudClient,
} from '@vps-monitoring/shared';
import type { IRestoreJob } from '@vps-monitoring/shared';
import { Types } from 'mongoose';

interface RestoreJobDoc extends IRestoreJob {
  _id: Types.ObjectId;
  save(): Promise<void>;
}

function appendLog(job: RestoreJobDoc, msg: string) {
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

function execSSH(conn: SSHClient, cmd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream.on('data', (data: Buffer) => { stdout += data.toString(); });
      stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
      stream.on('close', (code: number) => {
        resolve({ code: code ?? 0, stdout, stderr });
      });
    });
  });
}

async function processRestoreJob(job: RestoreJobDoc): Promise<void> {
  let conn: SSHClient | null = null;

  try {
    await connectDB();

    const snapshot = await CloneSnapshot.findById(job.snapshotId);
    if (!snapshot) throw new Error('Snapshot not found');
    if (snapshot.status !== 'completed') throw new Error('Snapshot not completed');

    const config = await ServerCloneConfig.findById(snapshot.configId);
    if (!config) throw new Error('Clone config not found');

    const provider = await CloudProvider.findById(config.providerId);
    if (!provider) throw new Error('Cloud provider not found');

    // Step 1: Connect to target server
    job.status = 'downloading';
    job.currentStep = 'Connecting to target server';
    job.progress = 5;
    appendLog(job, `Connecting to ${job.targetServer.ip}:${job.targetServer.port}`);
    await job.save();

    conn = await connectSSH({
      ip: job.targetServer.ip,
      port: job.targetServer.port,
      username: job.targetServer.username,
      sshPrivateKey: job.targetServer.sshPrivateKey,
      password: job.targetServer.password,
    });
    appendLog(job, 'SSH connection established');

    // Step 2: Install dependencies on target
    job.currentStep = 'Installing dependencies on target';
    job.progress = 10;
    await job.save();

    await execSSH(conn, 'apt-get update -y >/dev/null 2>&1 && apt-get install -y curl jq rsync pigz >/dev/null 2>&1 || yum install -y curl jq rsync pigz >/dev/null 2>&1 || true');
    appendLog(job, 'Dependencies installed on target');

    // Step 3: Download backup chunks from cloud to target
    job.currentStep = 'Downloading backup from cloud storage';
    job.progress = 15;
    await job.save();

    const client = createCloudClient(provider);
    const totalChunks = snapshot.chunks.length;

    for (let i = 0; i < totalChunks; i++) {
      const chunk = snapshot.chunks[i];
      if (!chunk.remoteFileId) continue;

      appendLog(job, `Downloading chunk ${i + 1}/${totalChunks}`);
      job.progress = 15 + Math.round((i / totalChunks) * 30);
      job.currentStep = `Downloading chunk ${i + 1}/${totalChunks}`;
      await job.save();

      const data = await client.downloadFile(chunk.remoteFileId);

      // Write chunk to target via SFTP
      await new Promise<void>((resolve, reject) => {
        conn!.sftp((err, sftp) => {
          if (err) return reject(err);
          const remotePath = `/tmp/vps-restore-chunk-${i}`;
          const writeStream = sftp.createWriteStream(remotePath);
          writeStream.on('error', reject);
          writeStream.on('close', () => resolve());
          writeStream.end(data);
        });
      });

      appendLog(job, `Chunk ${i + 1} written to target`);
    }

    // Step 4: Reassemble chunks on target
    job.status = 'restoring';
    job.currentStep = 'Reassembling backup on target';
    job.progress = 50;
    await job.save();

    if (totalChunks === 1) {
      await execSSH(conn, 'mv /tmp/vps-restore-chunk-0 /tmp/vps-restore-backup.tar.gz');
    } else {
      const catCmd = Array.from({ length: totalChunks }, (_, i) => `/tmp/vps-restore-chunk-${i}`).join(' ');
      await execSSH(conn, `cat ${catCmd} > /tmp/vps-restore-backup.tar.gz && rm -f ${catCmd}`);
    }
    appendLog(job, 'Backup reassembled on target');

    // Step 5: Download and run restore script
    job.currentStep = 'Running restore on target';
    job.progress = 55;
    await job.save();

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    await execSSH(conn, `curl -fsSL ${appUrl}/scripts/restore.sh -o /tmp/vps-restore.sh && chmod +x /tmp/vps-restore.sh`);

    const restoreType = snapshot.type === 'full_image' ? 'full_image' : 'rsync';
    const newHostname = job.postRestore?.newHostname || '';
    const newIp = job.postRestore?.newIp || '';

    appendLog(job, `Executing restore script (type=${restoreType})`);
    job.progress = 60;
    await job.save();

    const restoreResult = await execSSH(
      conn,
      `DOWNLOAD_URL="" bash /tmp/vps-restore.sh ${restoreType} file:///tmp/vps-restore-backup.tar.gz "${newIp}" "${newHostname}" 2>&1 || true`,
    );
    appendLog(job, `Restore output: ${restoreResult.stdout.slice(0, 2000)}`);
    if (restoreResult.stderr) {
      appendLog(job, `Restore stderr: ${restoreResult.stderr.slice(0, 1000)}`);
    }

    // Step 6: Post-restore configuration
    job.status = 'post_config';
    job.currentStep = 'Post-restore configuration';
    job.progress = 80;
    await job.save();

    if (job.postRestore?.regenerateSshHostKeys) {
      await execSSH(conn, 'rm -f /etc/ssh/ssh_host_* && ssh-keygen -A && systemctl restart sshd 2>/dev/null || service ssh restart 2>/dev/null || true');
      appendLog(job, 'SSH host keys regenerated');
    }

    if (job.postRestore?.restartDocker) {
      await execSSH(conn, 'systemctl restart docker 2>/dev/null || service docker restart 2>/dev/null || true');
      appendLog(job, 'Docker restarted');
    }

    if (job.postRestore?.restartCoolify) {
      await execSSH(conn, 'systemctl restart coolify 2>/dev/null || systemctl restart coolify-agent 2>/dev/null || true');
      appendLog(job, 'Coolify restarted');
    }

    if (job.postRestore?.postRestoreCommands) {
      for (const cmd of job.postRestore.postRestoreCommands) {
        const r = await execSSH(conn, cmd);
        appendLog(job, `Post-restore command: ${cmd} → exit ${r.code}`);
      }
    }

    // Step 7: Verify
    job.status = 'verifying';
    job.currentStep = 'Verifying restore';
    job.progress = 90;
    await job.save();

    const verifyResult = await execSSH(conn, 'hostname && uptime && (docker ps 2>/dev/null || echo "no docker") && df -h /');
    appendLog(job, `Verify: ${verifyResult.stdout.slice(0, 1000)}`);

    // Cleanup
    await execSSH(conn, 'rm -f /tmp/vps-restore-backup.tar.gz /tmp/vps-restore.sh /tmp/vps-restore-chunk-*');

    // Done
    job.status = 'completed';
    job.progress = 100;
    job.currentStep = 'Restore completed';
    job.completedAt = new Date();
    appendLog(job, 'Restore completed successfully');
    await job.save();

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    job.status = 'failed';
    job.errorMessage = msg;
    job.completedAt = new Date();
    appendLog(job, `Restore failed: ${msg}`);
    await job.save();
  } finally {
    if (conn) conn.end();
  }
}

let pollingTimer: ReturnType<typeof setInterval> | null = null;

export function startRestoreWorker(intervalMs = 15000): void {
  console.log('[RestoreWorker] Started — polling every', intervalMs, 'ms');

  const poll = async () => {
    try {
      await connectDB();
      const pendingJob = await RestoreJob.findOneAndUpdate(
        { status: 'pending' },
        { $set: { status: 'downloading', startedAt: new Date() } },
        { sort: { createdAt: 1 }, new: true },
      );
      if (pendingJob) {
        console.log(`[RestoreWorker] Processing restore job ${pendingJob._id}`);
        await processRestoreJob(pendingJob as unknown as RestoreJobDoc);
      }
    } catch (err) {
      console.error('[RestoreWorker] Poll error:', err);
    }
  };

  poll();
  pollingTimer = setInterval(poll, intervalMs);
}

export function stopRestoreWorker(): void {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}
