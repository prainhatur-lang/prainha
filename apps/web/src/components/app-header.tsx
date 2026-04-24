import Link from 'next/link';
import { AppNav } from './app-nav';
import { LogoutButton } from '../app/dashboard/logout-button';

interface Props {
  userEmail: string | undefined;
}

export function AppHeader({ userEmail }: Props) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-lg font-semibold text-slate-900">
            concilia
          </Link>
          <AppNav />
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-500">{userEmail}</span>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
