import mongoose from 'mongoose';
import { env } from './env';

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __mongooseCache: MongooseCache | undefined;
}

const cache: MongooseCache = global.__mongooseCache ?? { conn: null, promise: null };
global.__mongooseCache = cache;

function connectOptions(): import('mongoose').ConnectOptions {
  const opts: import('mongoose').ConnectOptions = {
    bufferCommands: false,
    serverSelectionTimeoutMS: 10_000,
  };
  // If remote host resolves to IPv6 first but Mongo only listens on IPv4, set MONGODB_FAMILY=4
  const fam = process.env.MONGODB_FAMILY;
  if (fam === '4') opts.family = 4;
  if (fam === '6') opts.family = 6;
  return opts;
}

export async function connectDB(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;

  if (!cache.promise) {
    cache.promise = mongoose
      .connect(env.MONGODB_URI, connectOptions())
      .then((m) => m)
      .catch((err) => {
        cache.promise = null;
        throw err;
      });
  }

  try {
    cache.conn = await cache.promise;
    return cache.conn;
  } catch (err) {
    cache.promise = null;
    cache.conn = null;
    throw err;
  }
}
