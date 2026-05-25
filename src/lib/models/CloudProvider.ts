import mongoose, { Schema, Model } from 'mongoose';

export type CloudProviderType = 'google_drive' | 'pcloud' | 'onedrive' | 's3';

export interface ICloudProvider {
  name: string;
  type: CloudProviderType;
  credentials: {
    accessToken?: string;
    refreshToken?: string;
    tokenExpiry?: Date;
    clientId?: string;
    clientSecret?: string;
    pcloudToken?: string;
    msAccessToken?: string;
    msRefreshToken?: string;
    s3AccessKey?: string;
    s3SecretKey?: string;
    s3Bucket?: string;
    s3Region?: string;
    s3Endpoint?: string;
  };
  folderId?: string;
  folderPath?: string;
  status: 'connected' | 'disconnected' | 'error';
  lastVerifiedAt?: Date;
  usedBytes?: number;
  totalBytes?: number;
  createdAt: Date;
  updatedAt: Date;
}

const CloudProviderSchema = new Schema<ICloudProvider>(
  {
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ['google_drive', 'pcloud', 'onedrive', 's3'],
      required: true,
    },
    credentials: {
      accessToken: String,
      refreshToken: String,
      tokenExpiry: Date,
      clientId: String,
      clientSecret: String,
      pcloudToken: String,
      msAccessToken: String,
      msRefreshToken: String,
      s3AccessKey: String,
      s3SecretKey: String,
      s3Bucket: String,
      s3Region: String,
      s3Endpoint: String,
    },
    folderId: String,
    folderPath: { type: String, default: '/VPS-Backups' },
    status: {
      type: String,
      enum: ['connected', 'disconnected', 'error'],
      default: 'disconnected',
    },
    lastVerifiedAt: Date,
    usedBytes: { type: Number, default: 0 },
    totalBytes: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const CloudProvider: Model<ICloudProvider> =
  mongoose.models.CloudProvider ||
  mongoose.model<ICloudProvider>('CloudProvider', CloudProviderSchema);
