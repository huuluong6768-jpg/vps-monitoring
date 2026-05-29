import mongoose, { Schema, Model } from 'mongoose';

export interface IRenewal {
  _id: mongoose.Types.ObjectId;
  name: string;
  type: 'vps' | 'domain' | 'ssl' | 'license' | 'other';
  agentId?: string;
  provider?: string;
  cost?: number;
  currency?: string;
  expiryDate: Date;
  reminderDays: number[];
  notes?: string;
  lastNotifiedAt?: Date;
  lastNotifiedDaysBefore?: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const RenewalSchema = new Schema<IRenewal>(
  {
    name: { type: String, required: true },
    type: { type: String, enum: ['vps', 'domain', 'ssl', 'license', 'other'], required: true },
    agentId: { type: String },
    provider: { type: String, default: '' },
    cost: { type: Number },
    currency: { type: String, default: 'USD' },
    expiryDate: { type: Date, required: true },
    reminderDays: { type: [Number], default: [30, 7, 3, 1] },
    notes: { type: String, default: '' },
    lastNotifiedAt: { type: Date },
    lastNotifiedDaysBefore: { type: Number },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

RenewalSchema.index({ expiryDate: 1 });
RenewalSchema.index({ isActive: 1, expiryDate: 1 });

export const Renewal: Model<IRenewal> =
  mongoose.models.Renewal || mongoose.model<IRenewal>('Renewal', RenewalSchema);
