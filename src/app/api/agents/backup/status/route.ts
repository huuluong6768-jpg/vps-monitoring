import { NextResponse } from 'next/server';
import { z } from 'zod';
import { connectDB } from '@/lib/db';
import { Agent } from '@/lib/models/Agent';
import { CloneSnapshot } from '@/lib/models/CloneSnapshot';
import { ServerCloneConfig } from '@/lib/models/ServerCloneConfig';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  agentId: z.string().min(1),
  token: z.string().min(1),
  snapshotId: z.string().min(1),
  status: z.string(),
  progress: z.number().min(0).max(100),
  message: z.string().optional(),
  totalSizeBytes: z.number().optional(),
  originalSizeBytes: z.number().optional(),
  serverMeta: z.record(z.string()).optional(),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  await connectDB();

  const agent = await Agent.findOne({
    agentId: parsed.data.agentId,
    token: parsed.data.token,
  });
  if (!agent) {
    return NextResponse.json({ error: 'Unknown agent' }, { status: 401 });
  }

  const snapshot = await CloneSnapshot.findById(parsed.data.snapshotId);
  if (!snapshot || snapshot.agentId !== parsed.data.agentId) {
    return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 });
  }

  snapshot.status = parsed.data.status as typeof snapshot.status;
  snapshot.progress = parsed.data.progress;
  if (parsed.data.message) {
    snapshot.logs.push(`[${new Date().toISOString()}] ${parsed.data.message}`);
  }
  if (parsed.data.totalSizeBytes) snapshot.totalSizeBytes = parsed.data.totalSizeBytes;
  if (parsed.data.originalSizeBytes) snapshot.originalSizeBytes = parsed.data.originalSizeBytes;
  if (parsed.data.serverMeta) {
    Object.assign(snapshot.serverMeta, parsed.data.serverMeta);
  }

  if (parsed.data.status === 'completed') {
    snapshot.completedAt = new Date();
    snapshot.duration = Math.round(
      (snapshot.completedAt.getTime() - snapshot.startedAt.getTime()) / 1000,
    );
    if (snapshot.originalSizeBytes && snapshot.totalSizeBytes) {
      snapshot.compressionRatio = snapshot.totalSizeBytes / snapshot.originalSizeBytes;
    }

    await ServerCloneConfig.findByIdAndUpdate(snapshot.configId, {
      $set:
        snapshot.type === 'full_image'
          ? { lastFullImageAt: new Date(), lastFullImageSize: snapshot.totalSizeBytes }
          : { lastRsyncAt: new Date(), lastRsyncSize: snapshot.totalSizeBytes },
    });
  }

  if (parsed.data.status === 'failed') {
    snapshot.completedAt = new Date();
    snapshot.errorMessage = parsed.data.message;
  }

  await snapshot.save();

  return NextResponse.json({ ok: true });
}
