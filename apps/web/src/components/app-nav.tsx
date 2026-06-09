'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';

interface Notificacoes {
  opsAguardandoRevisao: number;
}

interface LinkItem {
  label: string;
  href: string;
  /** Codigo de permissao exigido. Se omitido = sempre visivel. */
  perm?: string;
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
      { label: 'Filiais', href: '/sync', perm: 'configuracao.read' },
      { label: 'Fornecedores', href: '/cadastros/fornecedores', perm: 'fornecedor.read' },
      { label: 'Clientes', href: '/cadastros/clientes', soon: true },
      { label: 'Plano de contas', href: '/cadastros/plano-contas', perm: 'configuracao.read' },
      { label: 'Produtos', href: '/cadastros/produtos', perm: 'produto.read' },
      { label: 'Templates de produção', href: '/cadastros/templates-producao', perm: 'ordem_producao.read' },
      { label: 'Cozinheiros', href: '/cadastros/colaboradores', perm: 'folha_equipe.read' },
    ],
  },
  {
    label: 'Movimentação',
    links: [
      { label: 'Contas a pagar', href: '/financeiro', perm: 'conta_pagar.read' },
      { label: 'Contas a receber', href: '/financeiro/receber', perm: 'conta_receber.read' },
      { label: 'Pagamentos (PDV)', href: '/financeiro/pagamentos', perm: 'conciliacao.read' },
      { label: 'Pedidos / Vendas', href: '/movimento/pedidos', perm: 'conciliacao.read' },
      { label: 'Entrada de notas', href: '/movimento/entrada-notas', perm: 'nota_compra.read' },
      { label: 'Ordens de produção', href: '/movimento/producao', perm: 'ordem_producao.read' },
    ],
  },
  {
    label: 'Reservas',
    links: [
      { label: 'Agenda de reservas', href: '/reservas', perm: 'reserva.read' },
      { label: 'Lista de espera', href: '/lista-espera', perm: 'lista_espera.read' },
    ],
  },
  {
    label: 'Folha da equipe',
    links: [
      { label: 'Folhas semanais', href: '/folha-equipe/folhas', perm: 'folha_equipe.read' },
      { label: 'Pessoas', href: '/folha-equipe/pessoas', perm: 'folha_equipe.read' },
      { label: 'Configuração da folha', href: '/folha-equipe/configuracao', perm: 'folha_equipe.read' },
    ],
  },
  {
    label: 'Compras',
    links: [
      { label: 'Sugestão de compra', href: '/compras/sugestao', perm: 'cotacao.read' },
      { label: 'Cotações', href: '/cotacao', perm: 'cotacao.read' },
      { label: 'Pedidos de compra', href: '/compras/pedidos', perm: 'pedido_compra.read' },
      { label: 'Aguardando NF', href: '/compras/aguardando-nf', perm: 'pedido_compra.read' },
      { label: 'Revisar items de NF', href: '/compras/match-items', perm: 'nota_compra.vincular_produto' },
      { label: 'Categorizar produtos do Consumer', href: '/cadastros/produtos/categorizar', perm: 'produto.categorizar' },
      { label: 'Reconciliação produto × fornecedor', href: '/compras/reconciliacao', perm: 'produto.vincular_fornecedor' },
    ],
  },
  {
    label: 'Conciliação',
    links: [
      { label: 'PDV × Cielo (Operadora)', href: '/conciliacao/operadora', perm: 'conciliacao.read' },
      { label: 'Cielo × Agenda (Recebíveis)', href: '/conciliacao/recebiveis', perm: 'conciliacao.read' },
      { label: 'Agenda × Banco', href: '/conciliacao/banco', perm: 'conciliacao.read' },
      { label: 'PDV × Banco direto', href: '/conciliacao/pdv-banco-direto', perm: 'conciliacao.read' },
      { label: 'Sugestões cross-route', href: '/conciliacao/cross-route-sugestoes', perm: 'conciliacao.read' },
      { label: 'Upload de arquivos', href: '/upload', perm: 'conciliacao.read' },
      { label: 'Exceções', href: '/excecoes', perm: 'conciliacao.read' },
      { label: 'Fechamento', href: '/fechamento', perm: 'conciliacao.fechar' },
    ],
  },
  {
    label: 'Relatórios',
    links: [
      { label: 'Avaliações de clientes', href: '/avaliacoes', perm: 'avaliacao.read' },
      { label: 'Dashboard analítico', href: '/dashboard', perm: 'relatorio.read' },
      { label: 'Relatório consolidado', href: '/relatorio', perm: 'relatorio.read' },
      { label: 'Estoque', href: '/relatorios/estoque', perm: 'relatorio.read' },
      { label: 'Movimentos de estoque', href: '/relatorios/movimentos', perm: 'relatorio.read' },
      { label: 'Produção (perda por cozinheiro)', href: '/relatorios/producao', perm: 'relatorio.read' },
      { label: 'DRE', href: '/relatorios/dre', perm: 'relatorio.read' },
      { label: 'Fechamento mensal (histórico)', href: '/relatorios/fechamento-mensal', perm: 'relatorio.read' },
      { label: 'Fluxo de caixa', href: '/relatorios/fluxo-caixa', perm: 'relatorio.read', soon: true },
    ],
  },
  {
    label: 'Configurações',
    links: [
      { label: 'Diagnóstico do sistema', href: '/diagnostico', perm: 'configuracao.read' },
      { label: 'Filial / Taxas', href: '/configuracoes', perm: 'configuracao.read' },
      { label: 'Formas de pagamento', href: '/configuracoes/formas-pagamento', perm: 'configuracao.read' },
      { label: 'Certificados A1', href: '/configuracoes/certificados', perm: 'configuracao.certificado' },
      { label: 'Sincronização (agentes)', href: '/sync', perm: 'configuracao.read' },
      { label: 'Usuários', href: '/configuracoes/usuarios', perm: 'usuario.read' },
      { label: 'Grupos e permissões', href: '/configuracoes/grupos', perm: 'grupo_usuario.read' },
    ],
  },
];

type Role = 'DONO' | 'GERENTE' | 'COMPRAS' | 'FINANCEIRO';

export function AppNav() {
  const pathname = usePathname();
  const [aberto, setAberto] = useState<string | null>(null);
  const [notif, setNotif] = useState<Notificacoes>({ opsAguardandoRevisao: 0 });
  const [role, setRole] = useState<Role | null>(null);
  const [perms, setPerms] = useState<Set<string> | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Carrega role + perms do usuario uma vez na montagem
  useEffect(() => {
    let cancelado = false;
    fetch('/api/usuario/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelado) return;
        if (d?.role) setRole(d.role as Role);
        if (Array.isArray(d?.perms)) setPerms(new Set<string>(d.perms));
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, []);

  // Filtra links por permissao. Fallback: se nao carregou ainda (perms null),
  // esconde tudo pra evitar flash do menu completo. Se carregou e ta vazio,
  // mas role legado é DONO/GERENTE, usa fallback amplo (compat pre-migration).
  function podeVer(linkPerm?: string): boolean {
    if (!linkPerm) return true;
    if (perms === null) return false;
    if (perms.has(linkPerm)) return true;
    // Fallback legado: DONO ve tudo, GERENTE ve quase tudo (sem certificado e admin)
    if (perms.size === 0 && role === 'DONO') return true;
    if (
      perms.size === 0 &&
      role === 'GERENTE' &&
      linkPerm !== 'configuracao.certificado' &&
      !linkPerm.startsWith('usuario.') &&
      !linkPerm.startsWith('grupo_usuario.')
    )
      return true;
    return false;
  }

  const gruposVisiveis = GRUPOS.map((g) => ({
    ...g,
    links: g.links.filter((l) => l.soon || podeVer(l.perm)),
  })).filter((g) => g.links.length > 0);

  useEffect(() => {
    function handleClickFora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(null);
    }
    window.addEventListener('click', handleClickFora);
    return () => window.removeEventListener('click', handleClickFora);
  }, []);

  // Polling de notificações a cada 60s
  useEffect(() => {
    let cancelado = false;
    async function carregar() {
      try {
        const r = await fetch('/api/notificacoes', { cache: 'no-store' });
        if (!r.ok) return;
        const d = (await r.json()) as Notificacoes;
        if (!cancelado) setNotif(d);
      } catch {
        // silencioso — falha não bloqueia uso do app
      }
    }
    carregar();
    const id = setInterval(carregar, 60_000);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, [pathname]);

  // Badge total no grupo Movimentação (ordens de produção pra revisar)
  const totalRevisar = notif.opsAguardandoRevisao;

  const grupoAtivo = gruposVisiveis.find((g) =>
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
      {gruposVisiveis.map((g) => {
        const isAtivo = grupoAtivo?.label === g.label;
        const isAberto = aberto === g.label;
        const ehMovimentacao = g.label === 'Movimentação';
        const mostrarBadgeGrupo = ehMovimentacao && totalRevisar > 0;
        return (
          <div key={g.label} className="relative">
            <button
              type="button"
              onClick={() => setAberto(isAberto ? null : g.label)}
              className={`relative rounded-md px-2.5 py-1 ${
                isAtivo
                  ? 'text-slate-900 font-medium'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {g.label}
              <span className="ml-1 text-xs text-slate-400">▾</span>
              {mostrarBadgeGrupo && (
                <span
                  className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-emerald-600 px-1 text-[9px] font-bold text-white shadow"
                  title={`${totalRevisar} OP(s) aguardando revisão`}
                >
                  {totalRevisar > 99 ? '99+' : totalRevisar}
                </span>
              )}
            </button>
            {isAberto && (
              <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                {g.links.map((l) => {
                  const isRotaAtual = !l.soon && pathname === l.href;
                  const ehProducao = l.href === '/movimento/producao';
                  const mostrarBadgeLink = ehProducao && totalRevisar > 0;
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
                      {mostrarBadgeLink && (
                        <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[9px] font-bold text-white">
                          ⏳ {totalRevisar}
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
