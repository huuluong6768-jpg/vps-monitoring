import { NextResponse } from 'next/server';
import { z } from 'zod';
import { connectDB } from '@/lib/db';
import { getSessionFromCookies } from '@/lib/auth';
import { RestoreJob } from '@/lib/models/RestoreJob';
import { CloneSnapshot } from '@/lib/models/CloneSnapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  snapshotId: z.string().min(1),
  targetServer: z.object({
    ip: z.string().min(1),
    port: z.number().int().min(1).max(65535).default(22),
    username: z.string().default('root'),
    sshPrivateKey: z.string().optional(),
    password: z.string().optional(),
  }),
  postRestore: z.object({
    newHostname: z.string().optional(),
    newIp: z.string().optional(),
    newGateway: z.string().optional(),
    newDns: z.array(z.string()).optional(),
    regenerateSshHostKeys: z.boolean().default(true),
    updateFstab: z.boolean().default(true),
    reinstallBootloader: z.boolean().default(true),
    restartDocker: z.boolean().default(true),
    restoreDockerVolumes: z.boolean().default(true),
    restartCoolify: z.boolean().default(true),
    coolifyDashboardUrl: z.string().optional(),
    coolifyApiToken: z.string().optional(),
    postRestoreCommands: z.array(z.string()).optional(),
  }).optional(),
});

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  const jobs = await RestoreJob.find({}).sort({ createdAt: -1 }).limit(50).lean();
  return NextResponse.json({ jobs });
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

  const snapshot = await CloneSnapshot.findById(parsed.data.snapshotId);
  if (!snapshot) return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 });
  if (snapshot.status !== 'completed') {
    return NextResponse.json({ error: 'Snapshot not completed yet' }, { status: 400 });
  }

  const job = await RestoreJob.create({
    snapshotId: snapshot._id,
    sourceAgentId: snapshot.agentId,
    targetServer: parsed.data.targetServer,
    postRestore: parsed.data.postRestore || {
      regenerateSshHostKeys: true,
      updateFstab: true,
      reinstallBootloader: true,
      restartDocker: true,
      restoreDockerVolumes: true,
      restartCoolify: true,
    },
  });

  return NextResponse.json({ ok: true, job });
}
