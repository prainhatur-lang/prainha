'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { FilialSwitcher } from './filial-switcher';
import {
  MENU_AREAS,
  isRouteActive,
  normalizarBusca,
  type MenuArea,
  type MenuIconName,
  type MenuLinkItem,
  type NotificationKey,
} from './menu-config';

interface ResultadoBusca {
  link: MenuLinkItem;
  area: string;
  secao?: string;
  /** Nome antigo ou palavra que bateu com a busca, quando não foi o nome atual. */
  tambem?: string;
  pontos: number;
}

interface Notificacoes {
  opsAguardandoRevisao: number;
}

type Role = 'DONO' | 'GERENTE' | 'COMPRAS' | 'FINANCEIRO';

interface AppSidebarProps {
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
  brand?: ReactNode;
}

const NOTIFICACOES_VAZIAS: Notificacoes = {
  opsAguardandoRevisao: 0,
};

function Icon({ name, className = 'h-5 w-5' }: { name: MenuIconName; className?: string }) {
  const common = {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (name) {
    case 'home':
      return (
        <svg {...common}>
          <path d="m3 10 9-7 9 7" />
          <path d="M5 9.5V21h14V9.5" />
          <path d="M9 21v-7h6v7" />
        </svg>
      );
    case 'operation':
      return (
        <svg {...common}>
          <path d="M4 21V7l8-4 8 4v14" />
          <path d="M8 11h8M8 15h8M8 19h8" />
        </svg>
      );
    case 'clients':
      return (
        <svg {...common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'inventory':
      return (
        <svg {...common}>
          <path d="m21 8-9 5-9-5 9-5 9 5Z" />
          <path d="m3 8 9 5 9-5M3 12l9 5 9-5M3 16l9 5 9-5" />
        </svg>
      );
    case 'finance':
      return (
        <svg {...common}>
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <path d="M2 10h20M7 15h2" />
        </svg>
      );
    case 'people':
      return (
        <svg {...common}>
          <circle cx="12" cy="7" r="4" />
          <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
        </svg>
      );
    case 'admin':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.17.38.38.72.6 1 .3.3.7.45 1.1.4H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
        </svg>
      );
    case 'marketing':
      return (
        <svg {...common}>
          <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M18.5 5.5a9 9 0 0 1 0 13" />
        </svg>
      );
    case 'menu':
      return (
        <svg {...common}>
          <path d="M3 2v7a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V2" />
          <path d="M7 2v20" />
          <path d="M21 15V2a5 5 0 0 0-5 5v6a2 2 0 0 0 2 2h3Zm0 0v7" />
        </svg>
      );
    case 'fiscal':
      return (
        <svg {...common}>
          <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
          <path d="M8 8h8M8 12h8M8 16h5" />
        </svg>
      );
    case 'reports':
      return (
        <svg {...common}>
          <path d="M3 3v18h18" />
          <path d="M8 17v-4M13 17V7M18 17v-7" />
        </svg>
      );
  }
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="h-4 w-4 shrink-0"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
    >
      <path d="m5 7.5 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5">
      <path d="M6 6l12 12M18 6 6 18" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function Badge({ value }: { value: number }) {
  if (value <= 0) return null;
  return (
    <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
      {value > 99 ? '99+' : value}
    </span>
  );
}

export function AppSidebar({ mobileOpen, onMobileOpenChange, brand }: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [role, setRole] = useState<Role | null>(null);
  const [perms, setPerms] = useState<Set<string> | null>(null);
  const [soContador, setSoContador] = useState(false);
  // Instância dos clientes do SaaS: esconde os itens `interno` (E.B., Lelis, energia).
  const [instanciaClientes, setInstanciaClientes] = useState(false);
  const [busca, setBusca] = useState('');
  const [notificacoes, setNotificacoes] = useState<Notificacoes>(NOTIFICACOES_VAZIAS);
  // Área aberta = escolha manual do usuário; sem escolha, abre a área da rota
  // atual (e Início como default). Derivado, não sincronizado por effect.
  const [areaOverrides, setAreaOverrides] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    let cancelled = false;

    fetch('/api/usuario/me', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (
          data: { role?: Role; perms?: string[]; soContador?: boolean; instanciaClientes?: boolean } | null,
        ) => {
        if (cancelled) return;
        if (data?.role) setRole(data.role);
        setSoContador(!!data?.soContador);
        setInstanciaClientes(!!data?.instanciaClientes);
        setPerms(new Set(Array.isArray(data?.perms) ? data.perms : []));
        },
      )
      .catch(() => {
        if (!cancelled) setPerms(new Set());
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function carregarNotificacoes() {
      try {
        const response = await fetch('/api/notificacoes', { cache: 'no-store' });
        if (!response.ok) return;
        const data = (await response.json()) as Partial<Notificacoes>;
        if (!cancelled) {
          setNotificacoes({
            opsAguardandoRevisao: Number(data.opsAguardandoRevisao ?? 0),
          });
        }
      } catch {
        // silencioso — falha no polling não bloqueia a navegação
      }
    }

    void carregarNotificacoes();
    const timer = window.setInterval(carregarNotificacoes, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pathname]);

  // Mesmo contrato de visibilidade do menu antigo: perms null = ainda
  // carregando (esconde tudo pra não dar flash); fallback legado pra
  // DONO/GERENTE sem grupo migrado.
  function podeVer(permission?: string): boolean {
    if (!permission) return true;
    if (perms === null) return false;
    if (perms.has(permission)) return true;
    if (perms.size === 0 && role === 'DONO') return true;
    if (
      perms.size === 0 &&
      role === 'GERENTE' &&
      permission !== 'configuracao.certificado' &&
      !permission.startsWith('usuario.') &&
      !permission.startsWith('grupo_usuario.') &&
      // Ouvidoria é anônima justamente pra permitir denunciar o gerente de
      // turno — o link/menu não pode nem aparecer pra ele. Ver
      // catalogo-permissoes.ts (grupo Gerente tem a mesma exclusão).
      !permission.startsWith('ouvidoria.') &&
      permission !== 'clima.comentarios' &&
      // Histórico de faturamento (VGV) é só do dono — mesma exclusão do
      // grupo Gerente no catálogo.
      !permission.startsWith('faturamento_historico.')
    ) {
      return true;
    }
    return false;
  }

  // Tudo que a pessoa pode abrir (inclui as telas "só na busca").
  const allowedAreas = useMemo<MenuArea[]>(
    () =>
      MENU_AREAS.map((area) => ({
        ...area,
        sections: area.sections
          .map((section) => ({
            ...section,
            links: section.links.filter(
              (link) =>
                podeVer(link.perm) &&
                !(link.semContador && soContador) &&
                !(link.interno && instanciaClientes),
            ),
          }))
          .filter((section) => section.links.length > 0),
      })).filter((area) => area.sections.length > 0),
    // role/perms são os únicos valores que mudam a visibilidade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [perms, role, soContador, instanciaClientes],
  );

  // O que ocupa linha no menu: sem as telas que só aparecem na busca.
  const visibleAreas = useMemo<MenuArea[]>(
    () =>
      allowedAreas
        .map((area) => ({
          ...area,
          sections: area.sections
            .map((section) => ({ ...section, links: section.links.filter((link) => !link.soNaBusca) }))
            .filter((section) => section.links.length > 0),
        }))
        .filter((area) => area.sections.length > 0),
    [allowedAreas],
  );

  const activeHref = useMemo(() => {
    return visibleAreas
      .flatMap((area) => area.sections.flatMap((section) => section.links))
      .filter((link) => !link.soon && isRouteActive(pathname, link.href))
      .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  }, [pathname, visibleAreas]);

  const activeAreaId = useMemo(() => {
    const doMenu = visibleAreas.find((area) =>
      area.sections.some((section) => section.links.some((link) => link.href === activeHref)),
    )?.id;
    if (doMenu) return doMenu;
    // Tela "só na busca" aberta (ex.: Admissão): abre a área dela no menu.
    return allowedAreas.find((area) =>
      area.sections.some((section) =>
        section.links.some((link) => link.soNaBusca && isRouteActive(pathname, link.href)),
      ),
    )?.id;
  }, [activeHref, visibleAreas, allowedAreas, pathname]);

  const resultadosBusca = useMemo<ResultadoBusca[]>(() => {
    const termos = normalizarBusca(busca).split(/\s+/).filter(Boolean);
    if (termos.length === 0) return [];
    const frase = termos.join(' ');
    const vistos = new Set<string>();
    const achados: ResultadoBusca[] = [];
    for (const area of allowedAreas) {
      for (const section of area.sections) {
        for (const link of section.links) {
          if (link.soon || vistos.has(link.href)) continue;
          const nome = normalizarBusca(link.label);
          const apelidos = (link.aka ?? []).map((original) => ({ original, norm: normalizarBusca(original) }));
          const contexto = normalizarBusca(`${area.label} ${section.label ?? ''}`);
          const tudo = [nome, ...apelidos.map((a) => a.norm), contexto].join(' | ');
          if (!termos.every((termo) => tudo.includes(termo))) continue;

          let pontos = 0;
          if (nome.startsWith(frase)) pontos = 4;
          else if (nome.includes(frase)) pontos = 3;
          else if (termos.every((termo) => nome.includes(termo))) pontos = 2;

          let tambem: string | undefined;
          if (pontos < 2) {
            // Mostra o nome antigo/palavra que bateu (o mais longo é o mais claro).
            tambem = apelidos
              .filter((a) => termos.some((termo) => a.norm.includes(termo)))
              .sort((a, b) => b.original.length - a.original.length)[0]?.original;
            if (tambem) pontos = 1;
          }

          vistos.add(link.href);
          achados.push({ link, area: area.label, secao: section.label, tambem, pontos });
        }
      }
    }
    // sort estável: dentro da mesma nota, segue a ordem do menu.
    return achados.sort((a, b) => b.pontos - a.pontos).slice(0, 30);
  }, [busca, allowedAreas]);

  useEffect(() => {
    onMobileOpenChange(false);
    setBusca('');
  }, [pathname, onMobileOpenChange]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onMobileOpenChange(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onMobileOpenChange]);

  function notificationValue(key?: NotificationKey): number {
    return key ? notificacoes[key] : 0;
  }

  function isExpanded(areaId: string): boolean {
    return areaOverrides.get(areaId) ?? (areaId === activeAreaId || areaId === 'inicio');
  }

  function toggleArea(areaId: string) {
    const next = !isExpanded(areaId);
    setAreaOverrides((current) => new Map(current).set(areaId, next));
  }

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="Fechar menu"
          className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-[1px] lg:hidden"
          onClick={() => onMobileOpenChange(false)}
        />
      )}

      <aside
        data-app-sidebar
        aria-label="Navegação principal"
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-slate-200 bg-white shadow-xl transition-transform duration-200 lg:translate-x-0 lg:shadow-none ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 px-4">
          {brand ?? (
            <Link href="/" className="flex min-w-0 items-center gap-3" aria-label="Concilia — Início">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-950 text-sm font-black text-white shadow-sm">
                C
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold tracking-tight text-slate-950">Concilia</span>
                <span className="block truncate text-[11px] font-medium text-slate-500">gestão</span>
              </span>
            </Link>
          )}

          <button
            type="button"
            aria-label="Fechar menu"
            className="ml-auto rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 lg:hidden"
            onClick={() => onMobileOpenChange(false)}
          >
            <CloseIcon />
          </button>
        </div>

        <FilialSwitcher />

        <div className="shrink-0 border-b border-slate-200 px-3 py-2.5">
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-slate-400 focus-within:border-slate-400 focus-within:bg-white focus-within:text-slate-600">
            <SearchIcon />
            <input
              type="search"
              value={busca}
              onChange={(event) => setBusca(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  const primeiro = resultadosBusca[0];
                  if (!primeiro) return;
                  event.preventDefault();
                  setBusca('');
                  onMobileOpenChange(false);
                  router.push(primeiro.link.href);
                } else if (event.key === 'Escape' && busca) {
                  // Primeiro Esc limpa a busca; o próximo fecha o menu no celular.
                  event.preventDefault();
                  event.stopPropagation();
                  setBusca('');
                }
              }}
              placeholder="Buscar no menu…"
              aria-label="Buscar no menu"
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-xs text-slate-900 outline-none placeholder:text-slate-400 [&::-webkit-search-cancel-button]:hidden"
            />
            {busca && (
              <button
                type="button"
                aria-label="Limpar busca"
                onClick={() => setBusca('')}
                className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-3.5 w-3.5">
                  <path d="M6 6l12 12M18 6 6 18" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </label>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          {busca.trim() ? (
            resultadosBusca.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-slate-500">
                Nada com “{busca.trim()}”.
              </p>
            ) : (
              <div className="space-y-0.5">
                {resultadosBusca.map((resultado, index) => (
                  <Link
                    key={resultado.link.href}
                    href={resultado.link.href}
                    onClick={() => {
                      setBusca('');
                      onMobileOpenChange(false);
                    }}
                    className={`block rounded-lg px-2.5 py-2 transition-colors hover:bg-slate-100 ${
                      index === 0 ? 'bg-slate-50 ring-1 ring-inset ring-slate-200' : ''
                    }`}
                  >
                    <span className="block truncate text-xs font-semibold text-slate-900">
                      {resultado.link.label}
                    </span>
                    <span className="block truncate text-[10px] text-slate-500">
                      {resultado.area}
                      {resultado.secao ? ` › ${resultado.secao}` : ''}
                    </span>
                    {resultado.tambem && (
                      <span className="block truncate text-[10px] text-emerald-700">
                        também: {resultado.tambem}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            )
          ) : (
          <div className="space-y-1">
            {visibleAreas.map((area) => {
              const expanded = isExpanded(area.id);
              const areaActive = area.id === activeAreaId;
              const areaBadge = notificationValue(area.badge);

              return (
                <div key={area.id} className="rounded-xl">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={`menu-area-${area.id}`}
                    onClick={() => toggleArea(area.id)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
                      areaActive
                        ? 'bg-slate-950 text-white shadow-sm'
                        : 'text-slate-700 hover:bg-slate-100 hover:text-slate-950'
                    }`}
                  >
                    <Icon name={area.icon} />
                    <span className="min-w-0 flex-1 truncate">{area.label}</span>
                    {!areaActive && <Badge value={areaBadge} />}
                    <ChevronIcon open={expanded} />
                  </button>

                  {expanded && (
                    <div id={`menu-area-${area.id}`} className="pb-2 pl-5 pt-1.5">
                      <div className="border-l border-slate-200 pl-3">
                        {area.sections.map((section, sectionIndex) => (
                          <div
                            key={section.label ?? `${area.id}-${sectionIndex}`}
                            className={sectionIndex > 0 ? 'mt-4' : ''}
                          >
                            {section.label && (
                              <p className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                                {section.label}
                              </p>
                            )}

                            <div className="space-y-0.5">
                              {section.links.map((link) => {
                                const active = !link.soon && link.href === activeHref;
                                const linkBadge = notificationValue(link.badge);

                                if (link.soon) {
                                  return (
                                    <span
                                      key={link.href}
                                      className="flex cursor-not-allowed items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-slate-400"
                                      title="Funcionalidade em breve"
                                    >
                                      <span className="min-w-0 flex-1 truncate">{link.label}</span>
                                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                                        Em breve
                                      </span>
                                    </span>
                                  );
                                }

                                return (
                                  <Link
                                    key={link.href}
                                    href={link.href}
                                    aria-current={active ? 'page' : undefined}
                                    onClick={() => onMobileOpenChange(false)}
                                    className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors ${
                                      active
                                        ? 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200'
                                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
                                    }`}
                                  >
                                    <span
                                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                        active ? 'bg-emerald-600' : 'bg-slate-300'
                                      }`}
                                    />
                                    <span className="min-w-0 flex-1 truncate">{link.label}</span>
                                    <Badge value={linkBadge} />
                                  </Link>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          )}
        </nav>
      </aside>
    </>
  );
}
