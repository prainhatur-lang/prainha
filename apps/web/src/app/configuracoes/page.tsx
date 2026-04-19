import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import type { TaxasFilial } from '@concilia/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { LogoutButton } from '../dashboard/logout-button';
import { ConfiguracoesForm } from './form';
import { TAXAS_DEFAULT } from '@/lib/conciliacao-banco';
import { brl, int } from '@/lib/format';

interface AuditoriaRow {
  ec: string;
  forma: string;
  bandeira: string;
  qtd: number;
  volume: number;
  taxaReal: number;
  taxaConfig: number;
  diff: number;
  /** Impacto em R$: (taxa_real − taxa_config) × volume / 100. Positivo = cobrou a mais. */
  diffValor: number;
}

function normalizarTexto(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
}

function resolverTaxaConfig(
  taxas: TaxasFilial,
  ec: string,
  forma: string,
  bandeira: string,
): number {
  const ecConf = taxas.ecs.find((e) => e.codigo === ec);
  const base = ecConf ?? taxas.default;
  const f = normalizarTexto(forma);
  const b = normalizarTexto(bandeira);
  if (f.includes('pix')) return Number(base.pix ?? TAXAS_DEFAULT.pix);
  if (f.includes('debito')) {
    const map = base.debito ?? TAXAS_DEFAULT.debito;
    return Number(map[b] ?? map['visa'] ?? TAXAS_DEFAULT.debito.visa);
  }
  if (f.includes('credito')) {
    const map = base.credito_a_vista ?? TAXAS_DEFAULT.credito_a_vista;
    return Number(map[b] ?? map['visa'] ?? TAXAS_DEFAULT.credito_a_vista.visa);
  }
  return 0;
}

async function auditoriaFilial(filialId: string, taxas: TaxasFilial): Promise<AuditoriaRow[]> {
  const rows = await db
    .select({
      ec: schema.vendaAdquirente.codigoEstabelecimento,
      forma: schema.vendaAdquirente.formaPagamento,
      bandeira: schema.vendaAdquirente.bandeira,
      qtd: sql<number>`COUNT(*)::int`,
      bruto: sql<string>`COALESCE(SUM(${schema.vendaAdquirente.valorBruto}), 0)::text`,
      taxaTotal: sql<string>`COALESCE(SUM(${schema.vendaAdquirente.valorTaxa}), 0)::text`,
    })
    .from(schema.vendaAdquirente)
    .where(
      and(
        eq(schema.vendaAdquirente.filialId, filialId),
        eq(schema.vendaAdquirente.adquirente, 'CIELO'),
      ),
    )
    .groupBy(
      schema.vendaAdquirente.codigoEstabelecimento,
      schema.vendaAdquirente.formaPagamento,
      schema.vendaAdquirente.bandeira,
    );

  return rows
    .map((r) => {
      const bruto = Number(r.bruto);
      const taxaTotal = Math.abs(Number(r.taxaTotal));
      const taxaReal = bruto > 0 ? +(taxaTotal / bruto * 100).toFixed(3) : 0;
      const taxaConfig = resolverTaxaConfig(
        taxas,
        r.ec ?? '',
        r.forma ?? '',
        r.bandeira ?? '',
      );
      const diff = +(taxaReal - taxaConfig).toFixed(3);
      // Impacto financeiro: (taxa real - contratada) × volume / 100
      const diffValor = +((diff * bruto) / 100).toFixed(2);
      return {
        ec: r.ec ?? '(sem EC)',
        forma: r.forma ?? '—',
        bandeira: r.bandeira ?? '—',
        qtd: Number(r.qtd),
        volume: bruto,
        taxaReal,
        taxaConfig,
        diff,
        diffValor,
      };
    })
    .sort((a, b) => Math.abs(b.diffValor) - Math.abs(a.diffValor));
}

export const dynamic = 'force-dynamic';

export default async function ConfiguracoesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const filialIds = filiais.map((f) => f.id);
  const filialRows = filialIds.length
    ? await db
        .select({
          id: schema.filial.id,
          nome: schema.filial.nome,
          taxas: schema.filial.taxas,
        })
        .from(schema.filial)
        .where(inArray(schema.filial.id, filialIds))
    : [];

  const taxasDefault: TaxasFilial = {
    ecs: [],
    default: TAXAS_DEFAULT,
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-lg font-semibold text-slate-900">
              concilia
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/dashboard" className="text-slate-600 hover:text-slate-900">
                Dashboard
              </Link>
              <Link href="/sync" className="text-slate-600 hover:text-slate-900">
                Sincronização
              </Link>
              <Link href="/upload" className="text-slate-600 hover:text-slate-900">
                Upload
              </Link>
              <Link href="/conciliacao" className="text-slate-600 hover:text-slate-900">
                Conciliação
              </Link>
              <Link href="/relatorio" className="text-slate-600 hover:text-slate-900">
                Relatório
              </Link>
              <Link href="/excecoes" className="text-slate-600 hover:text-slate-900">
                Exceções
              </Link>
              <Link href="/fechamento" className="text-slate-600 hover:text-slate-900">
                Fechamento
              </Link>
              <Link href="/configuracoes" className="font-medium text-slate-900">
                Configurações
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500">{user.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Configurações</h1>
        <p className="mt-1 text-sm text-slate-600">
          Taxas Cielo por estabelecimento. Aplicadas na conciliação Banco pra calcular o valor líquido esperado.
        </p>

        <div className="mt-8 space-y-8">
          {await Promise.all(
            filialRows.map(async (f) => {
              const taxas = (f.taxas as TaxasFilial | null) ?? taxasDefault;
              const auditoria = await auditoriaFilial(f.id, taxas);
              return (
                <div
                  key={f.id}
                  className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
                >
                  <h2 className="text-base font-semibold text-slate-900">{f.nome}</h2>
                  <p className="mt-0.5 text-xs text-slate-500">ID: {f.id}</p>
                  <div className="mt-5">
                    <ConfiguracoesForm filialId={f.id} taxas={taxas} />
                  </div>

                  <div className="mt-8 border-t border-slate-200 pt-5">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Auditoria de taxas (dados reais do arquivo Cielo)
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Taxa real = soma(valor_taxa) / soma(valor_bruto). Compara com o % configurado acima. Diff &gt; ±0,10% destacado.
                    </p>
                    <AuditoriaTabela rows={auditoria} />
                  </div>
                </div>
              );
            }),
          )}
          {filialRows.length === 0 && (
            <p className="text-sm text-slate-500">Nenhuma filial acessível.</p>
          )}
        </div>
      </section>
    </main>
  );
}

function AuditoriaTabela({ rows }: { rows: AuditoriaRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="mt-3 rounded-md border border-dashed border-slate-300 px-4 py-4 text-center text-xs text-slate-500">
        Sem vendas Cielo importadas pra essa filial.
      </p>
    );
  }
  const totalDiff = rows.reduce((s, r) => s + r.diffValor, 0);
  const totalVolume = rows.reduce((s, r) => s + r.volume, 0);
  return (
    <div className="mt-3 space-y-3">
      {/* Resumo financeiro */}
      <div
        className={`rounded-md border px-4 py-3 text-xs ${
          Math.abs(totalDiff) < 1
            ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
            : totalDiff > 0
              ? 'border-rose-200 bg-rose-50 text-rose-900'
              : 'border-sky-200 bg-sky-50 text-sky-900'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">
            {Math.abs(totalDiff) < 1
              ? '✓ Taxas cobradas conforme contratado'
              : totalDiff > 0
                ? '⚠ Cielo cobrou a MAIS que o contratado'
                : '↓ Cielo cobrou a MENOS que o contratado'}
          </span>
          <span className="font-mono text-base font-bold">
            {totalDiff > 0 ? '+' : ''}
            {brl(totalDiff)}
          </span>
        </div>
        <p className="mt-1 text-[11px] opacity-80">
          Sobre volume de {brl(totalVolume)} · diferença efetiva{' '}
          {totalVolume > 0 ? ((totalDiff / totalVolume) * 100).toFixed(3) : '0.000'}%
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border border-slate-200 text-xs">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="px-3 py-2 font-medium text-slate-700">EC</th>
              <th className="px-3 py-2 font-medium text-slate-700">Forma</th>
              <th className="px-3 py-2 font-medium text-slate-700">Bandeira</th>
              <th className="px-3 py-2 text-right font-medium text-slate-700">Qtd</th>
              <th className="px-3 py-2 text-right font-medium text-slate-700">Volume</th>
              <th className="px-3 py-2 text-right font-medium text-slate-700">Real</th>
              <th className="px-3 py-2 text-right font-medium text-slate-700">Config</th>
              <th className="px-3 py-2 text-right font-medium text-slate-700">Diff %</th>
              <th className="px-3 py-2 text-right font-medium text-slate-700">Diff R$</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const alerta = Math.abs(r.diff) > 0.1;
              const sinalValor = r.diffValor > 0 ? 'text-rose-700' : r.diffValor < 0 ? 'text-emerald-700' : 'text-slate-400';
              return (
                <tr key={i} className="border-t border-slate-200">
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-700">{r.ec}</td>
                  <td className="px-3 py-2 text-slate-700">{r.forma}</td>
                  <td className="px-3 py-2 text-slate-700">{r.bandeira}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-700">{int(r.qtd)}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-700">{brl(r.volume)}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-900">
                    {r.taxaReal.toFixed(2)}%
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-600">
                    {r.taxaConfig.toFixed(2)}%
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono font-medium ${
                      alerta ? (r.diff > 0 ? 'text-rose-700' : 'text-emerald-700') : 'text-slate-400'
                    }`}
                  >
                    {r.diff > 0 ? '+' : ''}
                    {r.diff.toFixed(2)}%
                  </td>
                  <td className={`px-3 py-2 text-right font-mono font-semibold ${sinalValor}`}>
                    {r.diffValor > 0 ? '+' : ''}
                    {brl(r.diffValor)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
