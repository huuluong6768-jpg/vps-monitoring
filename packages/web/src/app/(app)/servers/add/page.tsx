import { AddServerClient } from './AddServerClient';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default function AddServerPage() {
  return <AddServerClient appUrl={env.APP_URL} />;
}
