import { ServerDetailClient } from './ServerDetailClient';

export const dynamic = 'force-dynamic';

export default function ServerDetailPage({ params }: { params: { agentId: string } }) {
  return <ServerDetailClient agentId={params.agentId} />;
}
