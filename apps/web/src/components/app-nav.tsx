'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';

interface LinkItem {
  label: string;
  href: string;
  soon?: boolean;
}

interface Grupo {
  label: string;
  links: LinkItem[];
}

const GRUPOS: Grupo[] = [
  {
    label: 'Cadastros',
    links: [
      { label: 'Filiais', href: '/sync' },
      { label: 'Fornecedores', href: '/cadastros/fornecedores' },
      { label: 'Clientes', href: '/cadastros/clientes', soon: true },
      { label: 'Plano de contas', href: '/cadastros/plano-contas' },
      { label: 'Produtos', href: '/cadastros/produtos' },
    ],
  },
  {
    label: 'Movimentação',
    links: [
      { label: 'Contas a pagar', href: '/financeiro' },
      { label: 'Contas a receber', href: '/financeiro/receber' },
      { label: 'Pedidos / Vendas', href: '/movimento/pedidos' },
      { label: 'Entrada de notas', href: '/movimento/entrada-notas' },
      { label: 'Ordens de produção', href: '/movimento/producao' },
    ],
  },
  {
    label: 'Conciliação',
    links: [
      { label: 'PDV × Cielo (Operadora)', href: '/conciliacao/operadora' },
      { label: 'Cielo × Agenda (Recebíveis)', href: '/conciliacao/recebiveis' },
      { label: 'Agenda × Banco', href: '/conciliacao/banco' },
      { label: 'Upload de arquivos', href: '/upload' },
      { label: 'Exceções', href: '/excecoes' },
      { label: 'Fechamento', href: '/fechamento' },
    ],
  },
  {
    label: 'Relatórios',
    links: [
      { label: 'Dashboard analítico', href: '/dashboard' },
      { label: 'Relatório consolidado', href: '/relatorio' },
      { label: 'Estoque', href: '/relatorios/estoque' },
      { label: 'Movimentos de estoque', href: '/relatorios/movimentos' },
      { label: 'DRE', href: '/relatorios/dre' },
      { label: 'Fluxo de caixa', href: '/relatorios/fluxo-caixa', soon: true },
    ],
  },
  {
    label: 'Configurações',
    links: [
      { label: 'Filial / Taxas', href: '/configuracoes' },
      { label: 'Formas de pagamento', href: '/configuracoes/formas-pagamento' },
      { label: 'Certificados A1', href: '/configuracoes/certificados' },
      { label: 'Sincronização (agentes)', href: '/sync' },
      { label: 'Usuários', href: '/configuracoes/usuarios', soon: true },
    ],
  },
];

export function AppNav() {
  const pathname = usePathname();
  const [aberto, setAberto] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickFora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(null);
    }
    window.addEventListener('click', handleClickFora);
    return () => window.removeEventListener('click', handleClickFora);
  }, []);

  const grupoAtivo = GRUPOS.find((g) =>
    g.links.some((l) => !l.soon && pathname.startsWith(l.href) && l.href !== '/'),
  );

  return (
    <nav
      ref={ref}
      className="flex items-center gap-1 text-sm"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setAberto(null);
      }}
    >
      <Link
        href="/"
        className={`rounded-md px-2.5 py-1 ${
          pathname === '/'
            ? 'bg-slate-900 text-white'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        }`}
      >
        Início
      </Link>
      {GRUPOS.map((g) => {
        const isAtivo = grupoAtivo?.label === g.label;
        const isAberto = aberto === g.label;
        return (
          <div key={g.label} className="relative">
            <button
              type="button"
              onClick={() => setAberto(isAberto ? null : g.label)}
              className={`rounded-md px-2.5 py-1 ${
                isAtivo
                  ? 'text-slate-900 font-medium'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {g.label}
              <span className="ml-1 text-xs text-slate-400">▾</span>
            </button>
            {isAberto && (
              <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                {g.links.map((l) => {
                  const isRotaAtual = !l.soon && pathname === l.href;
                  return (
                    <Link
                      key={l.href}
                      href={l.soon ? '#' : l.href}
                      onClick={(e) => {
                        if (l.soon) e.preventDefault();
                        else setAberto(null);
                      }}
                      className={`flex items-center justify-between px-3 py-1.5 text-xs ${
                        l.soon
                          ? 'cursor-not-allowed text-slate-400'
                          : isRotaAtual
                            ? 'bg-slate-100 font-medium text-slate-900'
                            : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span>{l.label}</span>
                      {l.soon && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-500">
                          em breve
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
