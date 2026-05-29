import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { connectDB, Renewal } from '@vps-monitoring/shared';
import { requireAuth } from '../middleware/auth';

const router = Router();

const createSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['vps', 'domain', 'ssl', 'license', 'other']),
  agentId: z.string().max(64).optional(),
  provider: z.string().max(200).optional(),
  cost: z.number().min(0).optional(),
  currency: z.string().max(10).optional(),
  expiryDate: z.string().refine((s) => !isNaN(Date.parse(s)), { message: 'Invalid date' }),
  reminderDays: z.array(z.number().int().min(0).max(365)).max(10).optional(),
  notes: z.string().max(1000).optional(),
});

router.get('/', requireAuth, async (req: Request, res: Response) => {
  await connectDB();
  const filter: Record<string, unknown> = {};
  if (req.query.active === 'true') filter.isActive = true;
  if (req.query.type) filter.type = req.query.type;
  if (req.query.agentId) filter.agentId = req.query.agentId;
  const renewals = await Renewal.find(filter).sort({ expiryDate: 1 }).lean();
  res.json({ renewals });
});

router.get('/upcoming', requireAuth, async (_req: Request, res: Response) => {
  await connectDB();
  const now = new Date();
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const renewals = await Renewal.find({
    isActive: true,
    expiryDate: { $lte: thirtyDaysLater },
  }).sort({ expiryDate: 1 }).lean();
  res.json({ renewals });
});

router.post('/', requireAuth, async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }
  await connectDB();
  const renewal = await Renewal.create({
    ...parsed.data,
    expiryDate: new Date(parsed.data.expiryDate),
    reminderDays: parsed.data.reminderDays || [30, 7, 3, 1],
  });
  res.json({ ok: true, renewal });
});

router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  await connectDB();
  const renewal = await Renewal.findById(req.params.id).lean();
  if (!renewal) { res.status(404).json({ error: 'Not found' }); return; }
  res.json({ renewal });
});

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: z.enum(['vps', 'domain', 'ssl', 'license', 'other']).optional(),
  agentId: z.string().max(64).optional().nullable(),
  provider: z.string().max(200).optional(),
  cost: z.number().min(0).optional().nullable(),
  currency: z.string().max(10).optional(),
  expiryDate: z.string().refine((s) => !isNaN(Date.parse(s)), { message: 'Invalid date' }).optional(),
  reminderDays: z.array(z.number().int().min(0).max(365)).max(10).optional(),
  notes: z.string().max(1000).optional(),
  isActive: z.boolean().optional(),
});

router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input' }); return; }
  await connectDB();
  const renewal = await Renewal.findById(req.params.id);
  if (!renewal) { res.status(404).json({ error: 'Not found' }); return; }

  const data = parsed.data;
  if (data.name !== undefined) renewal.name = data.name;
  if (data.type !== undefined) renewal.type = data.type;
  if (data.agentId !== undefined) renewal.agentId = data.agentId ?? undefined;
  if (data.provider !== undefined) renewal.provider = data.provider;
  if (data.cost !== undefined) renewal.cost = data.cost ?? undefined;
  if (data.currency !== undefined) renewal.currency = data.currency;
  if (data.expiryDate !== undefined) renewal.expiryDate = new Date(data.expiryDate);
  if (data.reminderDays !== undefined) renewal.reminderDays = data.reminderDays;
  if (data.notes !== undefined) renewal.notes = data.notes;
  if (data.isActive !== undefined) renewal.isActive = data.isActive;

  // Reset notification state when expiry date changes
  if (data.expiryDate !== undefined) {
    renewal.lastNotifiedAt = undefined;
    renewal.lastNotifiedDaysBefore = undefined;
  }

  await renewal.save();
  res.json({ ok: true, renewal });
});

router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  await connectDB();
  await Renewal.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default router;
