import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

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
app.use(express.raw({ type: 'application/octet-stream', limit: '2gb' }));

// Serve agent scripts as static files
app.use('/scripts', express.static('public'));

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

app.listen(PORT, () => {
  console.log(`[API] VPS Monitoring API server listening on port ${PORT}`);
  console.log(`[API] Allowed CORS origins: ${WEB_ORIGINS.join(', ')}`);
});

export default app;
