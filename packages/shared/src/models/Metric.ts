import mongoose, { Schema, Model } from 'mongoose';

export interface IMetric {
  agentId: string;
  ts: Date;
  cpuPercent: number;
  loadAvg1: number;
  loadAvg5: number;
  loadAvg15: number;
  memUsedBytes: number;
  memTotalBytes: number;
  swapUsedBytes: number;
  swapTotalBytes: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  diskReadBps: number;
  diskWriteBps: number;
  netRxBytes: number;
  netTxBytes: number;
  netRxBps: number;
  netTxBps: number;
  dockerCpuPercent: number;
  dockerMemUsedBytes: number;
  dockerNetRxBps: number;
  dockerNetTxBps: number;
  dockerContainerCount: number;
  temperatureC: number;
  gpuUtilPercent: number;
  gpuMemUsedBytes: number;
  gpuMemTotalBytes: number;
  gpuPowerWatts: number;
  uptimeSeconds: number;
  processCount: number;
}

const MetricSchema = new Schema<IMetric>(
  {
    agentId: { type: String, required: true, index: true },
    ts: { type: Date, required: true, index: true },
    cpuPercent: { type: Number, default: 0 },
    loadAvg1: { type: Number, default: 0 },
    loadAvg5: { type: Number, default: 0 },
    loadAvg15: { type: Number, default: 0 },
    memUsedBytes: { type: Number, default: 0 },
    memTotalBytes: { type: Number, default: 0 },
    swapUsedBytes: { type: Number, default: 0 },
    swapTotalBytes: { type: Number, default: 0 },
    diskUsedBytes: { type: Number, default: 0 },
    diskTotalBytes: { type: Number, default: 0 },
    diskReadBps: { type: Number, default: 0 },
    diskWriteBps: { type: Number, default: 0 },
    netRxBytes: { type: Number, default: 0 },
    netTxBytes: { type: Number, default: 0 },
    netRxBps: { type: Number, default: 0 },
    netTxBps: { type: Number, default: 0 },
    dockerCpuPercent: { type: Number, default: 0 },
    dockerMemUsedBytes: { type: Number, default: 0 },
    dockerNetRxBps: { type: Number, default: 0 },
    dockerNetTxBps: { type: Number, default: 0 },
    dockerContainerCount: { type: Number, default: 0 },
    temperatureC: { type: Number, default: 0 },
    gpuUtilPercent: { type: Number, default: 0 },
    gpuMemUsedBytes: { type: Number, default: 0 },
    gpuMemTotalBytes: { type: Number, default: 0 },
    gpuPowerWatts: { type: Number, default: 0 },
    uptimeSeconds: { type: Number, default: 0 },
    processCount: { type: Number, default: 0 },
  },
  { timestamps: false }
);

MetricSchema.index({ agentId: 1, ts: -1 });

export const Metric: Model<IMetric> =
  mongoose.models.Metric || mongoose.model<IMetric>('Metric', MetricSchema);
