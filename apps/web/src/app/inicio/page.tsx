import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { AppNav } from '@/components/app-nav';
import { LogoutButton } from '../dashboard/logout-button';

export const dynamic = 'force-dynamic';

interface Tile {
  label: string;
  desc: string;
  href: string;
  icon: string;
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
      { icon: '💳', label: 'Contas a pagar', desc: 'Títulos em aberto, vencidos, pagos no mês', href: '/financeiro' },
      { icon: '💰', label: 'Contas a receber', desc: 'Saldo de conta corrente por cliente', href: '/financeiro/receber' },
      { icon: '📦', label: 'Pedidos / Vendas', desc: 'Histórico do PDV, ticket médio, top produtos', href: '/movimento/pedidos' },
      { icon: '📥', label: 'Entrada de notas', desc: 'Upload de XMLs de fornecedores (SEFAZ A1 em breve)', href: '/movimento/entrada-notas' },
    ],
  },
  {
    titulo: 'Conciliação',
    cor: 'emerald',
    tiles: [
      { icon: '🟰', label: 'PDV × Cielo', desc: 'Operadora — cada venda no arquivo Cielo', href: '/conciliacao/operadora' },
      { icon: '📅', label: 'Cielo × Agenda', desc: 'Recebíveis — agenda da Cielo', href: '/conciliacao/recebiveis' },
      { icon: '🏦', label: 'Agenda × Banco', desc: 'Extrato bancário × previsto Cielo', href: '/conciliacao/banco' },
      { icon: '📤', label: 'Upload de arquivos', desc: 'Cielo Vendas, Recebíveis, CNAB', href: '/upload' },
      { icon: '⚠', label: 'Exceções', desc: 'Todos os pendentes, filtráveis', href: '/excecoes' },
      { icon: '🔒', label: 'Fechamento', desc: 'Trava dias revisados', href: '/fechamento' },
    ],
  },
  {
    titulo: 'Relatórios e análise',
    cor: 'violet',
    tiles: [
      { icon: '📊', label: 'Dashboard analítico', desc: 'KPIs de vendas, taxas, % rastreado', href: '/dashboard' },
      { icon: '📋', label: 'Relatório consolidado', desc: 'PDV → Cielo → banco', href: '/relatorio' },
      { icon: '📈', label: 'DRE', desc: 'Demonstrativo de resultado', href: '/relatorios/dre' },
      { icon: '🌊', label: 'Fluxo de caixa', desc: 'Entradas/saídas previstos vs realizados', href: '/relatorios/fluxo-caixa', soon: true },
    ],
  },
  {
    titulo: 'Cadastros',
    cor: 'amber',
    tiles: [
      { icon: '🏢', label: 'Filiais', desc: 'Dados, tokens do agente, status', href: '/sync' },
      { icon: '🏭', label: 'Fornecedores', desc: 'Empresas que emitem NF pra você', href: '/cadastros/fornecedores' },
      { icon: '👥', label: 'Clientes', desc: 'Quem compra de você', href: '/cadastros/clientes', soon: true },
      { icon: '📂', label: 'Plano de contas', desc: 'Categorias para DRE', href: '/cadastros/plano-contas' },
      { icon: '🛒', label: 'Produtos', desc: 'Cadastro, preço, margem, estoque', href: '/cadastros/produtos' },
    ],
  },
  {
    titulo: 'Configurações',
    cor: 'slate',
    tiles: [
      { icon: '⚙', label: 'Taxas / Prazos', desc: 'Por EC (TEF/Online), contrato Cielo', href: '/configuracoes' },
      { icon: '🔄', label: 'Sincronização', desc: 'Status dos agentes de cada filial', href: '/sync' },
      { icon: '🔐', label: 'Usuários', desc: 'Acesso por filial', href: '/configuracoes/usuarios', soon: true },
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

export default async function InicioPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-lg font-semibold text-slate-900">
              concilia
            </Link>
            <AppNav />
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500">{user.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Bem-vindo de volta</h1>
            <p className="mt-1 text-sm text-slate-600">
              Acesso rápido aos módulos. {filiais.length} filial{filiais.length !== 1 ? 'is' : ''} ativa{filiais.length !== 1 ? 's' : ''}.
            </p>
          </div>
        </div>

        <div className="mt-8 space-y-10">
          {BLOCOS.map((b) => {
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
      </section>
    </main>
  );
}
