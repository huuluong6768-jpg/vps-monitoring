import { NextResponse } from 'next/server';
import { z } from 'zod';
import { connectDB } from '@/lib/db';
import { getSessionFromCookies } from '@/lib/auth';
import { ServerCloneConfig } from '@/lib/models/ServerCloneConfig';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  agentId: z.string().min(1),
  providerId: z.string().min(1),
  remotePath: z.string().max(500).optional(),
  modes: z.object({
    fullImage: z.object({
      enabled: z.boolean().default(false),
      schedule: z.string().max(100).optional(),
      compression: z.enum(['gzip', 'pigz', 'zstd']).default('pigz'),
      compressionLevel: z.number().int().min(1).max(9).default(1),
    }).optional(),
    rsyncDaily: z.object({
      enabled: z.boolean().default(true),
      schedule: z.string().max(100).default('0 2 * * *'),
      excludePaths: z.array(z.string()).optional(),
      syncDockerVolumes: z.boolean().default(true),
      preBackupDatabaseDumps: z.array(z.object({
        type: z.enum(['mysql', 'postgresql', 'mongodb']),
        containerName: z.string().optional(),
        connectionString: z.string().optional(),
        dumpPath: z.string(),
      })).optional(),
    }).optional(),
  }).optional(),
  retention: z.object({
    fullImageKeep: z.number().int().min(1).max(100).default(3),
    rsyncKeep: z.number().int().min(1).max(365).default(14),
  }).optional(),
  notifyOnSuccess: z.boolean().default(true),
  notifyOnFailure: z.boolean().default(true),
});

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  const configs = await ServerCloneConfig.find({}).sort({ createdAt: -1 }).lean();
  return NextResponse.json({ configs });
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

  const existing = await ServerCloneConfig.findOne({ agentId: parsed.data.agentId });
  if (existing) {
    return NextResponse.json({ error: 'Clone config already exists for this server' }, { status: 409 });
  }

  const config = await ServerCloneConfig.create({
    agentId: parsed.data.agentId,
    providerId: parsed.data.providerId,
    remotePath: parsed.data.remotePath || '/server-clones/',
    modes: parsed.data.modes,
    retention: parsed.data.retention,
    notifyOnSuccess: parsed.data.notifyOnSuccess,
    notifyOnFailure: parsed.data.notifyOnFailure,
  });

  return NextResponse.json({ ok: true, config });
}
