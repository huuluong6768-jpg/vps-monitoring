import { NextResponse } from 'next/server';
import { z } from 'zod';
import { connectDB } from '@/lib/db';
import { getSessionFromCookies } from '@/lib/auth';
import { CloudProvider } from '@/lib/models/CloudProvider';
import { createCloudClient } from '@/lib/cloud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

export async function GET(_req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  const provider = await CloudProvider.findById(params.id).lean();
  if (!provider) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    provider: {
      _id: provider._id,
      name: provider.name,
      type: provider.type,
      folderPath: provider.folderPath,
      status: provider.status,
      lastVerifiedAt: provider.lastVerifiedAt,
      usedBytes: provider.usedBytes,
      totalBytes: provider.totalBytes,
      createdAt: provider.createdAt,
    },
  });
}

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  folderPath: z.string().max(500).optional(),
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
  const provider = await CloudProvider.findByIdAndUpdate(params.id, { $set: parsed.data }, { new: true });
  if (!provider) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  await CloudProvider.findByIdAndDelete(params.id);
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  if (action !== 'verify') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  await connectDB();
  const provider = await CloudProvider.findById(params.id);
  if (!provider) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    const client = createCloudClient(provider);
    const result = await client.verify();

    if (result.ok) {
      provider.status = 'connected';
      provider.lastVerifiedAt = new Date();
      if (result.quota) {
        provider.usedBytes = result.quota.usedBytes;
        provider.totalBytes = result.quota.totalBytes;
      }
    } else {
      provider.status = 'error';
    }
    await provider.save();

    return NextResponse.json({ ok: result.ok, error: result.error, quota: result.quota });
  } catch (e) {
    provider.status = 'error';
    await provider.save();
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Verification failed' },
      { status: 500 },
    );
  }
}
