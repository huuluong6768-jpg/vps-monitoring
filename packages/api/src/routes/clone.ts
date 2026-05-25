import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { connectDB, ServerCloneConfig, CloneSnapshot, RestoreJob } from '@vps-monitoring/shared';
import { requireAuth } from '../middleware/auth';

const router = Router();

// --- Clone Configs ---
const createConfigSchema = z.object({
  agentId: z.string().min(1), providerId: z.string().min(1),
  remotePath: z.string().max(500).optional(),
  modes: z.object({
    fullImage: z.object({
      enabled: z.boolean().default(false), schedule: z.string().max(100).optional(),
      compression: z.enum(['gzip', 'pigz', 'zstd']).default('pigz'),
      compressionLevel: z.number().int().min(1).max(9).default(1),
    }).optional(),
    rsyncDaily: z.object({
      enabled: z.boolean().default(true), schedule: z.string().max(100).default('0 2 * * *'),
      excludePaths: z.array(z.string()).optional(), syncDockerVolumes: z.boolean().default(true),
      preBackupDatabaseDumps: z.array(z.object({
        type: z.enum(['mysql', 'postgresql', 'mongodb']), containerName: z.string().optional(),
        connectionString: z.string().optional(), dumpPath: z.string(),
      })).optional(),
    }).optional(),
  }).optional(),
  retention: z.object({
    fullImageKeep: z.number().int().min(1).max(100).default(3),
    rsyncKeep: z.number().int().min(1).max(365).default(14),
  }).optional(),
  notifyOnSuccess: z.boolean().default(true), notifyOnFailure: z.boolean().default(true),
});

router.get('/configs', requireAuth, async (_req: Request, res: Response) => {
  await connectDB();
  const configs = await ServerCloneConfig.find({}).sort({ createdAt: -1 }).lean();
  res.json({ configs });
});

router.post('/configs', requireAuth, async (req: Request, res: Response) => {
  const parsed = createConfigSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }

  await connectDB();
  const existing = await ServerCloneConfig.findOne({ agentId: parsed.data.agentId });
  if (existing) { res.status(409).json({ error: 'Clone config already exists for this server' }); return; }

  const config = await ServerCloneConfig.create({
    agentId: parsed.data.agentId, providerId: parsed.data.providerId,
    remotePath: parsed.data.remotePath || '/server-clones/',
    modes: parsed.data.modes, retention: parsed.data.retention,
    notifyOnSuccess: parsed.data.notifyOnSuccess, notifyOnFailure: parsed.data.notifyOnFailure,
  });
  res.json({ ok: true, config });
});

// --- Single config ---
router.get('/configs/:id', requireAuth, async (req: Request, res: Response) => {
  await connectDB();
  const config = await ServerCloneConfig.findById(req.params.id).lean();
  if (!config) { res.status(404).json({ error: 'Not found' }); return; }
  res.json({ config });
});

const patchConfigSchema = z.object({
  enabled: z.boolean().optional(), remotePath: z.string().max(500).optional(),
  notifyOnSuccess: z.boolean().optional(), notifyOnFailure: z.boolean().optional(),
  modes: z.object({
    fullImage: z.object({
      enabled: z.boolean().optional(), schedule: z.string().max(100).optional(),
      compression: z.enum(['gzip', 'pigz', 'zstd']).optional(), compressionLevel: z.number().int().min(1).max(9).optional(),
    }).optional(),
    rsyncDaily: z.object({
      enabled: z.boolean().optional(), schedule: z.string().max(100).optional(), syncDockerVolumes: z.boolean().optional(),
    }).optional(),
  }).optional(),
  retention: z.object({
    fullImageKeep: z.number().int().min(1).max(100).optional(), rsyncKeep: z.number().int().min(1).max(365).optional(),
  }).optional(),
}).partial();

router.patch('/configs/:id', requireAuth, async (req: Request, res: Response) => {
  const parsed = patchConfigSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input' }); return; }

  await connectDB();
  const config = await ServerCloneConfig.findById(req.params.id);
  if (!config) { res.status(404).json({ error: 'Not found' }); return; }

  const d = parsed.data;
  if (d.enabled !== undefined) config.enabled = d.enabled;
  if (d.remotePath !== undefined) config.remotePath = d.remotePath;
  if (d.notifyOnSuccess !== undefined) config.notifyOnSuccess = d.notifyOnSuccess;
  if (d.notifyOnFailure !== undefined) config.notifyOnFailure = d.notifyOnFailure;
  if (d.modes?.fullImage) {
    const fi = d.modes.fullImage;
    if (fi.enabled !== undefined) config.modes.fullImage.enabled = fi.enabled;
    if (fi.schedule !== undefined) config.modes.fullImage.schedule = fi.schedule;
    if (fi.compression !== undefined) config.modes.fullImage.compression = fi.compression;
    if (fi.compressionLevel !== undefined) config.modes.fullImage.compressionLevel = fi.compressionLevel;
  }
  if (d.modes?.rsyncDaily) {
    const rs = d.modes.rsyncDaily;
    if (rs.enabled !== undefined) config.modes.rsyncDaily.enabled = rs.enabled;
    if (rs.schedule !== undefined) config.modes.rsyncDaily.schedule = rs.schedule;
    if (rs.syncDockerVolumes !== undefined) config.modes.rsyncDaily.syncDockerVolumes = rs.syncDockerVolumes;
  }
  if (d.retention) {
    if (d.retention.fullImageKeep !== undefined) config.retention.fullImageKeep = d.retention.fullImageKeep;
    if (d.retention.rsyncKeep !== undefined) config.retention.rsyncKeep = d.retention.rsyncKeep;
  }
  await config.save();
  res.json({ ok: true, config });
});

router.delete('/configs/:id', requireAuth, async (req: Request, res: Response) => {
  await connectDB();
  const config = await ServerCloneConfig.findById(req.params.id);
  if (!config) { res.status(404).json({ error: 'Not found' }); return; }
  await CloneSnapshot.deleteMany({ configId: config._id });
  await config.deleteOne();
  res.json({ ok: true });
});

router.post('/configs/:id', requireAuth, async (req: Request, res: Response) => {
  const action = req.query.action as string;
  if (action !== 'trigger') { res.status(400).json({ error: 'Unknown action. Use ?action=trigger' }); return; }

  const snapshotType = (req.body as Record<string, string>).type || 'rsync_full';
  await connectDB();
  const config = await ServerCloneConfig.findById(req.params.id);
  if (!config) { res.status(404).json({ error: 'Not found' }); return; }

  const snapshot = await CloneSnapshot.create({
    agentId: config.agentId, configId: config._id, type: snapshotType, status: 'pending', startedAt: new Date(),
  });
  res.json({ ok: true, snapshot });
});

// --- Snapshots ---
router.get('/snapshots', requireAuth, async (req: Request, res: Response) => {
  const agentId = req.query.agentId as string;
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));

  await connectDB();
  const filter: Record<string, unknown> = {};
  if (agentId) filter.agentId = agentId;

  const [snapshots, total] = await Promise.all([
    CloneSnapshot.find(filter).sort({ startedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    CloneSnapshot.countDocuments(filter),
  ]);
  res.json({ snapshots, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
});

router.get('/snapshots/:id', requireAuth, async (req: Request, res: Response) => {
  await connectDB();
  const snapshot = await CloneSnapshot.findById(req.params.id).lean();
  if (!snapshot) { res.status(404).json({ error: 'Not found' }); return; }
  res.json({ snapshot });
});

router.delete('/snapshots/:id', requireAuth, async (req: Request, res: Response) => {
  await connectDB();
  await CloneSnapshot.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// --- Restore ---
const createRestoreSchema = z.object({
  snapshotId: z.string().min(1),
  targetServer: z.object({
    ip: z.string().min(1), port: z.number().int().min(1).max(65535).default(22),
    username: z.string().default('root'), sshPrivateKey: z.string().optional(), password: z.string().optional(),
  }),
  postRestore: z.object({
    newHostname: z.string().optional(), newIp: z.string().optional(), newGateway: z.string().optional(),
    newDns: z.array(z.string()).optional(), regenerateSshHostKeys: z.boolean().default(true),
    updateFstab: z.boolean().default(true), reinstallBootloader: z.boolean().default(true),
    restartDocker: z.boolean().default(true), restoreDockerVolumes: z.boolean().default(true),
    restartCoolify: z.boolean().default(true), coolifyDashboardUrl: z.string().optional(),
    coolifyApiToken: z.string().optional(), postRestoreCommands: z.array(z.string()).optional(),
  }).optional(),
});

router.get('/restore', requireAuth, async (_req: Request, res: Response) => {
  await connectDB();
  const jobs = await RestoreJob.find({}).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ jobs });
});

router.post('/restore', requireAuth, async (req: Request, res: Response) => {
  const parsed = createRestoreSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }

  await connectDB();
  const snapshot = await CloneSnapshot.findById(parsed.data.snapshotId);
  if (!snapshot) { res.status(404).json({ error: 'Snapshot not found' }); return; }
  if (snapshot.status !== 'completed') { res.status(400).json({ error: 'Snapshot not completed yet' }); return; }

  const job = await RestoreJob.create({
    snapshotId: snapshot._id, sourceAgentId: snapshot.agentId, targetServer: parsed.data.targetServer,
    postRestore: parsed.data.postRestore || {
      regenerateSshHostKeys: true, updateFstab: true, reinstallBootloader: true,
      restartDocker: true, restoreDockerVolumes: true, restartCoolify: true,
    },
  });
  res.json({ ok: true, job });
});

router.get('/restore/:id', requireAuth, async (req: Request, res: Response) => {
  await connectDB();
  const job = await RestoreJob.findById(req.params.id).lean();
  if (!job) { res.status(404).json({ error: 'Not found' }); return; }
  res.json({ job });
});

router.post('/restore/:id', requireAuth, async (req: Request, res: Response) => {
  const action = req.query.action as string;
  if (action !== 'cancel') { res.status(400).json({ error: 'Unknown action' }); return; }

  await connectDB();
  const job = await RestoreJob.findById(req.params.id);
  if (!job) { res.status(404).json({ error: 'Not found' }); return; }
  if (job.status === 'completed' || job.status === 'failed') { res.status(400).json({ error: 'Job already finished' }); return; }

  job.status = 'failed'; job.errorMessage = 'Cancelled by user'; job.completedAt = new Date();
  await job.save();
  res.json({ ok: true });
});

export default router;
