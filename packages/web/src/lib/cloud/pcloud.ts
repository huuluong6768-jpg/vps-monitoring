import type { ICloudClient, CloudFile, CloudQuota, CloudUploadResult } from './types';

const API_BASE = 'https://api.pcloud.com';
const EU_API_BASE = 'https://eapi.pcloud.com';

interface PCloudConfig {
  accessToken: string;
  useEU?: boolean;
}

function getBase(config: PCloudConfig): string {
  return config.useEU ? EU_API_BASE : API_BASE;
}

export class PCloudClient implements ICloudClient {
  private config: PCloudConfig;

  constructor(config: PCloudConfig) {
    this.config = config;
  }

  private async api(method: string, params: Record<string, string> = {}): Promise<Record<string, unknown>> {
    const base = getBase(this.config);
    const query = new URLSearchParams({
      ...params,
      access_token: this.config.accessToken,
    });
    const res = await fetch(`${base}/${method}?${query}`);
    return res.json() as Promise<Record<string, unknown>>;
  }

  async verify(): Promise<{ ok: boolean; error?: string; quota?: CloudQuota }> {
    try {
      const data = await this.api('userinfo');
      if (data.result !== 0) {
        return { ok: false, error: (data.error as string) || `pCloud error ${data.result}` };
      }
      return {
        ok: true,
        quota: {
          usedBytes: (data.usedquota as number) || 0,
          totalBytes: (data.quota as number) || 0,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async createFolder(name: string, parentId?: string): Promise<string> {
    const data = await this.api('createfolderifnotexists', {
      folderid: parentId || '0',
      name,
    });
    if (data.result !== 0) throw new Error((data.error as string) || 'Failed to create folder');
    const meta = data.metadata as Record<string, unknown>;
    return String(meta.folderid);
  }

  async uploadFile(
    name: string,
    data: Buffer | NodeJS.ReadableStream,
    folderId: string,
    _mimeType = 'application/octet-stream',
  ): Promise<CloudUploadResult> {
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

    const base = getBase(this.config);
    const query = new URLSearchParams({
      access_token: this.config.accessToken,
      folderid: folderId || '0',
      filename: name,
      nopartial: '1',
    });

    const res = await fetch(`${base}/uploadfile?${query}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: fileBuffer,
    });

    const json = (await res.json()) as Record<string, unknown>;
    if (json.result !== 0) throw new Error((json.error as string) || 'Upload failed');

    const metadata = (json.metadata as Record<string, unknown>[]) || [];
    const file = metadata[0] || {};
    return {
      fileId: String(file.fileid || ''),
      name,
      size: fileBuffer.length,
    };
  }

  async deleteFile(fileId: string): Promise<void> {
    const data = await this.api('deletefile', { fileid: fileId });
    if (data.result !== 0) throw new Error((data.error as string) || 'Delete failed');
  }

  async listFiles(folderId: string): Promise<CloudFile[]> {
    const data = await this.api('listfolder', { folderid: folderId || '0' });
    if (data.result !== 0) return [];

    const meta = data.metadata as Record<string, unknown>;
    const contents = (meta.contents as Record<string, unknown>[]) || [];
    return contents
      .filter((c) => !c.isfolder)
      .map((c) => ({
        id: String(c.fileid),
        name: String(c.name),
        size: (c.size as number) || 0,
        mimeType: String(c.contenttype || 'application/octet-stream'),
        createdAt: new Date(String(c.created)),
      }));
  }

  async downloadFile(fileId: string): Promise<Buffer> {
    const data = await this.api('getfilelink', { fileid: fileId });
    if (data.result !== 0) throw new Error((data.error as string) || 'Failed to get download link');

    const hosts = data.hosts as string[];
    const path = data.path as string;
    const url = `https://${hosts[0]}${path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async getQuota(): Promise<CloudQuota> {
    const data = await this.api('userinfo');
    if (data.result !== 0) return { usedBytes: 0, totalBytes: 0 };
    return {
      usedBytes: (data.usedquota as number) || 0,
      totalBytes: (data.quota as number) || 0,
    };
  }
}
