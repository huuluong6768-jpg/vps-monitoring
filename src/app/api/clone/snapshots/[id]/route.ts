import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionFromCookies } from '@/lib/auth';
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
  const snapshot = await CloneSnapshot.findById(params.id).lean();
  if (!snapshot) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ snapshot });
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  await CloneSnapshot.findByIdAndDelete(params.id);
  return NextResponse.json({ ok: true });
}
