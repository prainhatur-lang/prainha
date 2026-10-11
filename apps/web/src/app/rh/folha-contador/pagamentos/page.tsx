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
import { desc, eq } from 'drizzle-orm';
import {
  EMPRESAS_EXTRATO,
  conferirFolhaComExtrato,
  extratoEmpresaConfigurado,
  resumoExtratoEmpresa,
  type SituacaoPagamento,
} from '@/lib/extrato-empresa';
import { BuscarExtrato } from './buscar-extrato';

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

export default async function PagamentosFolhaContadorPage(props: { searchParams: Promise<{ comp?: string }> }) {
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

  const competencias = (
    await db
      .selectDistinct({ competencia: schema.folhaContador.competencia })
      .from(schema.folhaContador)
      .where(eq(schema.folhaContador.cnpj, empresa.cnpj))
      .orderBy(desc(schema.folhaContador.competencia))
  ).map((c) => c.competencia);
  const comp = sp.comp && competencias.includes(sp.comp) ? sp.comp : competencias[0] ?? null;

  const configurado = extratoEmpresaConfigurado(sigla);
  const resumo = await resumoExtratoEmpresa(sigla);
  const conf = comp ? await conferirFolhaComExtrato(sigla, comp, filialIds) : null;

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

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-5xl space-y-5 px-6 py-8">
        <div>
          <a href="/rh/folha-contador" className="text-xs text-slate-500 hover:underline">← Folha do contador</a>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">Pagamentos da {empresa.nome}</h1>
          <p className="mt-1 text-sm text-slate-500">
            O líquido de cada pessoa na folha do contador, conferido com o que saiu da conta da {empresa.nome} no Inter.
            Só leitura — nada aqui dá baixa nem gera conta.
          </p>
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
                      <td className="px-3 py-2 text-right tabular-nums">{brl(l.liquido)}</td>
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
                        <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] ${SITUACAO[l.situacao].classe}`}>
                          {l.situacao === 'nao_achou' && lotes.length > 0 ? 'sem nome no extrato (ver lote)' : SITUACAO[l.situacao].rotulo}
                        </span>
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
