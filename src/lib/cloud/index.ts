import type { ICloudClient } from './types';
import type { ICloudProvider } from '@/lib/models/CloudProvider';
import { GoogleDriveClient } from './google-drive';
import { S3Client } from './s3';
import { decrypt } from '@/lib/encryption';

export type { ICloudClient, CloudFile, CloudQuota, CloudUploadResult } from './types';

function safeDecrypt(val?: string): string {
  if (!val) return '';
  try {
    return decrypt(val);
  } catch {
    return val;
  }
}

export function createCloudClient(provider: ICloudProvider): ICloudClient {
  const creds = provider.credentials;

  switch (provider.type) {
    case 'google_drive':
      return new GoogleDriveClient({
        accessToken: safeDecrypt(creds.accessToken),
        refreshToken: safeDecrypt(creds.refreshToken),
        tokenExpiry: creds.tokenExpiry,
        clientId: safeDecrypt(creds.clientId),
        clientSecret: safeDecrypt(creds.clientSecret),
      });

    case 's3':
      return new S3Client({
        accessKey: safeDecrypt(creds.s3AccessKey),
        secretKey: safeDecrypt(creds.s3SecretKey),
        bucket: creds.s3Bucket || '',
        region: creds.s3Region || 'us-east-1',
        endpoint: creds.s3Endpoint,
      });

    case 'pcloud':
    case 'onedrive':
      throw new Error(`Cloud provider type '${provider.type}' is not yet implemented`);

    default:
      throw new Error(`Unknown cloud provider type: ${provider.type}`);
  }
}
