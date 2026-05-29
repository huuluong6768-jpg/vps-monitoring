import { Router, Request, Response } from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '@vps-monitoring/shared';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const interval = (req.query.interval as string) ?? '15';
  const baseUrl = env.APP_URL.replace(/\/$/, '');

  const scriptPath = path.resolve(__dirname, '../../public/install.sh');
  let template: string;
  try {
    template = await readFile(scriptPath, 'utf8');
  } catch {
    res.status(500).send('install.sh template missing on server');
    return;
  }

  const rendered = template
    .replace(/__SERVER_URL__/g, baseUrl)
    .replace(/__INTERVAL__/g, String(Math.max(5, Number(interval) || 15)));

  res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(rendered);
});

export default router;
