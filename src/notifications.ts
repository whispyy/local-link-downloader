const STORAGE_KEY = 'notifications_enabled';

export type NotificationStatus =
  | { available: true; enabled: boolean }
  | { available: false; reason: 'unsupported' | 'insecure-context' | 'denied' };

export function getNotificationStatus(): NotificationStatus {
  if (!('Notification' in window)) {
    const reason = !self.isSecureContext ? 'insecure-context' : 'unsupported';
    return { available: false, reason };
  }
  if (Notification.permission === 'denied') {
    return { available: false, reason: 'denied' };
  }
  return { available: true, enabled: getNotificationPreference() };
}

export function getNotificationPreference(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function setNotificationPreference(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
}

export async function requestPermissionIfNeeded(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  const result = await Notification.requestPermission();
  return result === 'granted' ? 'granted' : 'denied';
}

export function isTerminalTransition(prev: string | null | undefined, next: string): next is 'done' | 'error' {
  return (
    (next === 'done' || next === 'error') &&
    prev != null &&
    prev !== 'done' &&
    prev !== 'error' &&
    prev !== 'cancelled'
  );
}

export function sendJobNotification(
  filename: string,
  status: 'done' | 'error',
  message?: string,
): void {
  if (!('Notification' in window)) return;
  if (!getNotificationPreference()) return;
  if (Notification.permission !== 'granted') return;

  const title = status === 'done' ? 'Download complete' : 'Download failed';
  const body = status === 'done'
    ? filename
    : `${filename}${message ? ': ' + message : ''}`;

  new Notification(title, { body, icon: '/pwa-192x192.png', tag: `job-${filename}-${status}` });
}
