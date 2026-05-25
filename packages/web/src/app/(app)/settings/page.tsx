import { SettingsClient } from './SettingsClient';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  return (
    <SettingsClient
      appUrl={env.APP_URL}
      offlineAfterSeconds={env.AGENT_OFFLINE_AFTER_SECONDS}
    />
  );
}
