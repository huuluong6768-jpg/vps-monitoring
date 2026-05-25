/**
 * Interactive Telegram Bot — polling-based command handler.
 *
 * Commands:
 *   /start   — welcome + show menu
 *   /status  — fleet summary (total servers, online/offline, avg CPU/RAM)
 *   /servers — list all servers with status
 *   /server <name> — detail of one server
 *   /alerts  — current alert thresholds
 *   /backup  — list cloud providers + recent snapshots
 *   /help    — show all commands
 */

import { connectDB } from './db';
import { Agent } from './models/Agent';
import { Metric } from './models/Metric';
import { CloudProvider } from './models/CloudProvider';
import { CloneSnapshot } from './models/CloneSnapshot';
import { getAppSettings } from './app-settings';
import { formatBytes, formatUptime } from './utils';
import { sanitizeTelegramBotToken } from './telegram-client';

const TG = 'https://api.telegram.org';

type TGUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
    date: number;
  };
};

type TGBotOptions = {
  token: string;
  appUrl: string;
  pollIntervalMs?: number;
};

export class TelegramBot {
  private token: string;
  private appUrl: string;
  private pollInterval: number;
  private offset = 0;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: TGBotOptions) {
    this.token = sanitizeTelegramBotToken(opts.token);
    this.appUrl = opts.appUrl.replace(/\/$/, '');
    this.pollInterval = opts.pollIntervalMs ?? 3000;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await connectDB();
    await this.setCommands();
    console.log('[TelegramBot] Bot started, polling for updates…');
    this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log('[TelegramBot] Bot stopped.');
  }

  private async setCommands(): Promise<void> {
    const commands = [
      { command: 'start', description: 'Bắt đầu & hiện menu' },
      { command: 'status', description: 'Tổng quan fleet (online/offline, CPU, RAM)' },
      { command: 'servers', description: 'Danh sách tất cả server' },
      { command: 'server', description: 'Chi tiết 1 server (VD: /server web-01)' },
      { command: 'alerts', description: 'Xem ngưỡng cảnh báo hiện tại' },
      { command: 'backup', description: 'Cloud providers & snapshots gần đây' },
      { command: 'help', description: 'Hiện tất cả lệnh' },
    ];
    try {
      await this.apiCall('setMyCommands', { commands });
    } catch (e) {
      console.error('[TelegramBot] setMyCommands failed:', e);
    }
  }

  private async poll(): Promise<void> {
    if (!this.running) return;
    try {
      const updates = await this.getUpdates();
      for (const u of updates) {
        this.offset = u.update_id + 1;
        if (u.message?.text) {
          await this.handleMessage(u.message.chat.id, u.message.text);
        }
      }
    } catch (e) {
      console.error('[TelegramBot] poll error:', e);
    }
    this.timer = setTimeout(() => this.poll(), this.pollInterval);
  }

  private async getUpdates(): Promise<TGUpdate[]> {
    const res = await fetch(
      `${TG}/bot${this.token}/getUpdates?offset=${this.offset}&timeout=10&allowed_updates=["message"]`,
      { signal: AbortSignal.timeout(15_000) }
    );
    const data = (await res.json()) as { ok?: boolean; result?: TGUpdate[] };
    return data.ok ? data.result ?? [] : [];
  }

  private async apiCall(method: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(`${TG}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    return res.json();
  }

  private async sendHtml(chatId: number, html: string): Promise<void> {
    await this.apiCall('sendMessage', {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  }

  private async handleMessage(chatId: number, text: string): Promise<void> {
    const parts = text.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase().replace(/@\S+/, '');
    const arg = parts.slice(1).join(' ');

    switch (cmd) {
      case '/start':
        return this.cmdStart(chatId);
      case '/status':
        return this.cmdStatus(chatId);
      case '/servers':
        return this.cmdServers(chatId);
      case '/server':
        return this.cmdServer(chatId, arg);
      case '/alerts':
        return this.cmdAlerts(chatId);
      case '/backup':
        return this.cmdBackup(chatId);
      case '/help':
        return this.cmdHelp(chatId);
      default:
        if (cmd.startsWith('/')) {
          await this.sendHtml(chatId, 'Lệnh không hợp lệ. Gõ /help để xem danh sách lệnh.');
        }
    }
  }

  // ── Commands ──

  private async cmdStart(chatId: number): Promise<void> {
    const lines = [
      '<b>🖥 VPS Monitor Bot</b>',
      '',
      'Chào bạn! Bot này giúp bạn theo dõi server từ Telegram.',
      '',
      '<b>Lệnh có sẵn:</b>',
      '/status — Tổng quan fleet',
      '/servers — Danh sách server',
      '/server &lt;tên&gt; — Chi tiết 1 server',
      '/alerts — Ngưỡng cảnh báo',
      '/backup — Cloud backup status',
      '/help — Xem tất cả lệnh',
      '',
      `<a href="${this.esc(this.appUrl)}">Mở Dashboard</a>`,
    ];
    await this.sendHtml(chatId, lines.join('\n'));
  }

  private async cmdStatus(chatId: number): Promise<void> {
    const offlineSec = Number(process.env.AGENT_OFFLINE_AFTER_SECONDS || 60);
    const cutoff = new Date(Date.now() - offlineSec * 1000);

    const agents = await Agent.find({}, 'agentId hostname label lastSeenAt').lean();
    const total = agents.length;
    const online = agents.filter((a) => a.lastSeenAt && new Date(a.lastSeenAt) >= cutoff).length;
    const offline = total - online;

    const onlineIds = agents
      .filter((a) => a.lastSeenAt && new Date(a.lastSeenAt) >= cutoff)
      .map((a) => a.agentId);

    let avgCpu = 0;
    let totalMem = 0;
    let usedMem = 0;
    let totalDisk = 0;
    let usedDisk = 0;

    if (onlineIds.length) {
      const latest = await Metric.aggregate([
        { $match: { agentId: { $in: onlineIds } } },
        { $sort: { agentId: 1 as 1, ts: -1 as -1 } },
        {
          $group: {
            _id: '$agentId',
            cpuPercent: { $first: '$cpuPercent' },
            memUsedBytes: { $first: '$memUsedBytes' },
            memTotalBytes: { $first: '$memTotalBytes' },
            diskUsedBytes: { $first: '$diskUsedBytes' },
            diskTotalBytes: { $first: '$diskTotalBytes' },
          },
        },
      ]);
      for (const m of latest) {
        avgCpu += m.cpuPercent ?? 0;
        usedMem += m.memUsedBytes ?? 0;
        totalMem += m.memTotalBytes ?? 0;
        usedDisk += m.diskUsedBytes ?? 0;
        totalDisk += m.diskTotalBytes ?? 0;
      }
      if (latest.length) avgCpu = avgCpu / latest.length;
    }

    const statusEmoji = offline === 0 ? '🟢' : online === 0 ? '🔴' : '🟡';
    const lines = [
      `<b>${statusEmoji} Fleet Status</b>`,
      '',
      `<b>Servers:</b> ${total} (${online} online, ${offline} offline)`,
      `<b>Avg CPU:</b> ${avgCpu.toFixed(1)}%`,
      `<b>Memory:</b> ${formatBytes(usedMem)} / ${formatBytes(totalMem)}`,
      `<b>Disk:</b> ${formatBytes(usedDisk)} / ${formatBytes(totalDisk)}`,
      '',
      `<a href="${this.esc(this.appUrl)}/dashboard">Mở Dashboard</a>`,
    ];
    await this.sendHtml(chatId, lines.join('\n'));
  }

  private async cmdServers(chatId: number): Promise<void> {
    const offlineSec = Number(process.env.AGENT_OFFLINE_AFTER_SECONDS || 60);
    const cutoff = new Date(Date.now() - offlineSec * 1000);

    const agents = await Agent.find(
      {},
      'agentId hostname label publicIp os lastSeenAt'
    )
      .sort({ hostname: 1 })
      .lean();

    if (!agents.length) {
      await this.sendHtml(chatId, 'Chưa có server nào được kết nối.\nThêm server tại Dashboard → Add server.');
      return;
    }

    const lines = [`<b>📋 Danh sách Server (${agents.length})</b>`, ''];
    for (const a of agents) {
      const isOnline = a.lastSeenAt && new Date(a.lastSeenAt) >= cutoff;
      const icon = isOnline ? '🟢' : '🔴';
      const name = a.label?.trim() || a.hostname || a.agentId;
      const ip = a.publicIp ? ` (${a.publicIp})` : '';
      lines.push(`${icon} <b>${this.esc(name)}</b>${this.esc(ip)} — ${a.os || 'unknown'}`);
    }

    lines.push('');
    lines.push('Chi tiết: /server &lt;tên&gt;');
    await this.sendHtml(chatId, lines.join('\n'));
  }

  private async cmdServer(chatId: number, query: string): Promise<void> {
    if (!query) {
      await this.sendHtml(
        chatId,
        'Dùng: /server &lt;hostname hoặc label&gt;\nVD: /server web-01'
      );
      return;
    }

    const q = query.toLowerCase();
    const agents = await Agent.find({}).lean();
    const match = agents.find(
      (a) =>
        a.hostname?.toLowerCase() === q ||
        a.label?.toLowerCase() === q ||
        a.agentId?.toLowerCase() === q
    );

    if (!match) {
      await this.sendHtml(chatId, `Không tìm thấy server "<b>${this.esc(query)}</b>".\nGõ /servers để xem danh sách.`);
      return;
    }

    const offlineSec = Number(process.env.AGENT_OFFLINE_AFTER_SECONDS || 60);
    const cutoff = new Date(Date.now() - offlineSec * 1000);
    const isOnline = match.lastSeenAt && new Date(match.lastSeenAt) >= cutoff;
    const statusIcon = isOnline ? '🟢 Online' : '🔴 Offline';
    const name = match.label?.trim() || match.hostname || match.agentId;

    const lines = [
      `<b>🖥 ${this.esc(name)}</b>`,
      `Status: ${statusIcon}`,
      '',
      `<b>OS:</b> ${this.esc(match.os || 'unknown')} ${this.esc(match.osVersion || '')}`,
      `<b>Kernel:</b> ${this.esc(match.kernel || '—')}`,
      `<b>CPU:</b> ${this.esc(match.cpuModel || '—')} (${match.cpuCores} cores)`,
      `<b>RAM:</b> ${formatBytes(match.totalMemoryBytes)}`,
      `<b>Disk:</b> ${formatBytes(match.totalDiskBytes)}`,
    ];

    if (match.publicIp) lines.push(`<b>Public IP:</b> <code>${this.esc(match.publicIp)}</code>`);
    if (match.privateIp) lines.push(`<b>Private IP:</b> <code>${this.esc(match.privateIp)}</code>`);

    // Fetch latest metrics
    const latestMetric = await Metric.findOne(
      { agentId: match.agentId },
      'cpuPercent memUsedBytes memTotalBytes diskUsedBytes diskTotalBytes uptimeSeconds netDownBps netUpBps'
    )
      .sort({ ts: -1 })
      .lean();

    if (latestMetric) {
      lines.push('');
      lines.push('<b>📊 Latest Metrics:</b>');
      lines.push(`  CPU: ${(latestMetric.cpuPercent ?? 0).toFixed(1)}%`);
      const memPct =
        latestMetric.memTotalBytes && latestMetric.memTotalBytes > 0
          ? ((latestMetric.memUsedBytes ?? 0) / latestMetric.memTotalBytes * 100).toFixed(1)
          : '0.0';
      lines.push(
        `  RAM: ${memPct}% (${formatBytes(latestMetric.memUsedBytes ?? 0)} / ${formatBytes(latestMetric.memTotalBytes ?? 0)})`
      );
      const diskPct =
        latestMetric.diskTotalBytes && latestMetric.diskTotalBytes > 0
          ? ((latestMetric.diskUsedBytes ?? 0) / latestMetric.diskTotalBytes * 100).toFixed(1)
          : '0.0';
      lines.push(
        `  Disk: ${diskPct}% (${formatBytes(latestMetric.diskUsedBytes ?? 0)} / ${formatBytes(latestMetric.diskTotalBytes ?? 0)})`
      );
      if (latestMetric.uptimeSeconds) {
        lines.push(`  Uptime: ${formatUptime(latestMetric.uptimeSeconds)}`);
      }
    }

    lines.push('');
    lines.push(
      `<a href="${this.esc(this.appUrl)}/servers/${encodeURIComponent(match.agentId)}">Mở trên Dashboard</a>`
    );
    await this.sendHtml(chatId, lines.join('\n'));
  }

  private async cmdAlerts(chatId: number): Promise<void> {
    const settings = await getAppSettings();
    const configured = Boolean(settings.telegramBotToken && settings.telegramChatId);

    const lines = [
      '<b>🔔 Cấu hình cảnh báo</b>',
      '',
      `<b>Status:</b> ${configured ? '🟢 Đã bật' : '🔴 Chưa cấu hình'}`,
      `<b>CPU threshold:</b> ≥ ${settings.alertCpuPercent}%`,
      `<b>RAM threshold:</b> ≥ ${settings.alertRamPercent}%`,
      `<b>Disk threshold:</b> ≥ ${settings.alertDiskPercent}%`,
      `<b>Cooldown:</b> ${settings.telegramCooldownSeconds}s`,
      '',
      `Thay đổi tại: <a href="${this.esc(this.appUrl)}/settings">Settings</a>`,
    ];
    await this.sendHtml(chatId, lines.join('\n'));
  }

  private async cmdBackup(chatId: number): Promise<void> {
    const providers = await CloudProvider.find({}, 'name type status folderPath usedBytes totalBytes').lean();
    const snapshots = await CloneSnapshot.find({})
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const lines = ['<b>☁️ Cloud Backup</b>', ''];

    if (!providers.length) {
      lines.push('Chưa có cloud provider nào.');
      lines.push(`Thêm tại: <a href="${this.esc(this.appUrl)}/backups">Backups</a>`);
    } else {
      lines.push(`<b>Providers (${providers.length}):</b>`);
      for (const p of providers) {
        const statusIcon = p.status === 'connected' ? '🟢' : '🔴';
        const used = p.usedBytes ? formatBytes(p.usedBytes) : '0 B';
        const total = p.totalBytes ? formatBytes(p.totalBytes) : '—';
        lines.push(
          `  ${statusIcon} <b>${this.esc(p.name)}</b> (${this.esc(p.type)}) — ${used} / ${total}`
        );
      }
    }

    if (snapshots.length) {
      lines.push('');
      lines.push('<b>Recent Snapshots:</b>');
      for (const s of snapshots) {
        const date = new Date(s.createdAt).toISOString().slice(0, 16).replace('T', ' ');
        const st = (s as Record<string, unknown>).status as string || 'unknown';
        lines.push(`  📦 ${date} — ${st}`);
      }
    }

    lines.push('');
    lines.push(`<a href="${this.esc(this.appUrl)}/backups">Mở Backups</a>`);
    await this.sendHtml(chatId, lines.join('\n'));
  }

  private async cmdHelp(chatId: number): Promise<void> {
    const lines = [
      '<b>📖 Danh sách lệnh</b>',
      '',
      '/start — Bắt đầu & hiện menu',
      '/status — Tổng quan fleet (online/offline, CPU, RAM)',
      '/servers — Danh sách tất cả server',
      '/server &lt;tên&gt; — Chi tiết 1 server',
      '/alerts — Xem ngưỡng cảnh báo hiện tại',
      '/backup — Cloud providers & snapshots gần đây',
      '/help — Hiện tất cả lệnh',
      '',
      `<a href="${this.esc(this.appUrl)}">Mở Dashboard</a>`,
    ];
    await this.sendHtml(chatId, lines.join('\n'));
  }

  private esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
