import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { connectDB, User } from '@vps-monitoring/shared';
import {
  verifyPassword, signSession, setSessionCookie, clearSessionCookie, hashPassword,
  getSessionFromRequest, requireAuth, SessionPayload,
} from '../middleware/auth';

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(256),
});

router.post('/login', async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input' }); return; }

  await connectDB();
  const user = await User.findOne({ username: parsed.data.username.toLowerCase() });
  if (!user) { res.status(401).json({ error: 'Invalid credentials' }); return; }

  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) { res.status(401).json({ error: 'Invalid credentials' }); return; }

  const token = await signSession({ sub: user._id.toString(), username: user.username, role: 'admin' });
  setSessionCookie(res, token);
  res.json({ ok: true, username: user.username });
});

router.post('/logout', (_req: Request, res: Response) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', async (req: Request, res: Response) => {
  const session = await getSessionFromRequest(req);
  if (!session) { res.status(401).json({ user: null }); return; }
  res.json({ user: { username: session.username, role: session.role } });
});

const passwordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

router.post('/password', requireAuth, async (req: Request, res: Response) => {
  const session = (req as Request & { session: SessionPayload }).session;
  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input' }); return; }

  await connectDB();
  const user = await User.findById(session.sub);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  const ok = await verifyPassword(parsed.data.oldPassword, user.passwordHash);
  if (!ok) { res.status(400).json({ error: 'Current password is incorrect' }); return; }

  user.passwordHash = await hashPassword(parsed.data.newPassword);
  await user.save();
  res.json({ ok: true });
});

export default router;
