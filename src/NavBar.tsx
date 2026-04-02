import { HardDrive } from 'lucide-react';
import SettingsMenu from './SettingsMenu';

export type NavPage = 'download' | 'browse' | 'queue' | 'usage';

interface NavBarProps {
  currentPage: NavPage;
  authEnabled: boolean;
  onSignOut: () => void;
}

const BASE_LINKS: { page: NavPage; href: string; label: string }[] = [
  { page: 'download', href: '#', label: 'Download' },
  { page: 'browse', href: '#/browse', label: 'Browse' },
  { page: 'queue', href: '#/queue', label: 'Queue' },
];

const ALL_LINKS = [...BASE_LINKS, { page: 'usage' as NavPage, href: '#/usage', label: 'Usage' }];

export default function NavBar({ currentPage, authEnabled, onSignOut }: NavBarProps) {
  const maxWidth = currentPage === 'usage' ? 'max-w-6xl' : 'max-w-5xl';
  const links = currentPage === 'usage' ? ALL_LINKS : BASE_LINKS;

  return (
    <header className="sticky top-0 z-50 bg-th-bg/80 backdrop-blur-md border-b border-th-border-light pwa-safe-top">
      <div className={`${maxWidth} mx-auto flex items-center justify-between h-12 px-4 sm:px-6`}>
        <a href="#" className="text-th-text-dim hover:text-th-text transition" title="File Manager">
          <HardDrive className="w-5 h-5 sm:hidden" />
          <span className="hidden sm:inline text-sm font-medium">File Manager</span>
        </a>
        <div className="flex items-center gap-3">
          <nav className="flex items-center gap-1 text-sm">
            {links.map(({ page, href, label }) => (
              <a
                key={page}
                href={href}
                className={
                  currentPage === page
                    ? 'px-2 py-1 rounded bg-th-bg-muted text-th-text font-medium'
                    : 'px-2 py-1 rounded text-th-text-dim hover:text-th-text transition'
                }
              >
                {label}
              </a>
            ))}
          </nav>
          <SettingsMenu authEnabled={authEnabled} onSignOut={onSignOut} />
        </div>
      </div>
    </header>
  );
}
