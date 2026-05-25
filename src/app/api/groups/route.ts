import { NextResponse } from 'next/server';
import { z } from 'zod';
import { connectDB } from '@/lib/db';
import { getSessionFromCookies } from '@/lib/auth';
import { ServerGroup } from '@/lib/models/ServerGroup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(256).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().max(32).optional(),
  agentIds: z.array(z.string()).max(500).optional(),
});

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  const groups = await ServerGroup.find({}).sort({ name: 1 }).lean();
  return NextResponse.json({ groups });
}

export async function POST(req: Request) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
  }

  await connectDB();
  const group = await ServerGroup.create(parsed.data);
  return NextResponse.json({ ok: true, group });
}
