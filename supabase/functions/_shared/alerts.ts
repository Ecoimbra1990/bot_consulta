import { config } from './env.ts';

export async function sendTelegramMessage(chatId: string | number, message: string): Promise<boolean> {
  const token = config.telegram.token;
  if (!token || !chatId) {
    return false;
  }
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Telegram HTTP ${response.status}`);
  }
  return true;
}

export async function notifyAdmin(message: string): Promise<boolean> {
  if (!config.adminTelegramId) {
    return false;
  }
  return sendTelegramMessage(config.adminTelegramId, message);
}

export async function notifyAdminSafely(message: string): Promise<void> {
  try {
    await notifyAdmin(message);
  } catch {
    return;
  }
}

export async function sendTelegramMessageSafely(chatId: string | number, message: string): Promise<void> {
  try {
    await sendTelegramMessage(chatId, message);
  } catch {
    return;
  }
}
