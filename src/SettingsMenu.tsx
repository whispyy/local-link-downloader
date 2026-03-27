import { useState, useRef, useEffect } from 'react';
import { Settings, Sun, Moon, Monitor, Bell, BellOff, LogOut } from 'lucide-react';
import {
  isNotificationSupported,
  getNotificationPreference,
  setNotificationPreference,
  requestPermissionIfNeeded,
} from './notifications';

type Theme = 'light' | 'dark' | 'auto';
const CYCLE: Theme[] = ['light', 'dark', 'auto'];
const THEME_ICON = { light: Sun, dark: Moon, auto: Monitor } as const;
const THEME_LABEL = { light: 'Light', dark: 'Dark', auto: 'Auto' } as const;

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

  const [notifEnabled, setNotifEnabled] = useState(getNotificationPreference);

  // Apply theme
  useEffect(() => {
    localStorage.setItem('theme', theme);
    const isDark =
      theme === 'dark' ||
      (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', isDark);

    if (theme === 'auto') {
      const mq = matchMedia('(prefers-color-scheme: dark)');
      const handler = () => {
        const d = mq.matches;
        document.documentElement.classList.toggle('dark', d);
      };
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [theme]);

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
    if (!notifEnabled) {
      const granted = await requestPermissionIfNeeded();
      if (!granted) return;
      setNotificationPreference(true);
      setNotifEnabled(true);
    } else {
      setNotificationPreference(false);
      setNotifEnabled(false);
    }
  };

  const ThemeIcon = THEME_ICON[theme];
  const NotifIcon = notifEnabled ? Bell : BellOff;

  return (
    <div className="relative flex items-center" ref={menuRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-th-text-faint hover:text-th-text-sub transition"
        title="Settings"
      >
        <Settings className="w-4 h-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-th-bg border border-th-border-light rounded-lg shadow-lg py-1 z-50">
          <button
            onClick={cycleTheme}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-th-text-sub hover:bg-th-bg-alt transition"
          >
            <ThemeIcon className="w-4 h-4" />
            Theme: {THEME_LABEL[theme]}
          </button>

          {isNotificationSupported() && (
            <button
              onClick={toggleNotifications}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-th-text-sub hover:bg-th-bg-alt transition"
            >
              <NotifIcon className="w-4 h-4" />
              Notifications {notifEnabled ? 'on' : 'off'}
            </button>
          )}

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
