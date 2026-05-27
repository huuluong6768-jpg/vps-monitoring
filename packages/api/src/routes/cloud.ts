import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  connectDB, env, CloudProvider, encrypt, createCloudClient,
  getGoogleOAuthUrl, exchangeGoogleCode,
} from '@vps-monitoring/shared';
import { requireAuth } from '../middleware/auth';

const router = Router();

// --- List providers ---
router.get('/providers', requireAuth, async (_req: Request, res: Response) => {
  await connectDB();
  const providers = await CloudProvider.find({}).sort({ createdAt: -1 }).lean();
  const safe = providers.map((p) => ({
    _id: p._id, name: p.name, type: p.type, folderPath: p.folderPath, status: p.status,
    lastVerifiedAt: p.lastVerifiedAt, usedBytes: p.usedBytes, totalBytes: p.totalBytes,
    hasCredentials: Boolean(p.credentials?.accessToken || p.credentials?.refreshToken || p.credentials?.s3AccessKey || p.credentials?.pcloudToken || p.credentials?.msAccessToken),
    createdAt: p.createdAt, updatedAt: p.updatedAt,
  }));
  res.json({ providers: safe });
});

// --- Create provider ---
const createSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['google_drive', 'pcloud', 'onedrive', 's3']),
  folderPath: z.string().max(500).optional(),
  credentials: z.object({
    s3AccessKey: z.string().optional(), s3SecretKey: z.string().optional(), s3Bucket: z.string().optional(),
    s3Region: z.string().optional(), s3Endpoint: z.string().optional(),
    pcloudToken: z.string().optional(), pcloudUseEU: z.boolean().optional(),
  }).optional(),
});

router.post('/providers', requireAuth, async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }

  await connectDB();
  const creds: Record<string, string | undefined> = {};
  if (parsed.data.type === 's3' && parsed.data.credentials) {
    const c = parsed.data.credentials;
    if (c.s3AccessKey) creds.s3AccessKey = encrypt(c.s3AccessKey);
    if (c.s3SecretKey) creds.s3SecretKey = encrypt(c.s3SecretKey);
    creds.s3Bucket = c.s3Bucket; creds.s3Region = c.s3Region; creds.s3Endpoint = c.s3Endpoint;
  }
  if (parsed.data.type === 'pcloud' && parsed.data.credentials) {
    const c = parsed.data.credentials;
    if (c.pcloudToken) creds.pcloudToken = encrypt(c.pcloudToken);
    creds.pcloudUseEU = c.pcloudUseEU ? 'true' : 'false';
  }

  const provider = await CloudProvider.create({
    name: parsed.data.name, type: parsed.data.type,
    folderPath: parsed.data.folderPath || '/VPS-Backups', credentials: creds,
    status: (parsed.data.type === 's3' || parsed.data.type === 'pcloud') ? 'connected' : 'disconnected',
  });
  res.json({ ok: true, provider: { _id: provider._id, name: provider.name, type: provider.type, status: provider.status } });
});

// --- Single provider GET/PATCH/DELETE/verify ---
router.get('/providers/:id', requireAuth, async (req: Request, res: Response) => {
  await connectDB();
  const provider = await CloudProvider.findById(req.params.id).lean();
  if (!provider) { res.status(404).json({ error: 'Not found' }); return; }
  res.json({
    provider: { _id: provider._id, name: provider.name, type: provider.type, folderPath: provider.folderPath, status: provider.status, lastVerifiedAt: provider.lastVerifiedAt, usedBytes: provider.usedBytes, totalBytes: provider.totalBytes, createdAt: provider.createdAt },
  });
});

const patchProviderSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  folderPath: z.string().max(500).optional(),
});

router.patch('/providers/:id', requireAuth, async (req: Request, res: Response) => {
  const parsed = patchProviderSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input' }); return; }

  await connectDB();
  const provider = await CloudProvider.findByIdAndUpdate(req.params.id, { $set: parsed.data }, { new: true });
  if (!provider) { res.status(404).json({ error: 'Not found' }); return; }
  res.json({ ok: true });
});

router.delete('/providers/:id', requireAuth, async (req: Request, res: Response) => {
  await connectDB();
  await CloudProvider.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

router.post('/providers/:id', requireAuth, async (req: Request, res: Response) => {
  const action = req.query.action as string;
  if (action !== 'verify') { res.status(400).json({ error: 'Unknown action' }); return; }

  await connectDB();
  const provider = await CloudProvider.findById(req.params.id);
  if (!provider) { res.status(404).json({ error: 'Not found' }); return; }

  try {
    const client = createCloudClient(provider);
    const result = await client.verify();
    if (result.ok) {
      provider.status = 'connected'; provider.lastVerifiedAt = new Date();
      if (result.quota) { provider.usedBytes = result.quota.usedBytes; provider.totalBytes = result.quota.totalBytes; }
    } else { provider.status = 'error'; }
    await provider.save();
    res.json({ ok: result.ok, error: result.error, quota: result.quota });
  } catch (e) {
    provider.status = 'error'; await provider.save();
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'Verification failed' });
  }
});

// --- Google OAuth ---
router.get('/oauth/google', requireAuth, async (_req: Request, res: Response) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) { res.status(500).json({ error: 'GOOGLE_CLIENT_ID not configured' }); return; }

  const redirectUri = `${env.APP_URL}/api/cloud/oauth/google/callback`;
  const state = Buffer.from(JSON.stringify({ ts: Date.now() })).toString('base64url');
  const url = getGoogleOAuthUrl(clientId, redirectUri, state);
  res.json({ url });
});

router.get('/oauth/google/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const error = req.query.error as string;

  if (error || !code) {
    res.redirect(`${env.APP_URL}/backups/providers?error=${encodeURIComponent(error || 'No code returned')}`);
    return;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const redirectUri = `${env.APP_URL}/api/cloud/oauth/google/callback`;

  try {
    const tokens = await exchangeGoogleCode(code, clientId, clientSecret, redirectUri);
    await connectDB();
    const provider = await CloudProvider.create({
      name: 'Google Drive', type: 'google_drive',
      credentials: {
        accessToken: encrypt(tokens.accessToken), refreshToken: encrypt(tokens.refreshToken),
        tokenExpiry: new Date(Date.now() + tokens.expiresIn * 1000),
        clientId: encrypt(clientId), clientSecret: encrypt(clientSecret),
      },
      folderPath: '/VPS-Backups', status: 'connected', lastVerifiedAt: new Date(),
    });
    res.redirect(`${env.APP_URL}/backups/providers?success=google_drive&id=${provider._id}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'OAuth failed';
    res.redirect(`${env.APP_URL}/backups/providers?error=${encodeURIComponent(msg)}`);
  }
});

export default router;
