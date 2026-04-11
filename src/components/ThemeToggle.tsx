import { useState, useEffect } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';

type Theme = 'light' | 'dark' | 'auto';

const CYCLE: Theme[] = ['light', 'dark', 'auto'];

function applyTheme(theme: Theme) {
  const isDark =
    theme === 'dark' ||
    (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', isDark);
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('theme');
    return stored === 'light' || stored === 'dark' ? stored : 'auto';
  });

  useEffect(() => {
    localStorage.setItem('theme', theme);
    applyTheme(theme);

    if (theme === 'auto') {
      const mq = matchMedia('(prefers-color-scheme: dark)');
      const handler = () => applyTheme('auto');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [theme]);

  const next = () => setTheme((t) => CYCLE[(CYCLE.indexOf(t) + 1) % CYCLE.length]);

  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  const label = theme === 'light' ? 'Light' : theme === 'dark' ? 'Dark' : 'Auto';

  return (
    <button
      onClick={next}
      className="text-th-text-faint hover:text-th-text-sub transition"
      title={`Theme: ${label}`}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}
