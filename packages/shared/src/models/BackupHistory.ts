import mongoose, { Schema, Model, Types } from 'mongoose';

export interface IBackupHistory {
  jobId: Types.ObjectId;
  agentId: string;
  providerId: Types.ObjectId;
  status: 'pending' | 'compressing' | 'uploading' | 'success' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  fileSize: number;
  originalSize: number;
  remoteFileId?: string;
  remotePath: string;
  checksum?: string;
  logs: string[];
  errorMessage?: string;
  expiresAt?: Date;
  createdAt: Date;
}

const BackupHistorySchema = new Schema<IBackupHistory>(
  {
    jobId: { type: Schema.Types.ObjectId, ref: 'BackupJob', required: true, index: true },
    agentId: { type: String, required: true, index: true },
    providerId: { type: Schema.Types.ObjectId, ref: 'CloudProvider', required: true },
    status: {
      type: String,
      enum: ['pending', 'compressing', 'uploading', 'success', 'failed'],
      default: 'pending',
    },
    startedAt: { type: Date, default: () => new Date() },
    completedAt: Date,
    fileSize: { type: Number, default: 0 },
    originalSize: { type: Number, default: 0 },
    remoteFileId: String,
    remotePath: { type: String, default: '' },
    checksum: String,
    logs: { type: [String], default: [] },
    errorMessage: String,
    expiresAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

BackupHistorySchema.index({ agentId: 1, startedAt: -1 });

export const BackupHistory: Model<IBackupHistory> =
  mongoose.models.BackupHistory ||
  mongoose.model<IBackupHistory>('BackupHistory', BackupHistorySchema);
