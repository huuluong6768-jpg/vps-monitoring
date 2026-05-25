import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { connectDB, ServerGroup } from '@vps-monitoring/shared';
import { requireAuth } from '../middleware/auth';

const router = Router();

const createSchema = z.object({
  name: z.string().min(1).max(64), description: z.string().max(256).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), icon: z.string().max(32).optional(),
  agentIds: z.array(z.string()).max(500).optional(),
});

router.get('/', requireAuth, async (_req: Request, res: Response) => {
  await connectDB();
  const groups = await ServerGroup.find({}).sort({ name: 1 }).lean();
  res.json({ groups });
});

router.post('/', requireAuth, async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }
  await connectDB();
  const group = await ServerGroup.create(parsed.data);
  res.json({ ok: true, group });
});

router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  await connectDB();
  const group = await ServerGroup.findById(req.params.id).lean();
  if (!group) { res.status(404).json({ error: 'Not found' }); return; }
  res.json({ group });
});

const patchSchema = z.object({
  name: z.string().min(1).max(64).optional(), description: z.string().max(256).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), icon: z.string().max(32).optional(),
  agentIds: z.array(z.string()).max(500).optional(),
  addAgentIds: z.array(z.string()).max(100).optional(), removeAgentIds: z.array(z.string()).max(100).optional(),
});

router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input' }); return; }

  await connectDB();
  const group = await ServerGroup.findById(req.params.id);
  if (!group) { res.status(404).json({ error: 'Not found' }); return; }

  if (parsed.data.name !== undefined) group.name = parsed.data.name;
  if (parsed.data.description !== undefined) group.description = parsed.data.description;
  if (parsed.data.color !== undefined) group.color = parsed.data.color;
  if (parsed.data.icon !== undefined) group.icon = parsed.data.icon;
  if (parsed.data.agentIds !== undefined) group.agentIds = parsed.data.agentIds;
  if (parsed.data.addAgentIds) {
    const set = new Set(group.agentIds);
    for (const id of parsed.data.addAgentIds) set.add(id);
    group.agentIds = Array.from(set);
  }
  if (parsed.data.removeAgentIds) {
    const remove = new Set(parsed.data.removeAgentIds);
    group.agentIds = group.agentIds.filter((id) => !remove.has(id));
  }
  await group.save();
  res.json({ ok: true, group });
});

router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  await connectDB();
  await ServerGroup.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default router;
