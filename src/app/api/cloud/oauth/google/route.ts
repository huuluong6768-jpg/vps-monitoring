import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { env } from '@/lib/env';
import { getGoogleOAuthUrl } from '@/lib/cloud/google-drive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: 'GOOGLE_CLIENT_ID not configured' },
      { status: 500 },
    );
  }

  const redirectUri = `${env.APP_URL}/api/cloud/oauth/google/callback`;
  const state = Buffer.from(JSON.stringify({ ts: Date.now() })).toString('base64url');
  const url = getGoogleOAuthUrl(clientId, redirectUri, state);

  return NextResponse.json({ url });
}
