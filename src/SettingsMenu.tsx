import { useState, useRef, useEffect } from 'react';
import { Settings, Sun, Moon, Monitor, Bell, BellOff, LogOut, ShieldOff, BellMinus } from 'lucide-react';
import {
  getNotificationStatus,
  setNotificationPreference,
  requestPermissionIfNeeded,
  NotificationStatus,
} from './notifications';

type Theme = 'light' | 'dark' | 'auto';
const CYCLE: Theme[] = ['light', 'dark', 'auto'];
const THEME_ICON = { light: Sun, dark: Moon, auto: Monitor } as const;
const THEME_LABEL = { light: 'Light', dark: 'Dark', auto: 'Auto' } as const;

const UNAVAILABLE_HINTS: Record<string, string> = {
  'unsupported': 'Your browser does not support notifications',
  'insecure-context': 'Notifications require HTTPS or localhost',
  'denied': 'Notifications blocked — check your browser settings',
};

interface SettingsMenuProps {
  authEnabled: boolean;
  onSignOut: () => void;
}

export default function SettingsMenu({ authEnabled, onSignOut }: SettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('theme');
    return stored === 'light' || stored === 'dark' ? stored : 'auto';
  });

  const [notifStatus, setNotifStatus] = useState<NotificationStatus>(getNotificationStatus);

  // Apply theme
  useEffect(() => {
    const applyDark = (isDark: boolean) => {
      document.documentElement.classList.toggle('dark', isDark);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark ? '#0f172a' : '#f8fafc');
    };

    localStorage.setItem('theme', theme);
    const isDark =
      theme === 'dark' ||
      (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    applyDark(isDark);

    if (theme === 'auto') {
      const mq = matchMedia('(prefers-color-scheme: dark)');
      const handler = () => applyDark(mq.matches);
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [theme]);

  // Refresh status when menu opens (permission may have changed)
  useEffect(() => {
    if (open) setNotifStatus(getNotificationStatus());
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const cycleTheme = () => setTheme((t) => CYCLE[(CYCLE.indexOf(t) + 1) % CYCLE.length]);

  const toggleNotifications = async () => {
    if (!notifStatus.available) return;

    if (!notifStatus.enabled) {
      const result = await requestPermissionIfNeeded();
      if (result !== 'granted') {
        setNotifStatus(getNotificationStatus());
        return;
      }
      setNotificationPreference(true);
      setNotifStatus({ available: true, enabled: true });
    } else {
      setNotificationPreference(false);
      setNotifStatus({ available: true, enabled: false });
    }
  };

  const ThemeIcon = THEME_ICON[theme];

  const renderNotificationItem = () => {
    if (!notifStatus.available) {
      const hint = UNAVAILABLE_HINTS[notifStatus.reason];
      const Icon = notifStatus.reason === 'insecure-context' ? ShieldOff : BellMinus;
      return (
        <div className="px-3 py-2">
          <div className="flex items-center gap-2.5 text-sm text-th-text-faint">
            <Icon className="w-4 h-4 shrink-0" />
            <span>Notifications</span>
          </div>
          <p className="mt-1 ml-6.5 text-xs text-th-text-faint">{hint}</p>
        </div>
      );
    }

    const NotifIcon = notifStatus.enabled ? Bell : BellOff;
    return (
      <button
        onClick={toggleNotifications}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-th-text-sub hover:bg-th-bg-alt transition"
      >
        <NotifIcon className="w-4 h-4" />
        Notifications {notifStatus.enabled ? 'on' : 'off'}
      </button>
    );
  };

  return (
    <div className="relative flex items-center" ref={menuRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="-m-2 p-2 text-th-text-faint hover:text-th-text-sub transition"
        title="Settings"
      >
        <Settings className="w-4 h-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 bg-th-bg border border-th-border-light rounded-lg shadow-lg py-1 z-50">
          <button
            onClick={cycleTheme}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-th-text-sub hover:bg-th-bg-alt transition"
          >
            <ThemeIcon className="w-4 h-4" />
            Theme: {THEME_LABEL[theme]}
          </button>

          {renderNotificationItem()}

          {authEnabled && (
            <>
              <div className="border-t border-th-border-light my-1" />
              <button
                onClick={() => { setOpen(false); onSignOut(); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-th-text-sub hover:bg-th-bg-alt transition"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
