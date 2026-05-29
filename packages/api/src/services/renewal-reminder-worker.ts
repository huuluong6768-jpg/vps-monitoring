import { connectDB, Renewal, getAppSettings, telegramSendMessageHtml, isTelegramAlertsConfigured } from '@vps-monitoring/shared';

const POLL_INTERVAL = 60 * 60 * 1000; // Check every hour

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const TYPE_LABELS: Record<string, string> = {
  vps: '🖥️ VPS',
  domain: '🌐 Domain',
  ssl: '🔒 SSL',
  license: '📄 License',
  other: '📋 Khác',
};

async function checkRenewals(): Promise<void> {
  try {
    await connectDB();
    const settings = await getAppSettings();
    if (!isTelegramAlertsConfigured(settings)) return;

    const now = new Date();
    const renewals = await Renewal.find({ isActive: true });

    for (const renewal of renewals) {
      const expiryTime = new Date(renewal.expiryDate).getTime();
      const daysUntilExpiry = Math.ceil((expiryTime - now.getTime()) / (24 * 60 * 60 * 1000));

      // Find the closest reminder threshold that matches
      const sortedReminders = [...renewal.reminderDays].sort((a, b) => b - a);
      let matchedDay: number | null = null;

      for (const reminderDay of sortedReminders) {
        if (daysUntilExpiry <= reminderDay) {
          matchedDay = reminderDay;
        }
      }

      if (matchedDay === null) continue;

      // Skip if already notified for this level or a closer one
      if (
        renewal.lastNotifiedDaysBefore !== undefined &&
        renewal.lastNotifiedDaysBefore <= matchedDay
      ) {
        continue;
      }

      // Send notification
      const typeLabel = TYPE_LABELS[renewal.type] || renewal.type;
      const urgency = daysUntilExpiry <= 0 ? '🚨 ĐÃ HẾT HẠN' :
                      daysUntilExpiry <= 1 ? '🔴 Hết hạn HÔM NAY' :
                      daysUntilExpiry <= 3 ? '🟠 Sắp hết hạn' :
                      '🟡 Nhắc nhở gia hạn';

      const lines: string[] = [
        `<b>${urgency}</b>`,
        ``,
        `<b>Dịch vụ:</b> ${escapeHtml(renewal.name)}`,
        `<b>Loại:</b> ${typeLabel}`,
      ];

      if (renewal.provider) {
        lines.push(`<b>Nhà cung cấp:</b> ${escapeHtml(renewal.provider)}`);
      }

      if (daysUntilExpiry <= 0) {
        lines.push(`<b>Đã hết hạn:</b> ${Math.abs(daysUntilExpiry)} ngày trước`);
      } else {
        lines.push(`<b>Còn lại:</b> ${daysUntilExpiry} ngày`);
      }

      const expiryStr = new Date(renewal.expiryDate).toLocaleDateString('vi-VN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
      });
      lines.push(`<b>Ngày hết hạn:</b> ${expiryStr}`);

      if (renewal.cost) {
        lines.push(`<b>Chi phí:</b> ${renewal.cost} ${renewal.currency || 'USD'}`);
      }

      if (renewal.notes) {
        lines.push(`<b>Ghi chú:</b> ${escapeHtml(renewal.notes.slice(0, 200))}`);
      }

      const result = await telegramSendMessageHtml(
        settings.telegramBotToken!,
        settings.telegramChatId!,
        lines.join('\n')
      );

      if (result.ok) {
        renewal.lastNotifiedAt = now;
        renewal.lastNotifiedDaysBefore = matchedDay;
        await renewal.save();
        console.log(`[RenewalReminder] Notified: ${renewal.name} (${daysUntilExpiry} days left)`);
      } else {
        console.error(`[RenewalReminder] Telegram send failed for ${renewal.name}:`, result);
      }
    }
  } catch (err) {
    console.error('[RenewalReminder] Error checking renewals:', err);
  }
}

export function startRenewalReminderWorker(): void {
  console.log(`[RenewalReminder] Started — checking every ${POLL_INTERVAL / 60000} minutes`);
  // Check immediately on startup
  setTimeout(() => checkRenewals(), 5000);
  // Then poll periodically
  setInterval(checkRenewals, POLL_INTERVAL);
}
