// Detalhe e edição de uma folha semanal.
// Iteração 1: mostra 10% por dia + pessoas vinculadas (sem espelho/cálculo ainda).

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { diasDaSemana, labelSemana, nomeDia } from '@/lib/folha/semana';
import { UploadEspelho } from './upload-espelho';
import { CalculoFechar } from './calculo-fechar';

export const dynamic = 'force-dynamic';

export default async function FolhaDetalhePage(props: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { id } = await props.params;

  const [folha] = await db
    .select()
    .from(schema.folhaSemana)
    .where(eq(schema.folhaSemana.id, id))
    .limit(1);
  if (!folha) notFound();

  // RBAC
  const acesso = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, folha.filialId),
      ),
    )
    .limit(1);
  if (acesso.length === 0) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-3xl px-6 py-10 text-sm text-slate-500">
          Sem acesso a essa folha.
        </p>
      </main>
    );
  }

  const [filial] = await db
    .select({ id: schema.filial.id, nome: schema.filial.nome })
    .from(schema.filial)
    .where(eq(schema.filial.id, folha.filialId));

  const dezPct = (folha.dezPctPorDia as Record<string, number>) ?? {};
  const dias = diasDaSemana(folha.dataInicio);
  const totalDezPct = Object.values(dezPct).reduce((a, b) => a + (b ?? 0), 0);

  // Pessoas vinculadas à folha (fornecedor_folha + fornecedor + cliente)
  const pessoas = await db
    .select({
      fornecedorId: schema.fornecedorFolha.fornecedorId,
      papel: schema.fornecedorFolha.papel,
      ativo: schema.fornecedorFolha.ativo,
      clienteId: schema.fornecedorFolha.clienteId,
      nome: schema.fornecedor.nome,
      cpf: schema.fornecedor.cnpjOuCpf,
      saldoFiado: schema.cliente.saldoAtualContaCorrente,
    })
    .from(schema.fornecedorFolha)
    .innerJoin(
      schema.fornecedor,
      eq(schema.fornecedor.id, schema.fornecedorFolha.fornecedorId),
    )
    .leftJoin(schema.cliente, eq(schema.cliente.id, schema.fornecedorFolha.clienteId))
    .where(
      and(
        eq(schema.fornecedor.filialId, folha.filialId),
        eq(schema.fornecedorFolha.ativo, true),
      ),
    );

  // Horas trabalhadas por pessoa por dia (salvas pelo upload do espelho)
  const horasRows = await db
    .select()
    .from(schema.folhaHoras)
    .where(eq(schema.folhaHoras.folhaSemanaId, folha.id));
  // Map: fornecedorId -> { 'YYYY-MM-DD': totalMin }
  const horasPorPessoa = new Map<string, Record<string, number>>();
  for (const h of horasRows) {
    const cur = horasPorPessoa.get(h.fornecedorId) ?? {};
    cur[h.dia] = h.totalMin;
    horasPorPessoa.set(h.fornecedorId, cur);
  }

  // Ajustes (descontos/acréscimos) já lançados nessa folha
  const ajustes = await db
    .select()
    .from(schema.folhaAjuste)
    .where(eq(schema.folhaAjuste.folhaSemanaId, folha.id));

  const config = folha.configSnapshot as {
    ppEmpresa?: string | number;
    ppGerente?: string | number;
    ppFuncionarios?: string | number;
    taxaDiaristaHora?: string | number;
  } | null;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-6xl px-6 py-10">
        <Link
          href={`/folha-equipe/folhas?filialId=${folha.filialId}`}
          className="mb-4 inline-block text-sm text-blue-600 hover:underline"
        >
          ← Voltar
        </Link>

        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Folha — {labelSemana(folha.dataInicio, folha.dataFim)}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {filial?.nome} ·{' '}
              {folha.status === 'aberta' && (
                <span className="text-amber-700 font-medium">aberta</span>
              )}
              {folha.status === 'fechada' && (
                <span className="text-emerald-700 font-medium">fechada</span>
              )}
              {folha.status === 'cancelada' && (
                <span className="text-rose-700 font-medium">cancelada</span>
              )}
            </p>
          </div>
        </div>

        {/* Resumo do 10% */}
        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-slate-900">
            10% arrecadado por dia (lido do PDV)
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-500">Dia</th>
                  <th className="px-3 py-2 text-right font-medium text-slate-500">10% total</th>
                  {config && (
                    <>
                      <th className="px-3 py-2 text-right font-medium text-slate-500">
                        Empresa ({Number(config.ppEmpresa)}pp)
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-slate-500">
                        Gerente ({Number(config.ppGerente)}pp)
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-slate-500">
                        Funcionários ({Number(config.ppFuncionarios)}pp)
                      </th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {dias.map((dia) => {
                  const valor = dezPct[dia] ?? 0;
                  const ppE = Number(config?.ppEmpresa ?? 1);
                  const ppG = Number(config?.ppGerente ?? 1);
                  const ppF = Number(config?.ppFuncionarios ?? 8);
                  return (
                    <tr key={dia} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <span className="text-xs uppercase text-slate-500 mr-2">{nomeDia(dia)}</span>
                        {formatBr(dia)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {brl(valor)}
                      </td>
                      {config && (
                        <>
                          <td className="px-3 py-2 text-right font-mono text-xs text-slate-500">
                            {brl(valor * (ppE / 10))}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs text-slate-500">
                            {brl(valor * (ppG / 10))}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs text-emerald-700 font-medium">
                            {brl(valor * (ppF / 10))}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                  <td className="px-3 py-2">TOTAL</td>
                  <td className="px-3 py-2 text-right font-mono">{brl(totalDezPct)}</td>
                  {config && (
                    <>
                      <td className="px-3 py-2 text-right font-mono">
                        {brl(totalDezPct * (Number(config.ppEmpresa) / 10))}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {brl(totalDezPct * (Number(config.ppGerente) / 10))}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-emerald-700">
                        {brl(totalDezPct * (Number(config.ppFuncionarios) / 10))}
                      </td>
                    </>
                  )}
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Upload do espelho de ponto */}
        {folha.status === 'aberta' && (
          <div className="mb-6">
            <UploadEspelho folhaId={folha.id} />
          </div>
        )}

        {/* Pessoas vinculadas + horas */}
        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">
              Pessoas e horas ({pessoas.length})
            </h2>
            <Link
              href={`/folha-equipe/pessoas?filialId=${folha.filialId}`}
              className="text-xs text-blue-600 hover:underline"
            >
              Gerenciar pessoas →
            </Link>
          </div>
          {pessoas.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              Nenhuma pessoa vinculada à folha.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium text-slate-500">Pessoa</th>
                    <th className="px-2 py-2 text-left font-medium text-slate-500">Papel</th>
                    {dias.map((d) => (
                      <th key={d} className="px-2 py-2 text-center font-medium text-slate-500">
                        <div className="text-[10px] uppercase">{nomeDia(d)}</div>
                        <div className="text-[10px] text-slate-400">{d.slice(8)}/{d.slice(5, 7)}</div>
                      </th>
                    ))}
                    <th className="px-2 py-2 text-right font-medium text-slate-500">Total</th>
                    <th className="px-2 py-2 text-right font-medium text-slate-500">Fiado</th>
                  </tr>
                </thead>
                <tbody>
                  {pessoas.map((p) => {
                    const horas = horasPorPessoa.get(p.fornecedorId) ?? {};
                    const totalMin = Object.values(horas).reduce((a, b) => a + b, 0);
                    return (
                      <tr key={p.fornecedorId} className="border-t border-slate-100">
                        <td className="px-2 py-2">
                          <div className="font-medium text-slate-900">{p.nome}</div>
                          {p.clienteId ? (
                            <div className="text-[10px] text-emerald-700">✓ cliente</div>
                          ) : (
                            <div className="text-[10px] text-amber-700">⚠ sem cliente</div>
                          )}
                        </td>
                        <td className="px-2 py-2 text-xs">
                          {p.papel === 'funcionario' && '👤'}
                          {p.papel === 'diarista' && '⏰'}
                          {p.papel === 'gerente' && '⭐'}
                        </td>
                        {dias.map((d) => {
                          const min = horas[d] ?? 0;
                          return (
                            <td
                              key={d}
                              className={`px-2 py-2 text-center font-mono text-xs ${
                                min > 0 ? 'text-slate-700' : 'text-slate-300'
                              }`}
                            >
                              {min > 0 ? fmtHM(min) : '—'}
                            </td>
                          );
                        })}
                        <td className="px-2 py-2 text-right font-mono font-semibold">
                          {totalMin > 0 ? fmtHM(totalMin) : '—'}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-xs text-amber-700">
                          {p.saldoFiado && Number(p.saldoFiado) > 0
                            ? brl(Number(p.saldoFiado))
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Cálculo + ajustes + fechar */}
        <CalculoFechar
          folhaId={folha.id}
          status={folha.status}
          pessoas={pessoas.map((p) => ({
            fornecedorId: p.fornecedorId,
            nome: p.nome ?? '(sem nome)',
            papel: p.papel,
            saldoFiado: p.saldoFiado ? Number(p.saldoFiado) : null,
            clienteId: p.clienteId,
          }))}
          ajustesIniciais={ajustes.map((a) => ({
            id: a.id,
            fornecedorId: a.fornecedorId,
            tipo: a.tipo as 'desconto' | 'acrescimo',
            valor: a.valor,
            descricao: a.descricao,
            origem: a.origem,
          }))}
        />
      </section>
    </main>
  );
}

function brl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatBr(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function fmtHM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}
