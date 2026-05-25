import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { Agent } from '@/lib/models/Agent';
import { CloneSnapshot } from '@/lib/models/CloneSnapshot';
import { ServerCloneConfig } from '@/lib/models/ServerCloneConfig';
import { CloudProvider } from '@/lib/models/CloudProvider';
import { createCloudClient } from '@/lib/cloud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const agentId = req.headers.get('x-agent-id');
  const token = req.headers.get('x-agent-token');
  const snapshotId = req.headers.get('x-snapshot-id');
  const chunkIndex = req.headers.get('x-chunk-index');
  const chunkChecksum = req.headers.get('x-chunk-checksum') || '';
  const chunkSize = Number(req.headers.get('x-chunk-size') || 0);

  if (!agentId || !token || !snapshotId) {
    return NextResponse.json({ error: 'Missing headers' }, { status: 400 });
  }

  await connectDB();

  const agent = await Agent.findOne({ agentId, token });
  if (!agent) {
    return NextResponse.json({ error: 'Unknown agent' }, { status: 401 });
  }

  const snapshot = await CloneSnapshot.findById(snapshotId);
  if (!snapshot || snapshot.agentId !== agentId) {
    return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 });
  }

  const config = await ServerCloneConfig.findById(snapshot.configId);
  if (!config) {
    return NextResponse.json({ error: 'Config not found' }, { status: 404 });
  }

  const provider = await CloudProvider.findById(config.providerId);
  if (!provider) {
    return NextResponse.json({ error: 'Cloud provider not found' }, { status: 404 });
  }

  try {
    const client = createCloudClient(provider);

    const fileData = Buffer.from(await req.arrayBuffer());

    const folderPath = `${config.remotePath}${agent.hostname || agentId}`;
    let folderId = provider.folderId || '';
    if (!folderId) {
      folderId = await client.createFolder(folderPath);
      provider.folderId = folderId;
      await provider.save();
    }

    const fileName = chunkIndex === 'metadata'
      ? `${snapshot._id}_metadata.tar.gz`
      : chunkIndex === 'checksums'
        ? `${snapshot._id}_checksums.sha256`
        : `${snapshot._id}_chunk_${chunkIndex}`;

    const result = await client.uploadFile(fileName, fileData, folderId);

    if (chunkIndex !== 'metadata' && chunkIndex !== 'checksums') {
      snapshot.chunks.push({
        index: Number(chunkIndex),
        remoteFileId: result.fileId,
        remotePath: result.name,
        sizeBytes: chunkSize || fileData.length,
        checksum: chunkChecksum,
        uploaded: true,
      });
    }

    snapshot.status = 'uploading';
    await snapshot.save();

    return NextResponse.json({ ok: true, fileId: result.fileId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Upload failed';
    snapshot.status = 'failed';
    snapshot.errorMessage = msg;
    await snapshot.save();
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
