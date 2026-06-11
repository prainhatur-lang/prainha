import Link from 'next/link';
import { AppNav } from './app-nav';
import { LogoutButton } from '../app/dashboard/logout-button';

interface Props {
  userEmail: string | undefined;
}

export function AppHeader({ userEmail }: Props) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3 sm:gap-6">
          <Link href="/" className="shrink-0 text-lg font-semibold text-slate-900">
            concilia
          </Link>
          <AppNav />
        </div>
        <div className="flex shrink-0 items-center gap-3 text-sm">
          <span className="hidden text-slate-500 md:inline">{userEmail}</span>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
