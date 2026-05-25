import { NextResponse } from 'next/server';
import { z } from 'zod';
import { connectDB } from '@/lib/db';
import { getSessionFromCookies } from '@/lib/auth';
import { ServerCloneConfig } from '@/lib/models/ServerCloneConfig';
import { CloneSnapshot } from '@/lib/models/CloneSnapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

export async function GET(_req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  const config = await ServerCloneConfig.findById(params.id).lean();
  if (!config) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ config });
}

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  remotePath: z.string().max(500).optional(),
  notifyOnSuccess: z.boolean().optional(),
  notifyOnFailure: z.boolean().optional(),
  modes: z.object({
    fullImage: z.object({
      enabled: z.boolean().optional(),
      schedule: z.string().max(100).optional(),
      compression: z.enum(['gzip', 'pigz', 'zstd']).optional(),
      compressionLevel: z.number().int().min(1).max(9).optional(),
    }).optional(),
    rsyncDaily: z.object({
      enabled: z.boolean().optional(),
      schedule: z.string().max(100).optional(),
      syncDockerVolumes: z.boolean().optional(),
    }).optional(),
  }).optional(),
  retention: z.object({
    fullImageKeep: z.number().int().min(1).max(100).optional(),
    rsyncKeep: z.number().int().min(1).max(365).optional(),
  }).optional(),
}).partial();

export async function PATCH(req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  await connectDB();
  const config = await ServerCloneConfig.findById(params.id);
  if (!config) return NextResponse.json({ error: 'Not found' }, { status: 404 });

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
  return NextResponse.json({ ok: true, config });
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  const config = await ServerCloneConfig.findById(params.id);
  if (!config) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await CloneSnapshot.deleteMany({ configId: config._id });
  await config.deleteOne();
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  if (action !== 'trigger') {
    return NextResponse.json({ error: 'Unknown action. Use ?action=trigger' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const snapshotType = (body as Record<string, string>).type || 'rsync_full';

  await connectDB();
  const config = await ServerCloneConfig.findById(params.id);
  if (!config) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const snapshot = await CloneSnapshot.create({
    agentId: config.agentId,
    configId: config._id,
    type: snapshotType,
    status: 'pending',
    serverMeta: {},
  });

  return NextResponse.json({ ok: true, snapshot });
}
