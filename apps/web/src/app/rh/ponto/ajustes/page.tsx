// Histórico de ajustes do ponto (03/11/2026): quem incluiu, alterou ou excluiu
// cada batida, quando, o antes/depois e a justificativa. Lê a trilha
// `ponto_batida_ajuste`, que a rota /api/rh/ponto/corrigir grava desde sempre.
// Pessoas = cadastro da casa (mesma regra da coluna ✏️ Ajustes do relatório).

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { hojeBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  mes?: string;
  pessoa?: string;
  por?: string;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const ACAO: Record<string, { txt: string; cls: string }> = {
  inclusao: { txt: 'incluiu', cls: 'bg-emerald-50 text-emerald-700' },
  alteracao: { txt: 'alterou', cls: 'bg-blue-50 text-blue-700' },
  exclusao: { txt: 'excluiu', cls: 'bg-red-50 text-red-700' },
};
const AUTO = 'Sequência reajustada';

function mesValido(m: string | undefined, hoje: string): string {
  return m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : hoje.slice(0, 7);
}
function mesSomar(mes: string, n: number): string {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function ultimoDia(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
}
/** Instante em BRT, "dd/mm hh:mm". */
function quandoBr(d: Date | string | null | undefined): string {
  if (!d) return '';
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return '';
  const s = new Date(t.getTime() - 3 * 3600 * 1000).toISOString();
  return `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}`;
}
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

interface Valor {
  tipo?: string;
  quando?: string;
}
function descreve(v: unknown): string {
  if (!v || typeof v !== 'object') return '—';
  const x = v as Valor;
  const tipo = x.tipo === 'entrada' ? 'entrada' : x.tipo === 'saida' ? 'saída' : (x.tipo ?? '');
  return `${tipo} ${quandoBr(x.quando)}`.trim() || '—';
}
function nomeUsuario(u: { nome: string | null; email: string } | undefined): string {
  if (!u) return 'usuário apagado';
  return u.nome?.trim() || u.email;
}

export default async function AjustesPontoPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'ponto.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialSelecionada = await escolherFilial(filiais, sp.filialId);
  if (!filialSelecionada) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-3xl px-6 py-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
      </main>
    );
  }
  const filial = filialSelecionada;

  const hoje = hojeBr();
  const mes = mesValido(sp.mes, hoje);
  const ini = `${mes}-01`;
  const fim = ultimoDia(mes);
  const [ano, mm] = mes.split('-').map(Number);
  const nomeMes = `${MESES[mm - 1]} de ${ano}`;

  const funcionarios = await db
    .select({ id: schema.funcionario.id, nome: schema.funcionario.nome })
    .from(schema.funcionario)
    .where(eq(schema.funcionario.filialId, filial.id))
    .orderBy(asc(schema.funcionario.nome));
  const nomePessoa = new Map(funcionarios.map((f) => [f.id, f.nome]));
  const pessoaSel = sp.pessoa && nomePessoa.has(sp.pessoa) ? sp.pessoa : null;
  const ids = pessoaSel ? [pessoaSel] : funcionarios.map((f) => f.id);

  const todos = ids.length
    ? await db
        .select({
          id: schema.pontoBatidaAjuste.id,
          filialId: schema.pontoBatidaAjuste.filialId,
          funcionarioId: schema.pontoBatidaAjuste.funcionarioId,
          dia: schema.pontoBatidaAjuste.dia,
          acao: schema.pontoBatidaAjuste.acao,
          valorAntes: schema.pontoBatidaAjuste.valorAntes,
          valorDepois: schema.pontoBatidaAjuste.valorDepois,
          justificativa: schema.pontoBatidaAjuste.justificativa,
          usuarioId: schema.pontoBatidaAjuste.usuarioId,
          criadoEm: schema.pontoBatidaAjuste.criadoEm,
        })
        .from(schema.pontoBatidaAjuste)
        .where(
          and(
            inArray(schema.pontoBatidaAjuste.funcionarioId, ids),
            gte(schema.pontoBatidaAjuste.dia, ini),
            lte(schema.pontoBatidaAjuste.dia, fim),
          ),
        )
        .orderBy(desc(schema.pontoBatidaAjuste.criadoEm))
    : [];

  const usuarioIds = [...new Set(todos.map((a) => a.usuarioId))];
  const usuarios = usuarioIds.length
    ? await db
        .select({ id: schema.usuario.id, nome: schema.usuario.nome, email: schema.usuario.email })
        .from(schema.usuario)
        .where(inArray(schema.usuario.id, usuarioIds))
    : [];
  const usuarioPorId = new Map(usuarios.map((u) => [u.id, u]));
  const nomeCasa = new Map(filiais.map((f) => [f.id, f.nome]));

  // Resumo por quem fez (feitos à mão × reordenação automática).
  const porUsuario = new Map<string, { mao: number; auto: number }>();
  for (const a of todos) {
    const r = porUsuario.get(a.usuarioId) ?? { mao: 0, auto: 0 };
    if (a.justificativa.startsWith(AUTO)) r.auto++;
    else r.mao++;
    porUsuario.set(a.usuarioId, r);
  }
  const resumoUsuarios = [...porUsuario.entries()].sort((a, b) => b[1].mao + b[1].auto - (a[1].mao + a[1].auto));

  const porSel = sp.por && porUsuario.has(sp.por) ? sp.por : null;
  const lista = porSel ? todos.filter((a) => a.usuarioId === porSel) : todos;
  const totalMao = todos.filter((a) => !a.justificativa.startsWith(AUTO)).length;

  const url = (p: Partial<SP>) => {
    const q = new URLSearchParams({
      filialId: filial.id,
      mes,
      ...(pessoaSel ? { pessoa: pessoaSel } : {}),
      ...(porSel ? { por: porSel } : {}),
    });
    for (const [k, v] of Object.entries(p)) {
      if (v === undefined || v === '') q.delete(k);
      else q.set(k, v);
    }
    return `?${q.toString()}`;
  };
  const btn = 'rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50';
  const chip = (ativo: boolean) =>
    `rounded-md border px-3 py-1.5 text-sm ${ativo ? 'border-blue-500 bg-blue-50 font-medium text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Histórico de ajustes do ponto — {nomeMes}</h1>
            <p className="mt-1 text-sm text-slate-600">
              {filial.nome}
              {pessoaSel ? ` · ${nomePessoa.get(pessoaSel)}` : ' · todas as pessoas'} · quem incluiu, alterou ou excluiu cada batida
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={`/rh/ponto/relatorio?filialId=${filial.id}&mes=${mes}`} className={btn}>Relatório do ponto</a>
            <a href={`/rh/ponto?filialId=${filial.id}`} className={btn}>Ponto da semana</a>
          </div>
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-3">
          {filiais.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {filiais.map((f) => (
                <a key={f.id} href={`?filialId=${f.id}&mes=${mes}`} className={chip(f.id === filial.id)}>
                  {f.nome}
                </a>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1">
            <a href={url({ mes: mesSomar(mes, -1) })} className={btn}>←</a>
            <span className="px-2 text-sm font-medium text-slate-700">{nomeMes}</span>
            <a href={url({ mes: mesSomar(mes, 1) })} className={btn}>→</a>
          </div>
          <form method="get" className="flex items-center gap-2">
            <input type="hidden" name="filialId" value={filial.id} />
            <input type="hidden" name="mes" value={mes} />
            <select name="pessoa" defaultValue={pessoaSel ?? ''} className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm">
              <option value="">Todas as pessoas</option>
              {funcionarios.map((f) => (
                <option key={f.id} value={f.id}>{f.nome}</option>
              ))}
            </select>
            <button className={btn}>Filtrar</button>
          </form>
        </div>

        <div className="mb-5 rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-2 text-sm text-slate-600">
            <b className="text-slate-900">{todos.length}</b> ajustes no mês: <b className="text-slate-900">{totalMao}</b> feitos à mão e{' '}
            <b className="text-slate-900">{todos.length - totalMao}</b> automáticos. Automático = o sistema trocou entrada/saída das batidas
            seguintes depois de uma inclusão ou exclusão no meio do dia (fica no nome de quem fez a mudança).
          </div>
          {resumoUsuarios.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <a href={url({ por: '' })} className={chip(!porSel)}>Todos</a>
              {resumoUsuarios.map(([uid, r]) => (
                <a key={uid} href={url({ por: uid })} className={chip(porSel === uid)}>
                  {nomeUsuario(usuarioPorId.get(uid))} · {r.mao} à mão{r.auto ? ` + ${r.auto} auto` : ''}
                </a>
              ))}
            </div>
          )}
        </div>

        {lista.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">Nenhum ajuste neste mês.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2">Feito em</th>
                  <th className="px-3 py-2">Feito por</th>
                  {!pessoaSel && <th className="px-3 py-2">Pessoa</th>}
                  <th className="px-3 py-2">Dia do ponto</th>
                  <th className="px-3 py-2">O que fez</th>
                  <th className="px-3 py-2">Antes</th>
                  <th className="px-3 py-2">Depois</th>
                  <th className="px-3 py-2">Justificativa</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((a) => {
                  const auto = a.justificativa.startsWith(AUTO);
                  const ac = ACAO[a.acao] ?? { txt: a.acao, cls: 'bg-slate-100 text-slate-600' };
                  const u = usuarioPorId.get(a.usuarioId);
                  return (
                    <tr key={a.id} className={`border-t border-slate-100 ${auto ? 'text-slate-400' : ''}`}>
                      <td className="whitespace-nowrap px-3 py-2">{quandoBr(a.criadoEm)}</td>
                      <td className="px-3 py-2">
                        <div className={auto ? '' : 'font-medium text-slate-900'}>{nomeUsuario(u)}</div>
                        {u?.nome && <div className="text-xs text-slate-400">{u.email}</div>}
                      </td>
                      {!pessoaSel && (
                        <td className="px-3 py-2">
                          <a href={url({ pessoa: a.funcionarioId })} className="text-blue-700 hover:underline">
                            {nomePessoa.get(a.funcionarioId) ?? '—'}
                          </a>
                        </td>
                      )}
                      <td className="whitespace-nowrap px-3 py-2">
                        {ddmm(a.dia)}
                        {a.filialId !== filial.id && (
                          <div className="text-xs text-slate-400">em {nomeCasa.get(a.filialId) ?? 'outra casa'}</div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${auto ? 'bg-slate-100 text-slate-500' : ac.cls}`}>
                          {auto ? 'automático' : ac.txt}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">{descreve(a.valorAntes)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{descreve(a.valorDepois)}</td>
                      <td className="px-3 py-2">{a.justificativa}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
