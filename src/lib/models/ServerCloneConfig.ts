import mongoose, { Schema, Model, Types } from 'mongoose';

export interface IServerCloneConfig {
  agentId: string;
  modes: {
    fullImage: {
      enabled: boolean;
      schedule?: string;
      compression: 'gzip' | 'pigz' | 'zstd';
      compressionLevel: number;
      excludeDisks?: string[];
      preFreezeCommands?: string[];
      postFreezeCommands?: string[];
    };
    rsyncDaily: {
      enabled: boolean;
      schedule?: string;
      excludePaths: string[];
      rsyncFlags?: string;
      syncDockerVolumes: boolean;
      preBackupDatabaseDumps: {
        type: 'mysql' | 'postgresql' | 'mongodb';
        containerName?: string;
        connectionString?: string;
        dumpPath: string;
      }[];
    };
  };
  providerId: Types.ObjectId;
  remotePath: string;
  retention: {
    fullImageKeep: number;
    rsyncKeep: number;
    maxTotalSizeBytes?: number;
  };
  notifyOnSuccess: boolean;
  notifyOnFailure: boolean;
  lastFullImageAt?: Date;
  lastRsyncAt?: Date;
  lastFullImageSize?: number;
  lastRsyncSize?: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ServerCloneConfigSchema = new Schema<IServerCloneConfig>(
  {
    agentId: { type: String, required: true, unique: true, index: true },
    modes: {
      fullImage: {
        enabled: { type: Boolean, default: false },
        schedule: String,
        compression: {
          type: String,
          enum: ['gzip', 'pigz', 'zstd'],
          default: 'pigz',
        },
        compressionLevel: { type: Number, default: 1, min: 1, max: 9 },
        excludeDisks: [String],
        preFreezeCommands: [String],
        postFreezeCommands: [String],
      },
      rsyncDaily: {
        enabled: { type: Boolean, default: true },
        schedule: { type: String, default: '0 2 * * *' },
        excludePaths: {
          type: [String],
          default: [
            '/proc', '/sys', '/dev', '/run', '/tmp',
            '/mnt', '/media', '/lost+found',
            '/swapfile', '/swap.img',
            '/var/cache/apt', '/var/cache/yum',
          ],
        },
        rsyncFlags: String,
        syncDockerVolumes: { type: Boolean, default: true },
        preBackupDatabaseDumps: [
          {
            type: {
              type: String,
              enum: ['mysql', 'postgresql', 'mongodb'],
              required: true,
            },
            containerName: String,
            connectionString: String,
            dumpPath: { type: String, required: true },
          },
        ],
      },
    },
    providerId: { type: Schema.Types.ObjectId, ref: 'CloudProvider', required: true },
    remotePath: { type: String, default: '/server-clones/' },
    retention: {
      fullImageKeep: { type: Number, default: 3, min: 1, max: 100 },
      rsyncKeep: { type: Number, default: 14, min: 1, max: 365 },
      maxTotalSizeBytes: Number,
    },
    notifyOnSuccess: { type: Boolean, default: true },
    notifyOnFailure: { type: Boolean, default: true },
    lastFullImageAt: Date,
    lastRsyncAt: Date,
    lastFullImageSize: Number,
    lastRsyncSize: Number,
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const ServerCloneConfig: Model<IServerCloneConfig> =
  mongoose.models.ServerCloneConfig ||
  mongoose.model<IServerCloneConfig>('ServerCloneConfig', ServerCloneConfigSchema);
