import { NextResponse } from 'next/server';
import { z } from 'zod';
import { connectDB } from '@/lib/db';
import { getSessionFromCookies } from '@/lib/auth';
import { ServerGroup } from '@/lib/models/ServerGroup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

export async function GET(_req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  const group = await ServerGroup.findById(params.id).lean();
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ group });
}

const patchSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  description: z.string().max(256).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().max(32).optional(),
  agentIds: z.array(z.string()).max(500).optional(),
  addAgentIds: z.array(z.string()).max(100).optional(),
  removeAgentIds: z.array(z.string()).max(100).optional(),
});

export async function PATCH(req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  await connectDB();
  const group = await ServerGroup.findById(params.id);
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 });

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
  return NextResponse.json({ ok: true, group });
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  await ServerGroup.findByIdAndDelete(params.id);
  return NextResponse.json({ ok: true });
}
