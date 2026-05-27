import mongoose, { Schema, Model, Types } from 'mongoose';

export interface IBackupJob {
  name: string;
  agentId: string;
  providerId: Types.ObjectId;
  schedule: {
    type: 'manual' | 'cron';
    cronExpression?: string;
    timezone?: string;
  };
  targets: {
    type: 'directory' | 'database' | 'docker_volume' | 'full_system';
    paths?: string[];
    dbType?: 'mysql' | 'postgresql' | 'mongodb';
    dbConnectionString?: string;
    dockerVolumes?: string[];
    excludePatterns?: string[];
  }[];
  compression: 'gzip' | 'zstd' | 'none';
  encryption: {
    enabled: boolean;
    algorithm?: string;
    passphrase?: string;
  };
  retention: {
    maxBackups?: number;
    maxDays?: number;
  };
  remotePath: string;
  enabled: boolean;
  status: 'idle' | 'running' | 'success' | 'failed';
  lastRunAt?: Date;
  lastSuccessAt?: Date;
  nextRunAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BackupJobSchema = new Schema<IBackupJob>(
  {
    name: { type: String, required: true },
    agentId: { type: String, required: true, index: true },
    providerId: { type: Schema.Types.ObjectId, ref: 'CloudProvider', required: true },
    schedule: {
      type: {
        type: String,
        enum: ['manual', 'cron'],
        default: 'manual',
      },
      cronExpression: String,
      timezone: { type: String, default: 'UTC' },
    },
    targets: [
      {
        type: {
          type: String,
          enum: ['directory', 'database', 'docker_volume', 'full_system'],
          required: true,
        },
        paths: [String],
        dbType: { type: String, enum: ['mysql', 'postgresql', 'mongodb'] },
        dbConnectionString: String,
        dockerVolumes: [String],
        excludePatterns: [String],
      },
    ],
    compression: {
      type: String,
      enum: ['gzip', 'zstd', 'none'],
      default: 'gzip',
    },
    encryption: {
      enabled: { type: Boolean, default: false },
      algorithm: String,
      passphrase: String,
    },
    retention: {
      maxBackups: { type: Number, default: 7 },
      maxDays: { type: Number, default: 30 },
    },
    remotePath: { type: String, default: '/' },
    enabled: { type: Boolean, default: true },
    status: {
      type: String,
      enum: ['idle', 'running', 'success', 'failed'],
      default: 'idle',
    },
    lastRunAt: Date,
    lastSuccessAt: Date,
    nextRunAt: Date,
  },
  { timestamps: true },
);

export const BackupJob: Model<IBackupJob> =
  mongoose.models.BackupJob ||
  mongoose.model<IBackupJob>('BackupJob', BackupJobSchema);
