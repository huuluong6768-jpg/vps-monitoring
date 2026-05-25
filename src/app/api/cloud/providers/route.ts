import { NextResponse } from 'next/server';
import { z } from 'zod';
import { connectDB } from '@/lib/db';
import { getSessionFromCookies } from '@/lib/auth';
import { CloudProvider } from '@/lib/models/CloudProvider';
import { encrypt } from '@/lib/encryption';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['google_drive', 'pcloud', 'onedrive', 's3']),
  folderPath: z.string().max(500).optional(),
  credentials: z
    .object({
      s3AccessKey: z.string().optional(),
      s3SecretKey: z.string().optional(),
      s3Bucket: z.string().optional(),
      s3Region: z.string().optional(),
      s3Endpoint: z.string().optional(),
    })
    .optional(),
});

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  const providers = await CloudProvider.find({}).sort({ createdAt: -1 }).lean();

  const safe = providers.map((p) => ({
    _id: p._id,
    name: p.name,
    type: p.type,
    folderPath: p.folderPath,
    status: p.status,
    lastVerifiedAt: p.lastVerifiedAt,
    usedBytes: p.usedBytes,
    totalBytes: p.totalBytes,
    hasCredentials: Boolean(
      p.credentials?.accessToken ||
        p.credentials?.refreshToken ||
        p.credentials?.s3AccessKey ||
        p.credentials?.pcloudToken ||
        p.credentials?.msAccessToken,
    ),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }));

  return NextResponse.json({ providers: safe });
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

  const creds: Record<string, string | undefined> = {};
  if (parsed.data.type === 's3' && parsed.data.credentials) {
    const c = parsed.data.credentials;
    if (c.s3AccessKey) creds.s3AccessKey = encrypt(c.s3AccessKey);
    if (c.s3SecretKey) creds.s3SecretKey = encrypt(c.s3SecretKey);
    creds.s3Bucket = c.s3Bucket;
    creds.s3Region = c.s3Region;
    creds.s3Endpoint = c.s3Endpoint;
  }

  const provider = await CloudProvider.create({
    name: parsed.data.name,
    type: parsed.data.type,
    folderPath: parsed.data.folderPath || '/VPS-Backups',
    credentials: creds,
    status: parsed.data.type === 's3' ? 'connected' : 'disconnected',
  });

  return NextResponse.json({
    ok: true,
    provider: {
      _id: provider._id,
      name: provider.name,
      type: provider.type,
      status: provider.status,
    },
  });
}
