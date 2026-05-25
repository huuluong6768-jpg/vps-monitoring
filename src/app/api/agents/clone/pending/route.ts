import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { Agent } from '@/lib/models/Agent';
import { CloneSnapshot } from '@/lib/models/CloneSnapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const agentId = url.searchParams.get('agentId');
  const token = url.searchParams.get('token');

  if (!agentId || !token) {
    return NextResponse.json({ error: 'Missing agentId or token' }, { status: 400 });
  }

  await connectDB();
  const agent = await Agent.findOne({ agentId, token });
  if (!agent) {
    return NextResponse.json({ error: 'Unknown agent or invalid token' }, { status: 401 });
  }

  const pendingSnapshots = await CloneSnapshot.find({
    agentId,
    status: 'pending',
  })
    .sort({ createdAt: 1 })
    .limit(1)
    .lean();

  return NextResponse.json({
    tasks: pendingSnapshots.map((s) => ({
      snapshotId: s._id,
      type: s.type,
      configId: s.configId,
    })),
  });
}
