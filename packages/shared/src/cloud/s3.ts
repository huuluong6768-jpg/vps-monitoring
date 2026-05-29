import type { ICloudClient, CloudFile, CloudQuota, CloudUploadResult } from './types';
import { createHmac, createHash } from 'crypto';

interface S3Config {
  accessKey: string;
  secretKey: string;
  bucket: string;
  region: string;
  endpoint?: string;
}

function getHost(config: S3Config): string {
  if (config.endpoint) {
    return config.endpoint.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
  return `${config.bucket}.s3.${config.region}.amazonaws.com`;
}

function getBaseUrl(config: S3Config): string {
  if (config.endpoint) {
    const ep = config.endpoint.replace(/\/$/, '');
    return `${ep}/${config.bucket}`;
  }
  return `https://${config.bucket}.s3.${config.region}.amazonaws.com`;
}

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function getSignatureKey(key: string, date: string, region: string, service: string): Buffer {
  const kDate = hmacSha256(`AWS4${key}`, date);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

function signRequest(
  config: S3Config,
  method: string,
  path: string,
  headers: Record<string, string>,
  payload: string | Buffer = '',
): Record<string, string> {
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const date = dateStamp.slice(0, 8);
  const host = getHost(config);

  headers['host'] = host;
  headers['x-amz-date'] = dateStamp;
  headers['x-amz-content-sha256'] = sha256(payload);

  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k]}\n`)
    .join('');
  const canonicalRequest = [
    method, path, '', canonicalHeaders, signedHeaders, sha256(payload),
  ].join('\n');

  const scope = `${date}/${config.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', dateStamp, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = getSignatureKey(config.secretKey, date, config.region, 's3');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return headers;
}

export class S3Client implements ICloudClient {
  private config: S3Config;

  constructor(config: S3Config) {
    this.config = config;
  }

  async verify(): Promise<{ ok: boolean; error?: string; quota?: CloudQuota }> {
    try {
      const baseUrl = getBaseUrl(this.config);
      const headers = signRequest(this.config, 'GET', '/', {});
      const res = await fetch(`${baseUrl}/`, { headers });
      if (res.ok || res.status === 200) {
        return { ok: true };
      }
      return { ok: false, error: `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async createFolder(_name: string, _parentId?: string): Promise<string> {
    return _name;
  }

  async uploadFile(
    name: string,
    data: Buffer | NodeJS.ReadableStream,
    folderId: string,
    mimeType = 'application/octet-stream',
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

    const key = folderId ? `${folderId}/${name}` : name;
    const path = `/${key}`;
    const baseUrl = getBaseUrl(this.config);
    const headers = signRequest(this.config, 'PUT', path, {
      'content-type': mimeType,
      'content-length': String(fileBuffer.length),
    }, fileBuffer);

    const res = await fetch(`${baseUrl}${path}`, {
      method: 'PUT',
      headers,
      body: fileBuffer,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`S3 upload failed: ${res.status} ${text}`);
    }

    return { fileId: key, name, size: fileBuffer.length };
  }

  async deleteFile(fileId: string): Promise<void> {
    const path = `/${fileId}`;
    const baseUrl = getBaseUrl(this.config);
    const headers = signRequest(this.config, 'DELETE', path, {});
    await fetch(`${baseUrl}${path}`, { method: 'DELETE', headers });
  }

  async listFiles(folderId: string): Promise<CloudFile[]> {
    const prefix = folderId ? `prefix=${encodeURIComponent(folderId)}/&` : '';
    const baseUrl = getBaseUrl(this.config);
    const path = `/?${prefix}list-type=2`;
    const headers = signRequest(this.config, 'GET', `/${path.slice(2)}`, {});
    const res = await fetch(`${baseUrl}${path}`, { headers });
    if (!res.ok) return [];
    return [];
  }

  async downloadFile(fileId: string): Promise<Buffer> {
    const path = `/${fileId}`;
    const baseUrl = getBaseUrl(this.config);
    const headers = signRequest(this.config, 'GET', path, {});
    const res = await fetch(`${baseUrl}${path}`, { headers });
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async getQuota(): Promise<CloudQuota> {
    return { usedBytes: 0, totalBytes: 0 };
  }
}
