import mongoose, { Schema, Model } from 'mongoose';

export interface IServerGroup {
  name: string;
  description?: string;
  color: string;
  icon?: string;
  agentIds: string[];
  alertOverrides?: {
    cpuThreshold?: number;
    ramThreshold?: number;
    diskThreshold?: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const ServerGroupSchema = new Schema<IServerGroup>(
  {
    name: { type: String, required: true },
    description: String,
    color: { type: String, default: '#3b82f6' },
    icon: String,
    agentIds: { type: [String], default: [] },
    alertOverrides: {
      cpuThreshold: Number,
      ramThreshold: Number,
      diskThreshold: Number,
    },
  },
  { timestamps: true },
);

export const ServerGroup: Model<IServerGroup> =
  mongoose.models.ServerGroup ||
  mongoose.model<IServerGroup>('ServerGroup', ServerGroupSchema);
