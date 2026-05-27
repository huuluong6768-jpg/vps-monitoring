import mongoose, { Schema, Model, Types } from 'mongoose';

export interface IRestoreJob {
  snapshotId: Types.ObjectId;
  sourceAgentId: string;
  targetAgentId?: string;
  targetServer: {
    ip: string;
    port: number;
    username: string;
    sshPrivateKey?: string;
    password?: string;
  };
  postRestore: {
    newHostname?: string;
    newIp?: string;
    newGateway?: string;
    newDns?: string[];
    regenerateSshHostKeys: boolean;
    updateFstab: boolean;
    reinstallBootloader: boolean;
    restartDocker: boolean;
    restoreDockerVolumes: boolean;
    restartCoolify: boolean;
    coolifyDashboardUrl?: string;
    coolifyApiToken?: string;
    postRestoreCommands?: string[];
  };
  status:
    | 'pending'
    | 'downloading'
    | 'restoring'
    | 'post_config'
    | 'verifying'
    | 'completed'
    | 'failed';
  progress: number;
  currentStep: string;
  logs: string[];
  errorMessage?: string;
  startedAt: Date;
  completedAt?: Date;
  createdAt: Date;
}

const RestoreJobSchema = new Schema<IRestoreJob>(
  {
    snapshotId: { type: Schema.Types.ObjectId, ref: 'CloneSnapshot', required: true },
    sourceAgentId: { type: String, required: true },
    targetAgentId: String,
    targetServer: {
      ip: { type: String, required: true },
      port: { type: Number, default: 22 },
      username: { type: String, default: 'root' },
      sshPrivateKey: String,
      password: String,
    },
    postRestore: {
      newHostname: String,
      newIp: String,
      newGateway: String,
      newDns: [String],
      regenerateSshHostKeys: { type: Boolean, default: true },
      updateFstab: { type: Boolean, default: true },
      reinstallBootloader: { type: Boolean, default: true },
      restartDocker: { type: Boolean, default: true },
      restoreDockerVolumes: { type: Boolean, default: true },
      restartCoolify: { type: Boolean, default: true },
      coolifyDashboardUrl: String,
      coolifyApiToken: String,
      postRestoreCommands: [String],
    },
    status: {
      type: String,
      enum: ['pending', 'downloading', 'restoring', 'post_config', 'verifying', 'completed', 'failed'],
      default: 'pending',
    },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    currentStep: { type: String, default: '' },
    logs: { type: [String], default: [] },
    errorMessage: String,
    startedAt: { type: Date, default: () => new Date() },
    completedAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const RestoreJob: Model<IRestoreJob> =
  mongoose.models.RestoreJob ||
  mongoose.model<IRestoreJob>('RestoreJob', RestoreJobSchema);
