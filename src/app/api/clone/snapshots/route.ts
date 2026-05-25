import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionFromCookies } from '@/lib/auth';
import { CloneSnapshot } from '@/lib/models/CloneSnapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const agentId = url.searchParams.get('agentId');
  const page = Math.max(1, Number(url.searchParams.get('page') || 1));
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 20)));

  await connectDB();

  const filter: Record<string, unknown> = {};
  if (agentId) filter.agentId = agentId;

  const [snapshots, total] = await Promise.all([
    CloneSnapshot.find(filter)
      .sort({ startedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    CloneSnapshot.countDocuments(filter),
  ]);

  return NextResponse.json({
    snapshots,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}
