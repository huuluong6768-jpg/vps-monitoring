/**
 * Low-level Telegram Bot HTTP API helpers (token sanitization, getMe, sendMessage).
 */

const TG = 'https://api.telegram.org';

/** Strip noise often pasted from BotFather / Markdown (BOM, quotes, zero-width). */
export function sanitizeTelegramBotToken(raw: string): string {
  let s = raw.replace(/^\uFEFF/, '').trim();
  s = s.replace(/^["'`]+|["'`]+$/g, '');
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');
  const m = s.match(/(\d+:[A-Za-z0-9_-]{15,})/);
  return (m ? m[1] : s).trim();
}

export function sanitizeTelegramChatId(raw: string): string {
  return String(raw)
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '');
}

export type TelegramCallError = {
  ok: false;
  httpStatus: number;
  description: string;
};

export type TelegramCallOk = { ok: true };

export async function telegramGetMe(token: string): Promise<TelegramCallOk | TelegramCallError> {
  const t = sanitizeTelegramBotToken(token);
  if (!t || !t.includes(':')) {
    return { ok: false, httpStatus: 400, description: 'Bot token trống hoặc sai định dạng (cần dạng 123456789:AAH…).' };
  }
  const url = `${TG}/bot${t}/getMe`;
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(12_000) });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      error_code?: number;
    };
    if (data.ok === true) return { ok: true };
    const desc =
      data.description ??
      (res.status === 404
        ? 'HTTP 404 — thường do token sai hoặc URL không khớp bot. Lấy lại token từ @BotFather.'
        : `HTTP ${res.status}`);
    return { ok: false, httpStatus: res.status, description: desc };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, httpStatus: 0, description: `Lỗi mạng: ${msg}` };
  }
}

export async function telegramSendMessageHtml(
  token: string,
  chatId: string,
  html: string
): Promise<TelegramCallOk | TelegramCallError> {
  const t = sanitizeTelegramBotToken(token);
  const c = sanitizeTelegramChatId(chatId);
  if (!t || !t.includes(':')) {
    return { ok: false, httpStatus: 404, description: 'Bot token trống — URL Telegram trả 404.' };
  }
  if (!c) {
    return { ok: false, httpStatus: 400, description: 'Chat ID trống.' };
  }
  const url = `${TG}/bot${t}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: c,
        text: html,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
    };
    if (data.ok === true) return { ok: true };
    const desc =
      data.description ??
      (res.status === 404
        ? 'HTTP 404 — token bot không hợp lệ hoặc đã bị thu hồi. Kiểm tra lại token trong Settings (không khoảng trắng thừa).'
        : `HTTP ${res.status}`);
    return { ok: false, httpStatus: res.status, description: desc };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, httpStatus: 0, description: `Lỗi mạng: ${msg}` };
  }
}

/** Thrown when saving Settings if @BotFather token fails getMe. */
export class TelegramTokenRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TelegramTokenRejectedError';
  }
}
