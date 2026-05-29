import mongoose, { Schema, Model } from 'mongoose';

export interface IDirectCloneJob {
  sourceServer: {
    agentId?: string;
    ip: string;
    port: number;
    username: string;
    sshPrivateKey?: string;
    password?: string;
  };
  targetServer: {
    ip: string;
    port: number;
    username: string;
    sshPrivateKey?: string;
    password?: string;
  };
  mode: 'full' | 'incremental';
  options: {
    syncSystemConfigs: boolean;
    syncDocker: boolean;
    syncDockerVolumes: boolean;
    syncUserData: boolean;
    syncDatabases: boolean;
    customPaths: string[];
    excludePaths: string[];
    postCloneCommands: string[];
    regenerateSshHostKeys: boolean;
    restartDocker: boolean;
    restartCoolify: boolean;
  };
  status:
    | 'pending'
    | 'connecting'
    | 'syncing'
    | 'post_config'
    | 'verifying'
    | 'completed'
    | 'failed';
  progress: number;
  currentStep: string;
  logs: string[];
  errorMessage?: string;
  totalSizeBytes: number;
  transferredBytes: number;
  startedAt: Date;
  completedAt?: Date;
  createdAt: Date;
}

const DirectCloneJobSchema = new Schema<IDirectCloneJob>(
  {
    sourceServer: {
      agentId: String,
      ip: { type: String, required: true },
      port: { type: Number, default: 22 },
      username: { type: String, default: 'root' },
      sshPrivateKey: String,
      password: String,
    },
    targetServer: {
      ip: { type: String, required: true },
      port: { type: Number, default: 22 },
      username: { type: String, default: 'root' },
      sshPrivateKey: String,
      password: String,
    },
    mode: {
      type: String,
      enum: ['full', 'incremental'],
      default: 'full',
    },
    options: {
      syncSystemConfigs: { type: Boolean, default: true },
      syncDocker: { type: Boolean, default: true },
      syncDockerVolumes: { type: Boolean, default: true },
      syncUserData: { type: Boolean, default: true },
      syncDatabases: { type: Boolean, default: true },
      customPaths: { type: [String], default: [] },
      excludePaths: {
        type: [String],
        default: [
          '/proc', '/sys', '/dev', '/run', '/tmp',
          '/mnt', '/media', '/lost+found',
          '/swapfile', '/swap.img',
          '/var/cache/apt', '/var/cache/yum',
        ],
      },
      postCloneCommands: { type: [String], default: [] },
      regenerateSshHostKeys: { type: Boolean, default: true },
      restartDocker: { type: Boolean, default: true },
      restartCoolify: { type: Boolean, default: false },
    },
    status: {
      type: String,
      enum: ['pending', 'connecting', 'syncing', 'post_config', 'verifying', 'completed', 'failed'],
      default: 'pending',
    },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    currentStep: { type: String, default: '' },
    logs: { type: [String], default: [] },
    errorMessage: String,
    totalSizeBytes: { type: Number, default: 0 },
    transferredBytes: { type: Number, default: 0 },
    startedAt: { type: Date, default: () => new Date() },
    completedAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const DirectCloneJob: Model<IDirectCloneJob> =
  mongoose.models.DirectCloneJob ||
  mongoose.model<IDirectCloneJob>('DirectCloneJob', DirectCloneJobSchema);
