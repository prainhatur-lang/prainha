// Pagamento da folha do contador, pessoa por pessoa — confere o líquido de
// cada um na folha da E.B. Serviços (terceirizada que registra a maior parte
// da equipe) contra os débitos do extrato da própria E.B. no Inter.
//
// Só leitura: não dá baixa, não gera conta. O extrato entra pela API do Inter
// (credencial INTER_EB_*, que quem salva na Vercel é o dono) e fica em
// `extrato_empresa`, separado do extrato das casas.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { AppHeader } from '@/components/app-header';
import { brl } from '@/lib/format';
import { db, schema } from '@concilia/db';
import { desc, eq, inArray } from 'drizzle-orm';
import {
  EMPRESAS_EXTRATO,
  conferirFolhaComExtrato,
  extratoEmpresaConfigurado,
  resumoExtratoEmpresa,
  type SituacaoPagamento,
} from '@/lib/extrato-empresa';
import { BuscarExtrato } from './buscar-extrato';
import { linhasArquivoInter } from '@/lib/rh/arquivo-pagamento-folha';
import { hojeBr } from '@/lib/datas';
import { rateioFolhaPelasHoras } from '@/lib/eb/rateio-horas';

export const dynamic = 'force-dynamic';

const MESES = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const nomeComp = (comp: string) => {
  const [a, m] = comp.split('-');
  return `${MESES[Number(m)] ?? m}/${a}`;
};
const fmtDia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

const SITUACAO: Record<SituacaoPagamento, { rotulo: string; classe: string }> = {
  bate: { rotulo: 'pago, valor confere', classe: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  difere: { rotulo: 'pago, valor diferente', classe: 'border-amber-200 bg-amber-50 text-amber-800' },
  so_valor: { rotulo: 'valor igual, sem o nome', classe: 'border-amber-200 bg-amber-50 text-amber-800' },
  nao_achou: { rotulo: 'não achei no extrato', classe: 'border-red-200 bg-red-50 text-red-700' },
  sem_liquido: { rotulo: 'sem líquido a receber', classe: 'border-slate-200 bg-slate-50 text-slate-600' },
};

const NO_LOTE = {
  dentro: { rotulo: 'pago no lote (repasse da casa confere)', classe: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  fora: { rotulo: 'ficou fora do lote', classe: 'border-red-200 bg-red-50 text-red-700' },
  talvez_fora: { rotulo: 'um destes ficou fora do lote', classe: 'border-amber-200 bg-amber-50 text-amber-800' },
  casa_difere: { rotulo: 'repasse da casa não fecha', classe: 'border-amber-200 bg-amber-50 text-amber-800' },
} as const;

export default async function PagamentosFolhaContadorPage(props: { searchParams: Promise<{ comp?: string; fonte?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'folha_equipe.read');

  const sigla = 'EB' as const;
  const empresa = EMPRESAS_EXTRATO[sigla];
  const filiais = await filiaisDoUsuario(user.id);
  const filialIds = filiais.map((f) => f.id);
  const nomeFilial = new Map(filiais.map((f) => [f.id, f.nome]));
  const sp = await props.searchParams;

  const compsContador = (
    await db
      .selectDistinct({ competencia: schema.folhaContador.competencia })
      .from(schema.folhaContador)
      .where(eq(schema.folhaContador.cnpj, empresa.cnpj))
      .orderBy(desc(schema.folhaContador.competencia))
  ).map((c) => c.competencia);
  // Nossa folha não depende do contador: o mês atual e o anterior sempre aparecem.
  const mesAtual = hojeBr().slice(0, 7);
  const [ma, mm] = mesAtual.split('-').map(Number);
  const mesPassado = `${mm === 1 ? ma! - 1 : ma}-${String(mm === 1 ? 12 : mm! - 1).padStart(2, '0')}`;
  const competencias = [...new Set([mesAtual, mesPassado, ...compsContador])].sort().reverse();
  // Desde 05/11/2026 confere a NOSSA folha ("vou pagar pela nossa folha"). Dono
  // 06/11/2026: "retira tudo que for de contador" — a vista do contador saiu da tela.
  const fonte = 'nossa' as 'nossa' | 'contador';
  const comp = sp.comp && competencias.includes(sp.comp) ? sp.comp : compsContador[0] ?? mesPassado;

  const configurado = extratoEmpresaConfigurado(sigla);
  const resumo = await resumoExtratoEmpresa(sigla);
  const conf = comp ? await conferirFolhaComExtrato(sigla, comp, filialIds, fonte) : null;
  const rateioHoras = comp ? await rateioFolhaPelasHoras(empresa.cnpj, comp, filialIds) : null;
  // Hora batida em casa fora da lista do usuário ainda precisa de nome.
  const idsHoras = [...new Set((rateioHoras?.casas ?? []).map((c) => c.filialId))].filter((id) => !nomeFilial.has(id));
  if (idsHoras.length) {
    const extras = await db.select({ id: schema.filial.id, nome: schema.filial.nome }).from(schema.filial).where(inArray(schema.filial.id, idsHoras));
    for (const f of extras) nomeFilial.set(f.id, f.nome);
  }
  const divididos = (rateioHoras?.pessoas ?? []).filter(
    (p) => p.casas.length > 1 || (p.casas.length === 1 && p.casas[0]!.filialId !== p.cadastroFilialId),
  );
  const semPonto = (rateioHoras?.pessoas ?? []).filter((p) => p.casas.length === 0);
  const fmtHoras = (min: number) => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}`;

  const linhas = conf?.linhas ?? [];
  const comLiquido = linhas.filter((l) => l.situacao !== 'sem_liquido');
  const totalFolha = comLiquido.reduce((s, l) => s + l.liquido, 0);
  const conta = (s: SituacaoPagamento) => linhas.filter((l) => l.situacao === s);
  const somaLiq = (s: SituacaoPagamento) => conta(s).reduce((t, l) => t + l.liquido, 0);
  const lotes = conf?.lotes ?? [];
  const totalLote = lotes.reduce((s, d) => s + d.valor, 0);
  const semNome = conta('nao_achou');
  const somaSemNome = somaLiq('nao_achou');
  const faltaNoLote = somaSemNome - totalLote;
  const porCasa = conf?.porCasa ?? [];
  const nomeDaLinha = new Map(linhas.map((l) => [l.folhaId, l.nome]));
  const repassado = porCasa.reduce((t, c) => t + (c.repasse?.valor ?? 0), 0);
  // Arquivo da folha no Inter: quem entra e quem fica de fora (sem conta Inter).
  const inter = comp ? await linhasArquivoInter(filialIds, comp) : null;
  const totalInter = inter ? inter.pagar.reduce((t, l) => t + l.valor, 0) : 0;
  // Mesmo arquivo pra quem é registrado na Prainha Turismo (dono 06/11/2026:
  // "como faço pra pagar Prainha e EB do Prainha"): sai pelo Inter da Prainha.
  const interPrainha = comp ? await linhasArquivoInter(filialIds, comp, 'PRAINHA') : null;
  const totalInterPrainha = interPrainha ? interPrainha.pagar.reduce((t, l) => t + l.valor, 0) : 0;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-5xl space-y-5 px-6 py-8">
        <div>
          <a href="/rh/folha-contador" className="text-xs text-slate-500 hover:underline">← Folha mensal</a>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">Pagamentos da {empresa.nome}</h1>
          <p className="mt-1 text-sm text-slate-500">
            O líquido de cada pessoa na nossa folha (calculada pelo ponto), conferido com o que saiu da conta da {empresa.nome} no Inter.
            Só leitura — nada aqui dá baixa nem gera conta.
          </p>
          {comp && (
            <p className="mt-3">
              <a
                href={`/api/rh/folha-pagamento-arquivo?comp=${comp}`}
                className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
              >
                📄 Planilha de pagamento de {nomeComp(comp)} (nossa folha)
              </a>
              <span className="ml-2 text-xs text-slate-500">
                Uma aba por casa com conta e líquido; quem tem conta em nome de outra pessoa vai pra aba “Não pagar”.
              </span>
            </p>
          )}
          {comp && inter && (
            <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm">
              <form action="/api/rh/folha-pagamento-inter" method="get" className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="comp" value={comp} />
                <label className="text-xs text-slate-600">
                  Data do débito
                  <input type="date" name="data" defaultValue={hojeBr()} min={hojeBr()} className="mt-0.5 block rounded border border-slate-300 px-2 py-1 text-sm" />
                </label>
                <label className="text-xs text-slate-600">
                  Casa
                  <select name="casa" defaultValue="" className="mt-0.5 block rounded border border-slate-300 px-2 py-1 text-sm">
                    <option value="">Todas as casas</option>
                    {filiais.map((f) => {
                      const daCasa = inter.pagar.filter((l) => l.casaId === f.id);
                      return (
                        <option key={f.id} value={f.id}>
                          {f.nome} — {daCasa.length} pessoas, {brl(daCasa.reduce((t, l) => t + l.valor, 0))}
                        </option>
                      );
                    })}
                    {filiais.length > 2 &&
                      filiais.map((f) => {
                        const resto = inter.pagar.filter((l) => l.casaId !== f.id);
                        return (
                          <option key={`sem-${f.id}`} value={filiais.filter((x) => x.id !== f.id).map((x) => x.id).join(',')}>
                            Todas menos {f.nome} — {resto.length} pessoas, {brl(resto.reduce((t, l) => t + l.valor, 0))}
                          </option>
                        );
                      })}
                  </select>
                </label>
                <label className="text-xs text-slate-600">
                  Conta corrente do Inter da E.B. (obrigatório)
                  <input name="conta" required placeholder="00000000-0" className="mt-0.5 block w-36 rounded border border-slate-300 px-2 py-1 text-sm" />
                </label>
                <button className="rounded-lg border border-orange-300 bg-white px-3 py-1.5 text-sm font-medium text-orange-800 hover:bg-orange-100">
                  🟠 Arquivo do Inter (folha de pagamento) — todas: {inter.pagar.length} pessoas, {brl(totalInter)}
                </button>
              </form>
              <p className="mt-1 text-xs text-slate-600">
                Modelo “Folha de pagamento” do Inter, todas as casas num lote só, como a E.B. já paga. Só entra quem tem conta Inter no próprio CPF.
              </p>
              {inter.semConta.length > 0 && (
                <div className="mt-2 text-xs text-slate-700">
                  <p className="font-medium text-orange-900">
                    Sem conta Inter — pagar à parte ({inter.semConta.length}, {brl(inter.semConta.reduce((t, l) => t + l.valor, 0))}):
                  </p>
                  <ul className="mt-1 grid gap-x-4 sm:grid-cols-2">
                    {inter.semConta.map((l) => (
                      <li key={`${l.casaId}-${l.cpf}-${l.nome}`}>
                        {l.nome} <span className="text-slate-500">· {nomeFilial.get(l.casaId) ?? ''} · {brl(l.valor)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {comp && interPrainha && interPrainha.pagar.length + interPrainha.semConta.length > 0 && (
            <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm">
              <p className="mb-2 text-xs font-semibold text-sky-900">Registrados na Prainha Turismo (pagar pelo Inter da Prainha)</p>
              <form action="/api/rh/folha-pagamento-inter" method="get" className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="comp" value={comp} />
                <input type="hidden" name="empresa" value="PRAINHA" />
                <label className="text-xs text-slate-600">
                  Data do débito
                  <input type="date" name="data" defaultValue={hojeBr()} min={hojeBr()} className="mt-0.5 block rounded border border-slate-300 px-2 py-1 text-sm" />
                </label>
                <label className="text-xs text-slate-600">
                  Casa
                  <select name="casa" defaultValue="" className="mt-0.5 block rounded border border-slate-300 px-2 py-1 text-sm">
                    <option value="">Todas as casas</option>
                    {filiais.map((f) => {
                      const daCasa = interPrainha.pagar.filter((l) => l.casaId === f.id);
                      return (
                        <option key={f.id} value={f.id}>
                          {f.nome} — {daCasa.length} pessoas, {brl(daCasa.reduce((t, l) => t + l.valor, 0))}
                        </option>
                      );
                    })}
                    {filiais.length > 2 &&
                      filiais.map((f) => {
                        const resto = interPrainha.pagar.filter((l) => l.casaId !== f.id);
                        return (
                          <option key={`sem-${f.id}`} value={filiais.filter((x) => x.id !== f.id).map((x) => x.id).join(',')}>
                            Todas menos {f.nome} — {resto.length} pessoas, {brl(resto.reduce((t, l) => t + l.valor, 0))}
                          </option>
                        );
                      })}
                  </select>
                </label>
                <label className="text-xs text-slate-600">
                  Conta corrente do Inter da Prainha (obrigatório)
                  <input name="conta" required placeholder="00000000-0" className="mt-0.5 block w-36 rounded border border-slate-300 px-2 py-1 text-sm" />
                </label>
                <button className="rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-sm font-medium text-sky-800 hover:bg-sky-100">
                  🔵 Arquivo do Inter da Prainha — todas: {interPrainha.pagar.length} pessoas, {brl(totalInterPrainha)}
                </button>
              </form>
              <p className="mt-1 text-xs text-slate-600">
                Mesmo modelo do Inter, pagador Prainha Turismo. Sobe no Inter da Prainha, não no da E.B.
              </p>
              {interPrainha.semConta.length > 0 && (
                <div className="mt-2 text-xs text-slate-700">
                  <p className="font-medium text-sky-900">
                    Sem conta Inter da Prainha — pagar à parte ({interPrainha.semConta.length}, {brl(interPrainha.semConta.reduce((t, l) => t + l.valor, 0))}):
                  </p>
                  <ul className="mt-1 grid gap-x-4 sm:grid-cols-2">
                    {interPrainha.semConta.map((l) => (
                      <li key={`${l.casaId}-${l.cpf}-${l.nome}`}>
                        {l.nome} <span className="text-slate-500">· {nomeFilial.get(l.casaId) ?? ''} · {brl(l.valor)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
          {configurado ? (
            <div className="space-y-3">
              <p className="text-slate-700">
                {resumo.total > 0 ? (
                  <>
                    Extrato no sistema: <b>{resumo.total}</b> lançamentos, de {fmtDia(resumo.de!)}/{resumo.de!.slice(0, 4)} a{' '}
                    {fmtDia(resumo.ate!)}/{resumo.ate!.slice(0, 4)}. Atualiza sozinho duas vezes por dia.
                  </>
                ) : (
                  <>A integração está salva, mas o extrato ainda não foi lido. Toque no botão para buscar.</>
                )}
              </p>
              <BuscarExtrato empresa={sigla} />
            </div>
          ) : (
            <div className="space-y-2 text-slate-700">
              <p className="font-medium text-amber-800">Falta salvar a integração do Inter da {empresa.nome}.</p>
              <p>Na Vercel (Production), as quatro variáveis da integração, com a permissão de consultar extrato:</p>
              <ul className="list-disc pl-5 font-mono text-xs text-slate-600">
                <li>INTER_EB_CLIENT_ID</li>
                <li>INTER_EB_CLIENT_SECRET</li>
                <li>INTER_EB_CERT_B64 — o arquivo .crt em base64</li>
                <li>INTER_EB_KEY_B64 — o arquivo .key em base64</li>
              </ul>
              <p className="text-xs text-slate-500">Depois de salvar é preciso uma publicação nova para o sistema enxergar.</p>
            </div>
          )}
        </div>

        {competencias.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Competência:</span>
            {competencias.map((c) => (
              <a
                key={c}
                href={`/rh/folha-contador/pagamentos?comp=${c}`}
                className={`rounded-md border px-3 py-1 text-xs ${c === comp ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
              >
                {nomeComp(c)}
              </a>
            ))}
          </div>
        )}

        {!comp || !conf ? (
          <p className="text-sm text-slate-500">Nenhuma folha da {empresa.nome} importada.</p>
        ) : (
          <>
            <p className="text-xs text-slate-500">
              Folha de {nomeComp(comp)}: procuro os débitos de {fmtDia(conf.janela.de)} a {fmtDia(conf.janela.ate)}, pelo nome
              de quem recebeu (primeiro nome + um sobrenome).
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  ['Líquido da folha', brl(totalFolha), `${comLiquido.length} pessoas`],
                  ['Pago e confere', brl(somaLiq('bate')), `${conta('bate').length} pessoas`],
                  ['Pago com diferença', brl(somaLiq('difere') + somaLiq('so_valor')), `${conta('difere').length + conta('so_valor').length} pessoas`],
                  ['Não achei', brl(somaLiq('nao_achou')), `${conta('nao_achou').length} pessoas`],
                ] as const
              ).map(([label, valor, sub]) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">{valor}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>
                </div>
              ))}
            </div>

            {lotes.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                <p className="font-medium text-slate-900">A folha saiu da conta em lote, sem o nome de cada pessoa</p>
                <ul className="mt-2 space-y-0.5 text-xs">
                  {lotes.map((d) => (
                    <li key={d.id}>
                      {fmtDia(d.dia)} · <b>{brl(d.valor)}</b> · {d.texto}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs">
                  Líquido das {semNome.length} pessoas sem débito no nome: <b>{brl(somaSemNome)}</b>. Lote debitado:{' '}
                  <b>{brl(totalLote)}</b>.{' '}
                  {Math.abs(faltaNoLote) < 0.005 ? (
                    <span className="text-emerald-700">Bate com o lote.</span>
                  ) : (
                    <span className="text-amber-700">
                      {faltaNoLote > 0 ? 'Faltam' : 'Sobram'} <b>{brl(Math.abs(faltaNoLote))}</b> no lote.
                    </span>
                  )}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  O extrato não diz quem está dentro do lote. Pessoa por pessoa, só com o comprovante da folha de pagamento
                  que o Inter gera.
                </p>
              </div>
            )}

            {porCasa.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <p className="px-4 pt-3 text-sm font-medium text-slate-900">Encontro de contas por casa</p>
                <p className="px-4 text-[11px] text-slate-500">
                  Líquido da folha de cada casa × o que a casa repassou pra {empresa.nome} no dia do lote.
                </p>
                <table className="mt-2 w-full text-sm">
                  <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Casa</th>
                      <th className="px-3 py-2 text-right">Pessoas</th>
                      <th className="px-3 py-2 text-right">Líquido da folha</th>
                      <th className="px-3 py-2 text-right">Repasse recebido</th>
                      <th className="px-3 py-2 text-right">Diferença</th>
                      <th className="px-3 py-2">Quem explica a diferença</th>
                    </tr>
                  </thead>
                  <tbody>
                    {porCasa.map((c) => (
                      <tr key={c.filialId} className="border-t border-slate-100">
                        <td className="px-4 py-2">{nomeFilial.get(c.filialId) ?? '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{c.pessoas}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{brl(c.liquido)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {c.repasse ? `${brl(c.repasse.valor)} · ${fmtDia(c.repasse.dia)}` : 'não achei'}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums ${c.diferenca > 0.004 ? 'text-red-700' : 'text-emerald-700'}`}>
                          {brl(c.diferenca)}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {!c.repasse
                            ? 'nenhum repasse do dia fecha com esta casa'
                            : c.fora.length === 0
                              ? 'confere'
                              : c.fora.length === 1
                                ? `${nomeDaLinha.get(c.fora[0]!)} ficou fora do lote`
                                : `um destes ficou fora: ${c.fora.map((id) => nomeDaLinha.get(id)).join(', ')}`}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t border-slate-200 bg-slate-50 font-medium">
                      <td className="px-4 py-2">Total</td>
                      <td className="px-3 py-2 text-right tabular-nums">{porCasa.reduce((t, c) => t + c.pessoas, 0)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{brl(porCasa.reduce((t, c) => t + c.liquido, 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{brl(repassado)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{brl(porCasa.reduce((t, c) => t + c.diferenca, 0))}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {Math.abs(repassado - totalLote) < 0.005
                          ? 'repasses = lote debitado'
                          : `lote debitado: ${brl(totalLote)}`}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {rateioHoras && rateioHoras.casas.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <p className="px-4 pt-3 text-sm font-medium text-slate-900">Rateio pelas horas de cada casa</p>
                <p className="px-4 text-[11px] text-slate-500">
                  Quem trabalhou em mais de uma casa tem o líquido dividido pelas horas batidas no ponto em cada uma.
                  Quem não tem ponto no mês fica 100% na casa do cadastro. Antes do ponto próprio (até o fim de setembro/2026)
                  a casa vem da equipe da pessoa no Stelanto. Só conta — não muda repasse nem conta.
                </p>
                <table className="mt-2 w-full text-sm">
                  <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Casa</th>
                      <th className="px-3 py-2 text-right">Pela casa do cadastro</th>
                      <th className="px-3 py-2 text-right">Pelas horas</th>
                      <th className="px-3 py-2 text-right">Acerto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rateioHoras.casas.map((c) => (
                      <tr key={c.filialId} className="border-t border-slate-100">
                        <td className="px-4 py-2">{nomeFilial.get(c.filialId) ?? '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{brl(c.peloCadastro)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">{brl(c.pelasHoras)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${c.diferenca > 0.004 ? 'text-red-700' : c.diferenca < -0.004 ? 'text-emerald-700' : 'text-slate-400'}`}>
                          {Math.abs(c.diferenca) < 0.005 ? '—' : `${c.diferenca > 0 ? 'paga a mais ' : 'recebe '}${brl(Math.abs(c.diferenca))}`}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t border-slate-200 bg-slate-50 font-medium">
                      <td className="px-4 py-2">Total</td>
                      <td className="px-3 py-2 text-right tabular-nums">{brl(rateioHoras.casas.reduce((t, c) => t + c.peloCadastro, 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{brl(rateioHoras.casas.reduce((t, c) => t + c.pelasHoras, 0))}</td>
                      <td className="px-3 py-2" />
                    </tr>
                  </tbody>
                </table>
                {divididos.length > 0 && (
                  <details className="border-t border-slate-100 px-4 py-3">
                    <summary className="cursor-pointer text-xs font-medium text-slate-700">
                      {divididos.length} {divididos.length === 1 ? 'pessoa trabalhou' : 'pessoas trabalharam'} fora da casa do cadastro
                    </summary>
                    <table className="mt-2 w-full text-xs">
                      <tbody className="divide-y divide-slate-100">
                        {divididos.map((p) => (
                          <tr key={p.folhaId} className="align-top">
                            <td className="py-1.5 pr-3 text-slate-900">
                              {p.nome}
                              <div className="text-[11px] text-slate-400">cadastro: {nomeFilial.get(p.cadastroFilialId) ?? '—'} · {brl(p.liquido)}</div>
                            </td>
                            <td className="py-1.5 text-slate-700">
                              {p.casas.map((c) => {
                                const tot = p.casas.reduce((t, x) => t + x.min, 0);
                                return (
                                  <div key={c.filialId}>
                                    {nomeFilial.get(c.filialId) ?? '—'}: {fmtHoras(c.min)} ({Math.round((c.min / tot) * 100)}%) → <b>{brl(c.valor)}</b>
                                  </div>
                                );
                              })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
                {semPonto.length > 0 && (
                  <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
                    Sem ponto no mês (ficam na casa do cadastro): {semPonto.map((p) => p.nome).join(', ')}.
                  </p>
                )}
              </div>
            )}

            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Pessoa</th>
                    <th className="px-3 py-2">Casa</th>
                    <th className="px-3 py-2 text-right">Líquido</th>
                    <th className="px-3 py-2">No extrato</th>
                    <th className="px-3 py-2">Situação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {linhas.map((l) => (
                    <tr key={l.folhaId} className="align-top">
                      <td className="px-3 py-2">
                        {l.funcionarioId ? (
                          <a href={`/rh/funcionarios/${l.funcionarioId}`} className="text-slate-900 hover:underline">{l.nome}</a>
                        ) : (
                          <span className="text-slate-900">{l.nome}</span>
                        )}
                        {l.situacaoFolha && l.situacaoFolha !== 'Trabalhando' && (
                          <span className="ml-1.5 text-[11px] text-slate-400">{l.situacaoFolha}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">{nomeFilial.get(l.filialId) ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {brl(l.liquido)}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {l.debitos.length === 0
                          ? '—'
                          : l.debitos.map((d) => (
                              <div key={d.id} title={d.texto}>
                                {fmtDia(d.dia)} · {brl(d.valor)}
                              </div>
                            ))}
                        {l.situacao === 'difere' && (
                          <div className="mt-0.5 text-amber-700">diferença {brl(l.pago - l.liquido)}</div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {l.noLote ? (
                          <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] ${NO_LOTE[l.noLote].classe}`}>
                            {NO_LOTE[l.noLote].rotulo}
                            {l.situacao === 'difere' && l.noLote === 'dentro' ? ' + Pix avulso' : ''}
                          </span>
                        ) : (
                          <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] ${SITUACAO[l.situacao].classe}`}>
                            {l.situacao === 'nao_achou' && lotes.length > 0 ? 'sem nome no extrato (ver lote)' : SITUACAO[l.situacao].rotulo}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {conf.debitosSemPessoa.length > 0 && (
              <details className="rounded-xl border border-slate-200 bg-white p-4">
                <summary className="cursor-pointer text-sm font-medium text-slate-800">
                  Outros débitos do período ({conf.debitosSemPessoa.length} ·{' '}
                  {brl(conf.debitosSemPessoa.reduce((s, d) => s + d.valor, 0))}) — não casaram com ninguém desta folha
                </summary>
                <table className="mt-3 w-full text-xs">
                  <tbody className="divide-y divide-slate-100">
                    {conf.debitosSemPessoa.map((d) => (
                      <tr key={d.id}>
                        <td className="py-1.5 pr-3 text-slate-500">{fmtDia(d.dia)}</td>
                        <td className="py-1.5 pr-3 text-slate-700">{d.texto || d.historico || '—'}</td>
                        <td className="py-1.5 text-right tabular-nums text-slate-900">{brl(d.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </>
        )}
      </div>
    </main>
  );
}
