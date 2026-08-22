import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { permissoesDoUsuario } from '@/lib/permissoes-runtime';
import { AppHeader } from '@/components/app-header';

export const dynamic = 'force-dynamic';

interface Tile {
  label: string;
  desc: string;
  href: string;
  icon: string;
  /** Codigo de permissao exigido pra ver esse tile. Se null = sempre visivel. */
  perm: string | null;
  soon?: boolean;
}

interface Bloco {
  titulo: string;
  cor: 'slate' | 'sky' | 'amber' | 'emerald' | 'rose' | 'violet';
  tiles: Tile[];
}

const BLOCOS: Bloco[] = [
  {
    titulo: 'Movimentação do dia a dia',
    cor: 'sky',
    tiles: [
      { icon: '💳', label: 'Contas a pagar', desc: 'Títulos em aberto, vencidos, pagos no mês', href: '/financeiro', perm: 'conta_pagar.read' },
      { icon: '💰', label: 'Contas a receber', desc: 'Saldo de conta corrente por cliente', href: '/financeiro/receber', perm: 'conta_receber.read' },
      { icon: '📦', label: 'Pedidos / Vendas', desc: 'Histórico do PDV, ticket médio, top produtos', href: '/movimento/pedidos', perm: 'conciliacao.read' },
      { icon: '📥', label: 'Entrada de notas', desc: 'Upload de XMLs de fornecedores', href: '/movimento/entrada-notas', perm: 'nota_compra.read' },
      { icon: '🍳', label: 'Ordens de produção', desc: 'OPs por cozinheiro', href: '/movimento/producao', perm: 'ordem_producao.read' },
    ],
  },
  {
    titulo: 'Compras',
    cor: 'amber',
    tiles: [
      { icon: '📝', label: 'Cotações', desc: 'Solicitar preço a fornecedores', href: '/cotacao', perm: 'cotacao.read' },
      { icon: '🧾', label: 'Pedidos de compra', desc: 'Pedidos aprovados / aguardando NF', href: '/compras/pedidos', perm: 'pedido_compra.read' },
      { icon: '⏳', label: 'Aguardando NF', desc: 'Pedidos sem NF ainda', href: '/compras/aguardando-nf', perm: 'pedido_compra.read' },
    ],
  },
  {
    titulo: 'Conciliação',
    cor: 'emerald',
    tiles: [
      { icon: '🟰', label: 'PDV × Cielo', desc: 'Operadora — cada venda no arquivo Cielo', href: '/conciliacao/operadora', perm: 'conciliacao.read' },
      { icon: '📅', label: 'Cielo × Agenda', desc: 'Recebíveis — agenda da Cielo', href: '/conciliacao/recebiveis', perm: 'conciliacao.read' },
      { icon: '🏦', label: 'Agenda × Banco', desc: 'Extrato bancário × previsto Cielo', href: '/conciliacao/banco', perm: 'conciliacao.read' },
      { icon: '📤', label: 'Upload de arquivos', desc: 'Cielo Vendas, Recebíveis, CNAB', href: '/upload', perm: 'conciliacao.read' },
      { icon: '⚠', label: 'Exceções', desc: 'Todos os pendentes, filtráveis', href: '/excecoes', perm: 'conciliacao.read' },
      { icon: '🔒', label: 'Fechamento', desc: 'Trava dias revisados', href: '/fechamento', perm: 'conciliacao.fechar' },
    ],
  },
  {
    titulo: 'Folha da equipe',
    cor: 'rose',
    tiles: [
      { icon: '📆', label: 'Folhas semanais', desc: 'Fechamentos por semana', href: '/folha-equipe/folhas', perm: 'folha_equipe.read' },
      { icon: '🧑‍🍳', label: 'Pessoas', desc: 'Equipe cadastrada', href: '/folha-equipe/pessoas', perm: 'folha_equipe.read' },
    ],
  },
  {
    titulo: 'Relatórios e análise',
    cor: 'violet',
    tiles: [
      { icon: '📊', label: 'Dashboard analítico', desc: 'KPIs de vendas, taxas, % rastreado', href: '/dashboard', perm: 'dashboard.read' },
      { icon: '📋', label: 'Relatório consolidado', desc: 'PDV → Cielo → banco', href: '/relatorio', perm: 'relatorio.read' },
      { icon: '📈', label: 'DRE', desc: 'Demonstrativo de resultado', href: '/relatorios/dre', perm: 'relatorio.read' },
      { icon: '🌊', label: 'Fluxo de caixa', desc: 'Entradas/saídas previstos vs realizados', href: '/relatorios/fluxo-caixa', perm: 'relatorio.read', soon: true },
    ],
  },
  {
    titulo: 'Cadastros',
    cor: 'amber',
    tiles: [
      { icon: '🏢', label: 'Filiais', desc: 'Dados, tokens do agente, status', href: '/sync', perm: 'configuracao.read' },
      { icon: '🏭', label: 'Fornecedores', desc: 'Empresas que emitem NF pra você', href: '/cadastros/fornecedores', perm: 'fornecedor.read' },
      { icon: '👥', label: 'Clientes', desc: 'Quem compra de você', href: '/cadastros/clientes', perm: null, soon: true },
      { icon: '📂', label: 'Plano de contas', desc: 'Categorias para DRE', href: '/cadastros/plano-contas', perm: 'configuracao.read' },
      { icon: '🛒', label: 'Produtos', desc: 'Cadastro, preço, margem, estoque', href: '/cadastros/produtos', perm: 'produto.read' },
    ],
  },
  {
    titulo: 'Configurações',
    cor: 'slate',
    tiles: [
      { icon: '⚙', label: 'Taxas / Prazos', desc: 'Por EC (TEF/Online), contrato Cielo', href: '/configuracoes', perm: 'configuracao.read' },
      { icon: '💳', label: 'Formas de pagamento', desc: 'Canal de liquidação por forma', href: '/configuracoes/formas-pagamento', perm: 'configuracao.read' },
      { icon: '🏦', label: 'Pagamento', desc: 'Credencial Cielo de cada casa', href: '/configuracoes/pagamento', perm: 'configuracao.read' },
      { icon: '📜', label: 'Certificados A1', desc: 'Certificado digital SEFAZ', href: '/configuracoes/certificados', perm: 'configuracao.certificado' },
      { icon: '🔄', label: 'Sincronização', desc: 'Status dos agentes de cada filial', href: '/sync', perm: 'configuracao.read' },
      { icon: '🔐', label: 'Usuários', desc: 'Acesso por filial', href: '/configuracoes/usuarios', perm: 'usuario.read' },
      { icon: '👥', label: 'Grupos e permissões', desc: 'Grupos de acesso (Admin, Gerente, etc.)', href: '/configuracoes/grupos', perm: 'grupo_usuario.read' },
    ],
  },
];

const COR_MAP: Record<Bloco['cor'], { titulo: string; tile: string }> = {
  slate: { titulo: 'text-slate-700', tile: 'hover:border-slate-400' },
  sky: { titulo: 'text-sky-700', tile: 'hover:border-sky-400' },
  amber: { titulo: 'text-amber-700', tile: 'hover:border-amber-400' },
  emerald: { titulo: 'text-emerald-700', tile: 'hover:border-emerald-400' },
  rose: { titulo: 'text-rose-700', tile: 'hover:border-rose-400' },
  violet: { titulo: 'text-violet-700', tile: 'hover:border-violet-400' },
};

export default async function InicioPage(props: {
  searchParams: Promise<{ erro?: string; p?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const sp = await props.searchParams;
  const erroSemPerm = sp.erro === 'sem-permissao' ? (sp.p ?? null) : null;

  const [filiais, perms] = await Promise.all([
    filiaisDoUsuario(user.id),
    permissoesDoUsuario(user.id),
  ]);

  // Filtra tiles por permissao. Se perm=null, sempre visivel.
  // Se o user nao tem nenhuma permissao mas tem role DONO em alguma filial
  // (legado pre-migration), permite tudo como fallback.
  const ehDonoLegado = perms.size === 0 && filiais.some((f) => f.role === 'DONO');
  function visivel(t: Tile): boolean {
    if (ehDonoLegado) return true;
    if (t.perm === null) return true;
    return perms.has(t.perm);
  }

  const blocosVisiveis = BLOCOS.map((b) => ({
    ...b,
    tiles: b.tiles.filter(visivel),
  })).filter((b) => b.tiles.length > 0);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Bem-vindo de volta</h1>
            <p className="mt-1 text-sm text-slate-600">
              Acesso rápido aos módulos. {filiais.length} filial{filiais.length !== 1 ? 'is' : ''} ativa{filiais.length !== 1 ? 's' : ''}.
            </p>
          </div>
        </div>

        {erroSemPerm && (
          <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <strong>Acesso negado.</strong> Você não tem permissão para acessar essa
            página{erroSemPerm ? ` (${erroSemPerm})` : ''}. Procure o administrador da
            organização.
          </div>
        )}

        {blocosVisiveis.length === 0 ? (
          <div className="mt-10 rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
            Seu usuário ainda não tem permissões atribuídas. Procure o administrador
            da organização.
          </div>
        ) : (
          <div className="mt-8 space-y-10">
            {blocosVisiveis.map((b) => {
              const cor = COR_MAP[b.cor];
              return (
                <div key={b.titulo}>
                  <h2 className={`text-sm font-semibold uppercase tracking-wide ${cor.titulo}`}>
                    {b.titulo}
                  </h2>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {b.tiles.map((t) => {
                      const content = (
                        <div
                          className={`flex h-full items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 transition ${
                            t.soon ? 'opacity-60' : `cursor-pointer hover:shadow-md ${cor.tile}`
                          }`}
                        >
                          <div className="text-2xl leading-none">{t.icon}</div>
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-slate-900">
                              {t.label}
                              {t.soon && (
                                <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-500">
                                  em breve
                                </span>
                              )}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-600">{t.desc}</p>
                          </div>
                        </div>
                      );
                      return t.soon ? (
                        <div key={t.label}>{content}</div>
                      ) : (
                        <Link key={t.label} href={t.href}>
                          {content}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
