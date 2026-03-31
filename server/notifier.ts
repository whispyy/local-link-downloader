function sendToWebhook(url: string, message: string) {
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: message }),
  }).catch(() => {});
}

export function notifyDiscord(message: string) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  sendToWebhook(url, message);
}

export function notifyDiscordError(message: string, meta?: Record<string, unknown>) {
  const url = process.env.DISCORD_ERROR_WEBHOOK_URL;
  if (!url) return;
  const metaStr = meta ? '\n```json\n' + JSON.stringify(meta, null, 2) + '\n```' : '';
  sendToWebhook(url, `🚨 **Error:** ${message}${metaStr}`);
}
