import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionFromCookies } from '@/lib/auth';
import { RestoreJob } from '@/lib/models/RestoreJob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

export async function GET(_req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  const job = await RestoreJob.findById(params.id).lean();
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ job });
}

export async function POST(req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  if (action !== 'cancel') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  await connectDB();
  const job = await RestoreJob.findById(params.id);
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (job.status === 'completed' || job.status === 'failed') {
    return NextResponse.json({ error: 'Job already finished' }, { status: 400 });
  }

  job.status = 'failed';
  job.errorMessage = 'Cancelled by user';
  job.completedAt = new Date();
  await job.save();

  return NextResponse.json({ ok: true });
}
