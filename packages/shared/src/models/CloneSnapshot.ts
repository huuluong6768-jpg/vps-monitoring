import mongoose, { Schema, Model, Types } from 'mongoose';

export interface ICloneSnapshot {
  agentId: string;
  configId: Types.ObjectId;
  type: 'full_image' | 'rsync_incremental' | 'rsync_full';
  status:
    | 'pending'
    | 'preparing'
    | 'dumping_databases'
    | 'creating_image'
    | 'compressing'
    | 'uploading'
    | 'verifying'
    | 'completed'
    | 'failed';
  progress: number;
  chunks: {
    index: number;
    remoteFileId: string;
    remotePath: string;
    sizeBytes: number;
    checksum: string;
    uploaded: boolean;
  }[];
  totalSizeBytes: number;
  originalSizeBytes: number;
  compressionRatio: number;
  serverMeta: {
    hostname: string;
    os: string;
    osVersion: string;
    kernel: string;
    diskLayout: string;
    fstab: string;
    networkConfig: string;
    packageList: string;
    dockerPs: string;
    dockerVolumes: string;
    coolifyVersion?: string;
    publicIp: string;
    privateIp: string;
  };
  startedAt: Date;
  completedAt?: Date;
  duration?: number;
  logs: string[];
  errorMessage?: string;
  expiresAt?: Date;
  createdAt: Date;
}

const CloneSnapshotSchema = new Schema<ICloneSnapshot>(
  {
    agentId: { type: String, required: true, index: true },
    configId: { type: Schema.Types.ObjectId, ref: 'ServerCloneConfig', required: true },
    type: {
      type: String,
      enum: ['full_image', 'rsync_incremental', 'rsync_full'],
      required: true,
    },
    status: {
      type: String,
      enum: [
        'pending', 'preparing', 'dumping_databases', 'creating_image',
        'compressing', 'uploading', 'verifying', 'completed', 'failed',
      ],
      default: 'pending',
    },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    chunks: [
      {
        index: Number,
        remoteFileId: String,
        remotePath: String,
        sizeBytes: Number,
        checksum: String,
        uploaded: { type: Boolean, default: false },
      },
    ],
    totalSizeBytes: { type: Number, default: 0 },
    originalSizeBytes: { type: Number, default: 0 },
    compressionRatio: { type: Number, default: 0 },
    serverMeta: {
      hostname: { type: String, default: '' },
      os: { type: String, default: '' },
      osVersion: { type: String, default: '' },
      kernel: { type: String, default: '' },
      diskLayout: { type: String, default: '' },
      fstab: { type: String, default: '' },
      networkConfig: { type: String, default: '' },
      packageList: { type: String, default: '' },
      dockerPs: { type: String, default: '' },
      dockerVolumes: { type: String, default: '' },
      coolifyVersion: String,
      publicIp: { type: String, default: '' },
      privateIp: { type: String, default: '' },
    },
    startedAt: { type: Date, default: () => new Date() },
    completedAt: Date,
    duration: Number,
    logs: { type: [String], default: [] },
    errorMessage: String,
    expiresAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

CloneSnapshotSchema.index({ agentId: 1, startedAt: -1 });
CloneSnapshotSchema.index({ configId: 1, startedAt: -1 });

export const CloneSnapshot: Model<ICloneSnapshot> =
  mongoose.models.CloneSnapshot ||
  mongoose.model<ICloneSnapshot>('CloneSnapshot', CloneSnapshotSchema);
