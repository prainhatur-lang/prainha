'use client';

// Chrome do app autenticado: sidebar por área de trabalho + topbar.
// Mantém o nome/props do cabeçalho antigo porque cada página renderiza
// <AppHeader/> individualmente (não há layout autenticado compartilhado) —
// trocar aqui troca em todas. O recuo do conteúdo no desktop vem do CSS
// global `body:has([data-app-sidebar])` (globals.css), já que o conteúdo
// da página é irmão deste componente, não filho.

import { useCallback, useState } from 'react';
import { AppSidebar } from './app-sidebar';
import { LogoutButton } from '../app/dashboard/logout-button';

interface Props {
  userEmail: string | undefined;
}

function MenuIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5">
      <path d="M4 7h16M4 12h16M4 17h16" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function AppHeader({ userEmail }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const handleMobileOpenChange = useCallback((open: boolean) => setMobileOpen(open), []);

  return (
    <>
      <AppSidebar mobileOpen={mobileOpen} onMobileOpenChange={handleMobileOpenChange} />

      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
          <button
            type="button"
            aria-label="Abrir menu"
            className="rounded-lg border border-slate-200 p-2 text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-950 lg:hidden"
            onClick={() => setMobileOpen(true)}
          >
            <MenuIcon />
          </button>

          <span className="truncate text-sm font-semibold text-slate-900 lg:hidden">concilia</span>

          <div className="ml-auto flex shrink-0 items-center gap-3 text-sm">
            <span className="hidden text-slate-500 md:inline">{userEmail}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
    </>
  );
}
