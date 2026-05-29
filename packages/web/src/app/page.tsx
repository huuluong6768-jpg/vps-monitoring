import { redirect } from 'next/navigation';
import { getSessionFromCookies } from '@/lib/auth';
import { isSetupComplete } from '@/lib/setup';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const setup = await isSetupComplete();
  if (!setup) redirect('/setup');

  const session = await getSessionFromCookies();
  if (!session) redirect('/login');

  redirect('/dashboard');
}
