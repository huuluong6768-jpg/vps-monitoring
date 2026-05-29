import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import {
  connectDB, env, Agent, Metric,
  getAppSettings, sendTelegramOverloadIfNeeded, sendTelegramDisconnectIfNeeded, shouldSendTelegramDisconnectAlert,
  CloneSnapshot, ServerCloneConfig, CloudProvider, createCloudClient,
} from '@vps-monitoring/shared';
import { requireAuth, getSessionFromRequest } from '../middleware/auth';

const router = Router();

// --- Agent Registration (no auth) ---
const registerSchema = z.object({
  agentId: z.string().min(8).max(64).optional(),
  hostname: z.string().max(255).default('unknown'),
  os: z.string().max(64).default('unknown'),
  osVersion: z.string().max(128).default(''),
  kernel: z.string().max(128).default(''),
  arch: z.string().max(32).default(''),
  cpuModel: z.string().max(255).default(''),
  cpuCores: z.number().int().min(0).max(4096).default(0),
  totalMemoryBytes: z.number().min(0).default(0),
  totalDiskBytes: z.number().min(0).default(0),
  publicIp: z.string().max(64).optional(),
  privateIp: z.string().max(64).optional(),
});

router.post('/register', async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }
  await connectDB();

  let agent = parsed.data.agentId ? await Agent.findOne({ agentId: parsed.data.agentId }) : null;
  if (agent) {
    Object.assign(agent, {
      hostname: parsed.data.hostname, os: parsed.data.os, osVersion: parsed.data.osVersion,
      kernel: parsed.data.kernel, arch: parsed.data.arch, cpuModel: parsed.data.cpuModel,
      cpuCores: parsed.data.cpuCores, totalMemoryBytes: parsed.data.totalMemoryBytes,
      totalDiskBytes: parsed.data.totalDiskBytes, publicIp: parsed.data.publicIp, privateIp: parsed.data.privateIp,
    });
    await agent.save();
    res.json({ ok: true, agentId: agent.agentId, token: agent.token, reused: true });
    return;
  }

  const agentId = parsed.data.agentId ?? `vps_${nanoid(16)}`;
  const token = `tok_${nanoid(40)}`;
  agent = await Agent.create({
    agentId, token, hostname: parsed.data.hostname, os: parsed.data.os, osVersion: parsed.data.osVersion,
    kernel: parsed.data.kernel, arch: parsed.data.arch, cpuModel: parsed.data.cpuModel,
    cpuCores: parsed.data.cpuCores, totalMemoryBytes: parsed.data.totalMemoryBytes,
    totalDiskBytes: parsed.data.totalDiskBytes, publicIp: parsed.data.publicIp, privateIp: parsed.data.privateIp,
    registeredAt: new Date(),
  });
  res.json({ ok: true, agentId: agent.agentId, token: agent.token, reused: false });
});

// --- Heartbeat (agent auth) ---
const heartbeatSchema = z.object({
  agentId: z.string().min(1), token: z.string().min(1),
  status: z.enum(['heartbeat', 'shutdown']).default('heartbeat'),
  cpuPercent: z.number().min(0).max(100).default(0),
  loadAvg1: z.number().min(0).default(0), loadAvg5: z.number().min(0).default(0), loadAvg15: z.number().min(0).default(0),
  memUsedBytes: z.number().min(0).default(0), memTotalBytes: z.number().min(0).default(0),
  swapUsedBytes: z.number().min(0).default(0), swapTotalBytes: z.number().min(0).default(0),
  diskUsedBytes: z.number().min(0).default(0), diskTotalBytes: z.number().min(0).default(0),
  diskReadBps: z.number().min(0).default(0), diskWriteBps: z.number().min(0).default(0),
  netRxBytes: z.number().min(0).default(0), netTxBytes: z.number().min(0).default(0),
  netRxBps: z.number().min(0).default(0), netTxBps: z.number().min(0).default(0),
  dockerCpuPercent: z.number().min(0).default(0), dockerMemUsedBytes: z.number().min(0).default(0),
  dockerNetRxBps: z.number().min(0).default(0), dockerNetTxBps: z.number().min(0).default(0),
  dockerContainerCount: z.number().int().min(0).default(0),
  temperatureC: z.number().min(0).default(0),
  gpuUtilPercent: z.number().min(0).max(100).default(0), gpuMemUsedBytes: z.number().min(0).default(0),
  gpuMemTotalBytes: z.number().min(0).default(0), gpuPowerWatts: z.number().min(0).default(0),
  uptimeSeconds: z.number().min(0).default(0), processCount: z.number().int().min(0).default(0),
});

router.post('/heartbeat', async (req: Request, res: Response) => {
  const parsed = heartbeatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }
  await connectDB();
  const agent = await Agent.findOne({ agentId: parsed.data.agentId, token: parsed.data.token });
  if (!agent) { res.status(401).json({ error: 'Unknown agent or invalid token' }); return; }

  const now = new Date();
  const previousLastSeenAt = agent.lastSeenAt;
  agent.lastSeenAt = now;

  if (parsed.data.status === 'shutdown') {
    const appSettings = await getAppSettings();
    const sent = await sendTelegramDisconnectIfNeeded(
      { agentId: agent.agentId, hostname: agent.hostname, label: agent.label, publicIp: agent.publicIp, lastSeenAt: previousLastSeenAt ?? now, lastTelegramOfflineAlertAt: agent.lastTelegramOfflineAlertAt },
      appSettings, env.APP_URL, 'shutdown'
    );
    if (sent) agent.lastTelegramOfflineAlertAt = now;
    await agent.save();
    res.json({ ok: true });
    return;
  }

  await agent.save();
  await Metric.create({
    agentId: agent.agentId, ts: now,
    cpuPercent: parsed.data.cpuPercent, loadAvg1: parsed.data.loadAvg1, loadAvg5: parsed.data.loadAvg5, loadAvg15: parsed.data.loadAvg15,
    memUsedBytes: parsed.data.memUsedBytes, memTotalBytes: parsed.data.memTotalBytes,
    swapUsedBytes: parsed.data.swapUsedBytes, swapTotalBytes: parsed.data.swapTotalBytes,
    diskUsedBytes: parsed.data.diskUsedBytes, diskTotalBytes: parsed.data.diskTotalBytes,
    diskReadBps: parsed.data.diskReadBps, diskWriteBps: parsed.data.diskWriteBps,
    netRxBytes: parsed.data.netRxBytes, netTxBytes: parsed.data.netTxBytes,
    netRxBps: parsed.data.netRxBps, netTxBps: parsed.data.netTxBps,
    dockerCpuPercent: parsed.data.dockerCpuPercent, dockerMemUsedBytes: parsed.data.dockerMemUsedBytes,
    dockerNetRxBps: parsed.data.dockerNetRxBps, dockerNetTxBps: parsed.data.dockerNetTxBps,
    dockerContainerCount: parsed.data.dockerContainerCount,
    temperatureC: parsed.data.temperatureC,
    gpuUtilPercent: parsed.data.gpuUtilPercent, gpuMemUsedBytes: parsed.data.gpuMemUsedBytes,
    gpuMemTotalBytes: parsed.data.gpuMemTotalBytes, gpuPowerWatts: parsed.data.gpuPowerWatts,
    uptimeSeconds: parsed.data.uptimeSeconds, processCount: parsed.data.processCount,
  });

  const appSettings = await getAppSettings();
  const sent = await sendTelegramOverloadIfNeeded(
    agent,
    { cpuPercent: parsed.data.cpuPercent, memUsedBytes: parsed.data.memUsedBytes, memTotalBytes: parsed.data.memTotalBytes, diskUsedBytes: parsed.data.diskUsedBytes, diskTotalBytes: parsed.data.diskTotalBytes },
    appSettings, env.APP_URL
  );
  if (sent) { agent.lastTelegramAlertAt = now; await agent.save(); }
  res.json({ ok: true });
});

// --- List agents (dashboard auth) ---
router.get('/', requireAuth, async (req: Request, res: Response) => {
  await connectDB();
  const agents = await Agent.find({}).sort({ hostname: 1, agentId: 1 }).lean();
  const ids = agents.map((a) => a.agentId);

  const latest = await Metric.aggregate([
    { $match: { agentId: { $in: ids } } },
    { $sort: { ts: -1 } },
    { $group: { _id: '$agentId', metric: { $first: '$$ROOT' } } },
  ]);
  const latestMap = new Map<string, (typeof latest)[number]['metric']>();
  for (const item of latest) latestMap.set(item._id, item.metric);

  const offlineMs = env.AGENT_OFFLINE_AFTER_SECONDS * 1000;
  const now = Date.now();
  const offlineAlertAt = new Date();

  const data = agents.map((a) => {
    const m = latestMap.get(a.agentId);
    const online = a.lastSeenAt && now - new Date(a.lastSeenAt).getTime() <= offlineMs ? true : false;
    return {
      agentId: a.agentId, hostname: a.hostname, label: a.label, os: a.os, osVersion: a.osVersion,
      kernel: a.kernel, arch: a.arch, cpuModel: a.cpuModel, cpuCores: a.cpuCores,
      totalMemoryBytes: a.totalMemoryBytes, totalDiskBytes: a.totalDiskBytes,
      publicIp: a.publicIp, privateIp: a.privateIp, tags: a.tags, online,
      lastSeenAt: a.lastSeenAt, registeredAt: a.registeredAt,
      latest: m ? {
        ts: m.ts, cpuPercent: m.cpuPercent, memUsedBytes: m.memUsedBytes, memTotalBytes: m.memTotalBytes,
        diskUsedBytes: m.diskUsedBytes, diskTotalBytes: m.diskTotalBytes, diskReadBps: m.diskReadBps, diskWriteBps: m.diskWriteBps,
        netRxBytes: m.netRxBytes, netTxBytes: m.netTxBytes, netRxBps: m.netRxBps, netTxBps: m.netTxBps,
        dockerCpuPercent: m.dockerCpuPercent, dockerMemUsedBytes: m.dockerMemUsedBytes,
        dockerNetRxBps: m.dockerNetRxBps, dockerNetTxBps: m.dockerNetTxBps, dockerContainerCount: m.dockerContainerCount,
        temperatureC: m.temperatureC, gpuUtilPercent: m.gpuUtilPercent, gpuMemUsedBytes: m.gpuMemUsedBytes,
        gpuMemTotalBytes: m.gpuMemTotalBytes, gpuPowerWatts: m.gpuPowerWatts, uptimeSeconds: m.uptimeSeconds, loadAvg1: m.loadAvg1,
      } : null,
    };
  });

  const offlineAlertCandidates = agents.filter((a) => {
    const online = a.lastSeenAt && now - new Date(a.lastSeenAt).getTime() <= offlineMs ? true : false;
    return !online && shouldSendTelegramDisconnectAlert(a);
  });
  if (offlineAlertCandidates.length > 0) {
    const appSettings = await getAppSettings();
    for (const agentDoc of offlineAlertCandidates) {
      const sent = await sendTelegramDisconnectIfNeeded(agentDoc, appSettings, env.APP_URL, 'offline');
      if (sent) {
        await Agent.updateOne({ agentId: agentDoc.agentId }, { $set: { lastTelegramOfflineAlertAt: offlineAlertAt } });
      }
    }
  }
  res.json({ agents: data });
});

// --- Single agent GET/PATCH/DELETE ---
router.get('/:agentId', requireAuth, async (req: Request, res: Response) => {
  await connectDB();
  const agent = await Agent.findOne({ agentId: req.params.agentId }).lean();
  if (!agent) { res.status(404).json({ error: 'Not found' }); return; }

  const latest = await Metric.findOne({ agentId: req.params.agentId }).sort({ ts: -1 }).lean();
  const offlineMs = env.AGENT_OFFLINE_AFTER_SECONDS * 1000;
  const online = agent.lastSeenAt ? Date.now() - new Date(agent.lastSeenAt).getTime() <= offlineMs : false;

  if (!online && shouldSendTelegramDisconnectAlert(agent)) {
    const appSettings = await getAppSettings();
    const sent = await sendTelegramDisconnectIfNeeded(agent, appSettings, env.APP_URL, 'offline');
    if (sent) {
      await Agent.updateOne({ agentId: agent.agentId }, { $set: { lastTelegramOfflineAlertAt: new Date() } });
    }
  }

  res.json({
    agent: {
      agentId: agent.agentId, hostname: agent.hostname, label: agent.label, os: agent.os, osVersion: agent.osVersion,
      kernel: agent.kernel, arch: agent.arch, cpuModel: agent.cpuModel, cpuCores: agent.cpuCores,
      totalMemoryBytes: agent.totalMemoryBytes, totalDiskBytes: agent.totalDiskBytes,
      publicIp: agent.publicIp, privateIp: agent.privateIp, tags: agent.tags, online,
      lastSeenAt: agent.lastSeenAt, registeredAt: agent.registeredAt, latest,
    },
  });
});

const patchAgentSchema = z.object({
  label: z.string().max(64).optional(),
  tags: z.array(z.string().max(32)).max(20).optional(),
});

router.patch('/:agentId', requireAuth, async (req: Request, res: Response) => {
  const parsed = patchAgentSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input' }); return; }

  await connectDB();
  const agent = await Agent.findOneAndUpdate({ agentId: req.params.agentId }, { $set: parsed.data }, { new: true });
  if (!agent) { res.status(404).json({ error: 'Not found' }); return; }
  res.json({ ok: true });
});

router.delete('/:agentId', requireAuth, async (req: Request, res: Response) => {
  await connectDB();
  await Agent.deleteOne({ agentId: req.params.agentId });
  await Metric.deleteMany({ agentId: req.params.agentId });
  res.json({ ok: true });
});

// --- Metrics ---
router.get('/:agentId/metrics', requireAuth, async (req: Request, res: Response) => {
  const range = (req.query.range as string) ?? '1h';
  const now = Date.now();
  let fromMs = now - 60 * 60 * 1000;
  if (range === '6h') fromMs = now - 6 * 60 * 60 * 1000;
  else if (range === '24h') fromMs = now - 24 * 60 * 60 * 1000;
  else if (range === '7d') fromMs = now - 7 * 24 * 60 * 60 * 1000;

  await connectDB();
  const rows = await Metric.find({ agentId: req.params.agentId, ts: { $gte: new Date(fromMs) } }).sort({ ts: 1 }).limit(2000).lean();
  const metrics = rows.map((m) => ({
    ts: m.ts, cpuPercent: m.cpuPercent, memUsedBytes: m.memUsedBytes, memTotalBytes: m.memTotalBytes,
    diskUsedBytes: m.diskUsedBytes, diskTotalBytes: m.diskTotalBytes, diskReadBps: m.diskReadBps, diskWriteBps: m.diskWriteBps,
    netRxBps: m.netRxBps, netTxBps: m.netTxBps,
    dockerCpuPercent: m.dockerCpuPercent, dockerMemUsedBytes: m.dockerMemUsedBytes,
    dockerNetRxBps: m.dockerNetRxBps, dockerNetTxBps: m.dockerNetTxBps, dockerContainerCount: m.dockerContainerCount,
    temperatureC: m.temperatureC, gpuUtilPercent: m.gpuUtilPercent, gpuMemUsedBytes: m.gpuMemUsedBytes,
    gpuMemTotalBytes: m.gpuMemTotalBytes, gpuPowerWatts: m.gpuPowerWatts,
    loadAvg1: m.loadAvg1, loadAvg5: m.loadAvg5, loadAvg15: m.loadAvg15,
  }));
  res.json({ metrics });
});

// --- Backup status (agent auth) ---
const backupStatusSchema = z.object({
  agentId: z.string().min(1), token: z.string().min(1), snapshotId: z.string().min(1),
  status: z.string(), progress: z.number().min(0).max(100), message: z.string().optional(),
  totalSizeBytes: z.number().optional(), originalSizeBytes: z.number().optional(),
  serverMeta: z.record(z.string()).optional(),
});

router.post('/backup/status', async (req: Request, res: Response) => {
  const parsed = backupStatusSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input' }); return; }

  await connectDB();
  const agent = await Agent.findOne({ agentId: parsed.data.agentId, token: parsed.data.token });
  if (!agent) { res.status(401).json({ error: 'Unknown agent' }); return; }

  const snapshot = await CloneSnapshot.findById(parsed.data.snapshotId);
  if (!snapshot || snapshot.agentId !== parsed.data.agentId) { res.status(404).json({ error: 'Snapshot not found' }); return; }

  snapshot.status = parsed.data.status as typeof snapshot.status;
  snapshot.progress = parsed.data.progress;
  if (parsed.data.message) snapshot.logs.push(`[${new Date().toISOString()}] ${parsed.data.message}`);
  if (parsed.data.totalSizeBytes) snapshot.totalSizeBytes = parsed.data.totalSizeBytes;
  if (parsed.data.originalSizeBytes) snapshot.originalSizeBytes = parsed.data.originalSizeBytes;
  if (parsed.data.serverMeta) Object.assign(snapshot.serverMeta, parsed.data.serverMeta);

  if (parsed.data.status === 'completed') {
    snapshot.completedAt = new Date();
    snapshot.duration = Math.round((snapshot.completedAt.getTime() - snapshot.startedAt.getTime()) / 1000);
    if (snapshot.originalSizeBytes && snapshot.totalSizeBytes) {
      snapshot.compressionRatio = snapshot.totalSizeBytes / snapshot.originalSizeBytes;
    }
    await ServerCloneConfig.findByIdAndUpdate(snapshot.configId, {
      $set: snapshot.type === 'full_image'
        ? { lastFullImageAt: new Date(), lastFullImageSize: snapshot.totalSizeBytes }
        : { lastRsyncAt: new Date(), lastRsyncSize: snapshot.totalSizeBytes },
    });
  }
  if (parsed.data.status === 'failed') {
    snapshot.completedAt = new Date();
    snapshot.errorMessage = parsed.data.message;
  }
  await snapshot.save();
  res.json({ ok: true });
});

// --- Backup upload (agent auth) ---
router.post('/backup/upload', async (req: Request, res: Response) => {
  const agentId = req.headers['x-agent-id'] as string;
  const token = req.headers['x-agent-token'] as string;
  const snapshotId = req.headers['x-snapshot-id'] as string;
  const chunkIndex = req.headers['x-chunk-index'] as string;
  const chunkChecksum = (req.headers['x-chunk-checksum'] as string) || '';
  const chunkSize = Number(req.headers['x-chunk-size'] || 0);

  if (!agentId || !token || !snapshotId) { res.status(400).json({ error: 'Missing headers' }); return; }

  await connectDB();
  const agent = await Agent.findOne({ agentId, token });
  if (!agent) { res.status(401).json({ error: 'Unknown agent' }); return; }

  const snapshot = await CloneSnapshot.findById(snapshotId);
  if (!snapshot || snapshot.agentId !== agentId) { res.status(404).json({ error: 'Snapshot not found' }); return; }

  const config = await ServerCloneConfig.findById(snapshot.configId);
  if (!config) { res.status(404).json({ error: 'Config not found' }); return; }

  const provider = await CloudProvider.findById(config.providerId);
  if (!provider) { res.status(404).json({ error: 'Cloud provider not found' }); return; }

  try {
    const client = createCloudClient(provider);
    let fileData: Buffer;
    if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      fileData = req.body;
    } else {
      const buffers: Buffer[] = [];
      for await (const chunk of req) buffers.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      fileData = Buffer.concat(buffers);
    }

    const folderPath = `${config.remotePath}${agent.hostname || agentId}`;
    const folderId = await client.createFolder(folderPath);

    const fileName = chunkIndex === 'metadata' ? `${snapshot._id}_metadata.tar.gz`
      : chunkIndex === 'checksums' ? `${snapshot._id}_checksums.sha256`
      : `${snapshot._id}_chunk_${chunkIndex}`;

    const result = await client.uploadFile(fileName, fileData, folderId);
    if (chunkIndex !== 'metadata' && chunkIndex !== 'checksums') {
      snapshot.chunks.push({
        index: Number(chunkIndex), remoteFileId: result.fileId, remotePath: result.name,
        sizeBytes: chunkSize || fileData.length, checksum: chunkChecksum, uploaded: true,
      });
    }
    snapshot.status = 'uploading';
    await snapshot.save();
    res.json({ ok: true, fileId: result.fileId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Upload failed';
    snapshot.status = 'failed';
    snapshot.errorMessage = msg;
    await snapshot.save();
    res.status(500).json({ error: msg });
  }
});

// --- Clone pending (agent auth) ---
router.get('/clone/pending', async (req: Request, res: Response) => {
  const agentId = req.query.agentId as string;
  const token = req.query.token as string;
  if (!agentId || !token) { res.status(400).json({ error: 'Missing agentId or token' }); return; }

  await connectDB();
  const agent = await Agent.findOne({ agentId, token });
  if (!agent) { res.status(401).json({ error: 'Unknown agent or invalid token' }); return; }

  const pendingSnapshots = await CloneSnapshot.find({ agentId, status: 'pending' }).sort({ createdAt: 1 }).limit(1).lean();
  res.json({
    tasks: pendingSnapshots.map((s) => ({
      snapshotId: s._id, type: s.type, configId: s.configId,
    })),
  });
});

export default router;
