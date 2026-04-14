import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface PageTitleProps {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
}

export default function PageTitle({ icon: Icon, title, children }: PageTitleProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-6">
      <Icon className="w-6 h-6 shrink-0 text-th-text-sub" />
      <h1 className="text-xl sm:text-2xl font-semibold text-th-text">{title}</h1>
      {children}
    </div>
  );
}
