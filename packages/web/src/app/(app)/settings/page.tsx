import { SettingsClient } from './SettingsClient';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  const apiUrl = process.env.API_URL || 'http://localhost:4000';
  return (
    <SettingsClient
      appUrl={env.APP_URL}
      apiUrl={apiUrl}
      offlineAfterSeconds={env.AGENT_OFFLINE_AFTER_SECONDS}
    />
  );
}
