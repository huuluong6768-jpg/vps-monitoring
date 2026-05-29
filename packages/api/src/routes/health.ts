import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { connectDB } from '@vps-monitoring/shared';

const router = Router();

const startedAt = Date.now();

router.options('/', (_req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});

router.get('/', (_req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({
    ok: true,
    service: 'vps-monitoring-api',
    version: '1.0.0',
    uptime: Math.round((Date.now() - startedAt) / 1000),
    port: Number(process.env.API_PORT || 4000),
  });
});

function safeErr(err: unknown): { name: string; code?: number; message: string } {
  if (!err || typeof err !== 'object') return { name: 'Error', message: 'Unknown error' };
  const e = err as { name?: string; message?: string; code?: number };
  let msg = String(e.message ?? 'error');
  msg = msg.replace(/\/\/([^:@/]+):([^@/]+)@/g, '//***:***@');
  return { name: String(e.name ?? 'Error'), code: typeof e.code === 'number' ? e.code : undefined, message: msg.slice(0, 800) };
}

router.get('/db', async (_req: Request, res: Response) => {
  try {
    await connectDB();
    await mongoose.connection.db!.admin().command({ ping: 1 });
    res.json({ ok: true, database: mongoose.connection.db?.databaseName ?? null });
  } catch (err) {
    const s = safeErr(err);
    const authHint = /authentication|auth failed|bad auth/i.test(s.message) || s.code === 18
      ? 'Often fixed by appending ?authSource=admin (or the database where this user was created) to MONGODB_URI.'
      : undefined;
    res.status(503).json({ ok: false, error: s, hint: authHint });
  }
});

export default router;
