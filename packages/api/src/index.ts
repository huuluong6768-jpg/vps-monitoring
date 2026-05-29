import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'node:path';

import { TelegramBot, getAppSettings } from '@vps-monitoring/shared';
import { startRestoreWorker } from './services/restore-worker';
import { startDirectCloneWorker } from './services/direct-clone-worker';
import agentsRouter from './routes/agents';
import authRouter from './routes/auth';
import cloudRouter from './routes/cloud';
import cloneRouter from './routes/clone';
import groupsRouter from './routes/groups';
import settingsRouter from './routes/settings';
import setupRouter from './routes/setup';
import healthRouter from './routes/health';
import installRouter from './routes/install';

const app = express();

const WEB_ORIGINS = (process.env.WEB_ORIGINS || 'http://localhost:3000').split(',').map((s) => s.trim());

app.use(cors({
  origin: WEB_ORIGINS,
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));
app.use(express.raw({ type: 'application/octet-stream', limit: '100mb' }));

// Serve agent scripts as static files (under /api/ so the web proxy forwards them)
app.use('/api/scripts', express.static(path.resolve(__dirname, '../public')));

// Routes
app.use('/api/agents', agentsRouter);
app.use('/api/auth', authRouter);
app.use('/api/cloud', cloudRouter);
app.use('/api/clone', cloneRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/setup', setupRouter);
app.use('/api/health', healthRouter);
app.use('/api/install', installRouter);

const PORT = Number(process.env.API_PORT || 4000);

app.listen(PORT, async () => {
  console.log(`[API] VPS Monitoring API server listening on port ${PORT}`);
  console.log(`[API] Allowed CORS origins: ${WEB_ORIGINS.join(', ')}`);

  // Start Telegram bot if configured
  try {
    const settings = await getAppSettings();
    if (settings.telegramBotToken) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const bot = new TelegramBot({ token: settings.telegramBotToken, appUrl });
      await bot.start();
      // Store bot instance for potential restart on settings change
      (app as unknown as Record<string, unknown>).__telegramBot = bot;
    } else {
      console.log('[API] Telegram bot not configured — set bot token in Settings to enable.');
    }
  } catch (e) {
    console.error('[API] Failed to start Telegram bot:', e);
  }

  // Start restore worker — polls for pending restore jobs
  startRestoreWorker();

  // Start direct clone worker — polls for pending direct clone jobs
  startDirectCloneWorker();
});

export default app;
