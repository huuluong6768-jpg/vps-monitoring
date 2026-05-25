import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionFromCookies } from '@/lib/auth';
import { env } from '@/lib/env';
import { exchangeGoogleCode } from '@/lib/cloud/google-drive';
import { CloudProvider } from '@/lib/models/CloudProvider';
import { encrypt } from '@/lib/encryption';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.redirect(`${env.APP_URL}/login`);
  }

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error || !code) {
    return NextResponse.redirect(
      `${env.APP_URL}/backups/providers?error=${encodeURIComponent(error || 'No code returned')}`,
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const redirectUri = `${env.APP_URL}/api/cloud/oauth/google/callback`;

  try {
    const tokens = await exchangeGoogleCode(code, clientId, clientSecret, redirectUri);

    await connectDB();
    const provider = await CloudProvider.create({
      name: 'Google Drive',
      type: 'google_drive',
      credentials: {
        accessToken: encrypt(tokens.accessToken),
        refreshToken: encrypt(tokens.refreshToken),
        tokenExpiry: new Date(Date.now() + tokens.expiresIn * 1000),
        clientId: encrypt(clientId),
        clientSecret: encrypt(clientSecret),
      },
      folderPath: '/VPS-Backups',
      status: 'connected',
      lastVerifiedAt: new Date(),
    });

    return NextResponse.redirect(
      `${env.APP_URL}/backups/providers?success=google_drive&id=${provider._id}`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'OAuth failed';
    return NextResponse.redirect(
      `${env.APP_URL}/backups/providers?error=${encodeURIComponent(msg)}`,
    );
  }
}
