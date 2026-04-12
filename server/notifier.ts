export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

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
