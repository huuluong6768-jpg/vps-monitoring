import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { connectDB, User } from '@vps-monitoring/shared';
import { hashPassword, signSession, setSessionCookie } from '../middleware/auth';

const router = Router();

async function querySetupComplete(): Promise<boolean> {
  await connectDB();
  const count = await User.countDocuments({});
  return count > 0;
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const done = await querySetupComplete();
    res.json({ setupComplete: done });
  } catch {
    res.status(503).json({ setupComplete: false, error: 'Database unavailable' });
  }
});

const schema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_.-]+$/, 'Invalid username'),
  password: z.string().min(8).max(128),
});

router.post('/', async (req: Request, res: Response) => {
  let alreadySetup: boolean;
  try { alreadySetup = await querySetupComplete(); } catch {
    res.status(503).json({ error: 'Database unavailable' }); return;
  }
  if (alreadySetup) { res.status(400).json({ error: 'Setup already completed. Admin already exists.' }); return; }

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }

  await connectDB();
  const passwordHash = await hashPassword(parsed.data.password);
  const user = await User.create({ username: parsed.data.username.toLowerCase(), passwordHash, role: 'admin' });

  const token = await signSession({ sub: user._id.toString(), username: user.username, role: 'admin' });
  setSessionCookie(res, token);
  res.json({ ok: true, username: user.username });
});

export default router;
