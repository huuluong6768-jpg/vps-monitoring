import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  getPublicAlertSettings, updateAppSettings, getAppSettings,
  TelegramTokenRejectedError, isTelegramAlertsConfigured, sendTelegramSettingsTestResult,
} from '@vps-monitoring/shared';
import { requireAuth } from '../middleware/auth';

const router = Router();

const putSchema = z.object({
  telegramBotToken: z.string().max(512).optional(),
  clearTelegramBotToken: z.boolean().optional(),
  telegramChatId: z.string().max(64).optional(),
  alertCpuPercent: z.number().int().min(1).max(100).optional(),
  alertRamPercent: z.number().int().min(1).max(100).optional(),
  alertDiskPercent: z.number().int().min(1).max(100).optional(),
  telegramCooldownSeconds: z.number().int().min(60).max(86_400).optional(),
});

router.get('/alerts', requireAuth, async (_req: Request, res: Response) => {
  try {
    const settings = await getPublicAlertSettings();
    res.json(settings);
  } catch (e) {
    console.error('[settings/alerts GET]', e);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

router.put('/alerts', requireAuth, async (req: Request, res: Response) => {
  const parsed = putSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }

  try {
    const settings = await updateAppSettings(parsed.data);
    res.json(settings);
  } catch (e) {
    if (e instanceof TelegramTokenRejectedError) { res.status(400).json({ error: e.message }); return; }
    console.error('[settings/alerts PUT]', e);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

router.post('/alerts/test', requireAuth, async (_req: Request, res: Response) => {
  try {
    const settings = await getAppSettings();
    if (!isTelegramAlertsConfigured(settings)) {
      res.status(400).json({ error: 'Chưa có bot token và chat id. Lưu cấu hình trước khi gửi thử.' });
      return;
    }
    const r = await sendTelegramSettingsTestResult(settings);
    if (!r.ok) { res.status(502).json({ error: r.description, httpStatus: r.httpStatus }); return; }
    res.json({ ok: true });
  } catch (e) {
    console.error('[settings/alerts/test]', e);
    res.status(500).json({ error: 'Gửi thử thất bại' });
  }
});

export default router;
