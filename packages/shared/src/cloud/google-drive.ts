import type { ICloudClient, CloudFile, CloudQuota, CloudUploadResult } from './types';

const GOOGLE_API = 'https://www.googleapis.com';
const GOOGLE_OAUTH = 'https://oauth2.googleapis.com';

interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  tokenExpiry?: Date;
  clientId: string;
  clientSecret: string;
}

async function refreshAccessToken(tokens: GoogleTokens): Promise<string> {
  const res = await fetch(`${GOOGLE_OAUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: tokens.clientId,
      client_secret: tokens.clientSecret,
      refresh_token: tokens.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error((data.error_description as string) || 'Failed to refresh token');
  return data.access_token as string;
}

async function ensureAccessToken(tokens: GoogleTokens): Promise<string> {
  if (tokens.tokenExpiry && new Date(tokens.tokenExpiry).getTime() > Date.now() + 60_000) {
    return tokens.accessToken;
  }
  return refreshAccessToken(tokens);
}

export function getGoogleOAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/drive.file',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeGoogleCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const res = await fetch(`${GOOGLE_OAUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error((data.error_description as string) || 'Failed to exchange code');
  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string,
    expiresIn: data.expires_in as number,
  };
}

export class GoogleDriveClient implements ICloudClient {
  private tokens: GoogleTokens;
  private cachedAccessToken: string | null = null;

  constructor(tokens: GoogleTokens) {
    this.tokens = tokens;
  }

  private async getToken(): Promise<string> {
    if (!this.cachedAccessToken) {
      this.cachedAccessToken = await ensureAccessToken(this.tokens);
    }
    return this.cachedAccessToken;
  }

  private async apiGet(path: string): Promise<Response> {
    const token = await this.getToken();
    return fetch(`${GOOGLE_API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  async verify(): Promise<{ ok: boolean; error?: string; quota?: CloudQuota }> {
    try {
      const res = await this.apiGet('/drive/v3/about?fields=storageQuota,user');
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as Record<string, Record<string, string>>;
        return { ok: false, error: err.error?.message || `HTTP ${res.status}` };
      }
      const data = await res.json() as Record<string, Record<string, unknown>>;
      const sq = data.storageQuota;
      return {
        ok: true,
        quota: {
          usedBytes: Number(sq?.usage || 0),
          totalBytes: Number(sq?.limit || 0),
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async createFolder(name: string, parentId?: string): Promise<string> {
    const token = await this.getToken();
    const metadata: Record<string, unknown> = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    };
    if (parentId) metadata.parents = [parentId];

    const res = await fetch(`${GOOGLE_API}/drive/v3/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(metadata),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) throw new Error(((data.error as Record<string, string>)?.message) || 'Failed to create folder');
    return data.id as string;
  }

  async uploadFile(
    name: string,
    data: Buffer | NodeJS.ReadableStream,
    folderId: string,
    mimeType = 'application/octet-stream',
  ): Promise<CloudUploadResult> {
    const token = await this.getToken();
    const metadata = JSON.stringify({ name, parents: [folderId] });
    const boundary = '---vpsmon-upload-boundary---';

    let fileBuffer: Buffer;
    if (Buffer.isBuffer(data)) {
      fileBuffer = data;
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of data) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      fileBuffer = Buffer.concat(chunks);
    }

    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      ),
      fileBuffer,
      Buffer.from(`\r\n--${boundary}--`),
    ]);

    const res = await fetch(
      `${GOOGLE_API}/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,webViewLink`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );
    const result = await res.json() as Record<string, unknown>;
    if (!res.ok) throw new Error(((result.error as Record<string, string>)?.message) || 'Upload failed');
    return {
      fileId: result.id as string,
      name: result.name as string,
      size: Number(result.size || 0),
      webViewLink: result.webViewLink as string | undefined,
    };
  }

  async deleteFile(fileId: string): Promise<void> {
    const token = await this.getToken();
    const res = await fetch(`${GOOGLE_API}/drive/v3/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Delete failed: HTTP ${res.status}`);
    }
  }

  async listFiles(folderId: string): Promise<CloudFile[]> {
    const token = await this.getToken();
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const res = await fetch(
      `${GOOGLE_API}/drive/v3/files?q=${q}&fields=files(id,name,size,mimeType,createdTime)&pageSize=1000`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) throw new Error(((data.error as Record<string, string>)?.message) || 'List failed');
    return ((data.files || []) as Record<string, unknown>[]).map((f: Record<string, unknown>) => ({
      id: f.id as string,
      name: f.name as string,
      size: Number(f.size || 0),
      mimeType: f.mimeType as string,
      createdAt: new Date(f.createdTime as string),
    }));
  }

  async downloadFile(fileId: string): Promise<Buffer> {
    const token = await this.getToken();
    const res = await fetch(`${GOOGLE_API}/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async getQuota(): Promise<CloudQuota> {
    const result = await this.verify();
    return result.quota || { usedBytes: 0, totalBytes: 0 };
  }
}
