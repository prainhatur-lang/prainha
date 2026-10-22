// /financeiro/pix-inter — Pix enviados pela conta do Inter (extrato,
// lancamento_banco) cruzados com Contas a pagar. A API de pagamentos do Inter
// só traz boleto (/financeiro/boletos-inter); conta paga por Pix ficava em
// aberto. Cada Pix casa com UMA conta em aberto de mesmo saldo e nome do
// favorecido batendo com o fornecedor (regra em lib/pix-inter). A baixa é no
// botão; conta de outra casa entra também no encontro de contas.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, eq, ilike, max, min } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, formatDate, int } from '@/lib/format';
import { hojeBr, diasAtrasBr } from '@/lib/datas';
import { casasComConsumerParado } from '@/lib/consumer-contas';
import {
  baixasPorPix,
  casarPix,
  contasParaPix,
  encontrosPorPix,
  pixDoExtrato,
  type ContaPix,
  type ResultadoPix,
} from '@/lib/pix-inter';
import { BaixarPix, BaixarPixLote, DesfazerPix, type PixBaixa } from './pix-acoes';
import { BLOQUEIO_ENTRE_CASAS_DESDE, entreCasasBloqueado } from '@/lib/pagamento-entre-casas';
import { ehAdmin } from '@/lib/usuario-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ver = 'todos' | 'casado' | 'baixado' | 'ja_pago' | 'sem_conta';

interface SP {
  filialId?: string;
  dataIni?: string;
  dataFim?: string;
  ver?: string;
}

/** Pix pago até 15 dias antes/depois do vencimento entra no "baixar todas";
 *  mais longe que isso pode ser outra conta do mesmo fornecedor. */
const PERTO_DIAS = 15;

const dias = (a: string, b: string) =>
  Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);

export default async function PixInterPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'conta_pagar.read');

  const sp = await props.searchParams;
  const filiais = await filiaisDoUsuario(user.id);
  const escolhida = await escolherFilial(filiais, sp.filialId);

  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  const dataFim = sp.dataFim && ymd.test(sp.dataFim) ? sp.dataFim : hojeBr();
  const dataIni = sp.dataIni && ymd.test(sp.dataIni) ? sp.dataIni : diasAtrasBr(30);
  const ver: Ver = (['casado', 'baixado', 'ja_pago', 'sem_conta'] as const).includes(sp.ver as never)
    ? (sp.ver as Ver)
    : 'todos';

  const pixes = escolhida ? await pixDoExtrato(escolhida.id, dataIni, dataFim) : [];

  // até onde vai o extrato importado dessa casa (a Mar só tem de 02/10 pra cá)
  const [faixa] = escolhida
    ? await db
        .select({ de: min(schema.lancamentoBanco.dataMovimento), ate: max(schema.lancamentoBanco.dataMovimento) })
        .from(schema.lancamentoBanco)
        .where(
          and(
            eq(schema.lancamentoBanco.filialId, escolhida.id),
            ilike(schema.lancamentoBanco.descricao, 'Pix enviado%'),
          ),
        )
    : [];

  // Contas de todas as casas que o usuário acessa: o Pix de uma casa pode ter
  // pago a conta da outra. Conta do Consumer em aberto só entra quando a casa
  // saiu do Consumer (senão a baixa é no PDV); a já paga entra pra dizer de
  // quem é o Pix.
  const todasContas =
    pixes.length > 0 ? await contasParaPix(filiais.map((f) => f.id), dataIni, dataFim) : [];
  const parado = await casasComConsumerParado(
    todasContas.filter((c) => c.origem === 'CONSUMER').map((c) => c.filialId),
  );
  const contas = todasContas.filter(
    (c) => c.origem !== 'CONSUMER' || c.dataPagamento || parado.has(c.filialId),
  );
  const contaPorId = new Map(todasContas.map((c) => [c.id, c]));

  const feitos = await baixasPorPix(pixes.map((p) => p.id));
  const resultados = escolhida ? casarPix(pixes, contas, feitos, escolhida.id) : [];
  const encontros = escolhida
    ? await encontrosPorPix(
        escolhida.id,
        resultados.filter((r) => r.tipo === 'baixado').map((r) => r.pix.id),
      )
    : new Map<string, { id: string; status: string }>();

  const nomeFilial = new Map(filiais.map((f) => [f.id, f.nome]));
  const outraCasa = (c: { filialId: string } | null | undefined) =>
    c && c.filialId !== escolhida?.id ? (nomeFilial.get(c.filialId) ?? 'outra casa') : null;
  const rotuloConta = (c: ContaPix) =>
    `${c.fornecedorNome ?? c.descricao ?? 'conta'} venc. ${c.dataVencimento.split('-').reverse().join('/')}`;
  const paraBaixa = (r: ResultadoPix, c: ContaPix): PixBaixa => ({
    pixId: r.pix.id,
    contaId: c.id,
    valor: r.pix.valor,
    rotulo: rotuloConta(c),
    outraCasa: outraCasa(c),
  });

  const podeBaixar = await podeUsuario(user.id, 'conta_pagar.marcar_pago');
  // regra do dono 22/10/2026: Pix desta casa pagando conta de outra, da data
  // em diante, fica travado (sem baixa e sem encontro) — só o Admin baixa
  const admin = await ehAdmin(user.id);
  const travada = (r: ResultadoPix, c: { filialId: string }) =>
    !!outraCasa(c) && entreCasasBloqueado(r.pix.data, admin);
  const casados = resultados.filter((r): r is Extract<ResultadoPix, { tipo: 'casado' }> => r.tipo === 'casado');
  const noLote = (r: Extract<ResultadoPix, { tipo: 'casado' }>) =>
    !outraCasa(r.conta) && Math.abs(dias(r.pix.data, r.conta.dataVencimento)) <= PERTO_DIAS;
  const lote = podeBaixar ? casados.filter(noLote).map((r) => paraBaixa(r, r.conta)) : [];
  const foraLote = {
    outraCasa: casados.filter((r) => outraCasa(r.conta)).length,
    longe: casados.filter((r) => !outraCasa(r.conta) && !noLote(r)).length,
  };

  const entreCasas = resultados.filter((r) => r.tipo === 'casas');
  const linhas = resultados
    .filter((r) => r.tipo !== 'casas')
    .sort((a, b) => b.pix.data.localeCompare(a.pix.data));
  const resumo: Record<Exclude<Ver, 'todos'>, { q: number; v: number }> = {
    casado: { q: 0, v: 0 },
    baixado: { q: 0, v: 0 },
    ja_pago: { q: 0, v: 0 },
    sem_conta: { q: 0, v: 0 },
  };
  let total = 0;
  for (const r of linhas) {
    resumo[r.tipo].q += 1;
    resumo[r.tipo].v += r.pix.valor;
    total += r.pix.valor;
  }
  const visiveis = ver === 'todos' ? linhas : linhas.filter((r) => r.tipo === ver);

  function href(next: Partial<SP>): string {
    const qs = new URLSearchParams();
    if (escolhida) qs.set('filialId', escolhida.id);
    qs.set('dataIni', next.dataIni ?? dataIni);
    qs.set('dataFim', next.dataFim ?? dataFim);
    const v = next.ver ?? ver;
    if (v !== 'todos') qs.set('ver', v);
    return `/financeiro/pix-inter?${qs.toString()}`;
  }

  const hoje = hojeBr();

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900">Pix pagos no Inter</h1>
          <div className="flex shrink-0 gap-2">
            <Link
              href={`/financeiro/boletos-inter${escolhida ? `?filialId=${escolhida.id}` : ''}`}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Boletos pagos no Inter
            </Link>
            <Link
              href={`/financeiro${escolhida ? `?filialId=${escolhida.id}` : ''}`}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Contas a pagar
            </Link>
          </div>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Pix que a conta do Inter enviou no período, tirados do extrato importado, comparados com
          Contas a pagar. Casa quando o valor bate com o saldo da conta em aberto e o nome de quem
          recebeu bate com o fornecedor. A baixa só acontece no botão.
        </p>

        {filiais.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/financeiro/pix-inter?filialId=${f.id}&dataIni=${dataIni}&dataFim=${dataFim}`}
                className={`rounded-md border px-3 py-1 text-xs ${
                  f.id === escolhida?.id
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {f.nome}
              </Link>
            ))}
          </div>
        )}

        {!escolhida ? (
          <p className="mt-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
        ) : (
          <>
            <form
              action="/financeiro/pix-inter"
              method="GET"
              className="mt-6 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <input type="hidden" name="filialId" value={escolhida.id} />
              {ver !== 'todos' && <input type="hidden" name="ver" value={ver} />}
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  De
                </label>
                <input
                  type="date"
                  name="dataIni"
                  defaultValue={dataIni}
                  className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Até
                </label>
                <input
                  type="date"
                  name="dataFim"
                  defaultValue={dataFim}
                  className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm"
                />
              </div>
              <button
                type="submit"
                className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
              >
                Aplicar
              </button>
              <div className="ml-auto flex flex-wrap items-center gap-1">
                {(
                  [
                    ['7d', diasAtrasBr(7)],
                    ['15d', diasAtrasBr(15)],
                    ['30d', diasAtrasBr(30)],
                    ['60d', diasAtrasBr(60)],
                    ['Este mês', hoje.slice(0, 7) + '-01'],
                  ] as Array<[string, string]>
                ).map(([label, ini]) => (
                  <Link
                    key={label}
                    href={href({ dataIni: ini, dataFim: hoje })}
                    className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                  >
                    {label}
                  </Link>
                ))}
              </div>
            </form>

            <p className="mt-2 text-xs text-slate-500">
              {faixa?.de && faixa?.ate ? (
                <>
                  Extrato do Inter desta casa importado de {formatDate(faixa.de)} a{' '}
                  {formatDate(faixa.ate)}. Pix fora disso não aparece aqui.
                </>
              ) : (
                'Esta casa não tem extrato do Inter importado.'
              )}{' '}
              <Link href="/relatorios/fechamento/extratos" className="underline">
                Importar extrato
              </Link>
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Cartao
                label="Pix no período"
                qtd={linhas.length}
                valor={total}
                cor="border-slate-200 bg-white"
                href={href({ ver: 'todos' })}
                ativo={ver === 'todos'}
              />
              <Cartao
                label="Pago no Pix, aberto aqui"
                qtd={resumo.casado.q}
                valor={resumo.casado.v}
                cor="border-amber-200 bg-amber-50"
                href={href({ ver: 'casado' })}
                ativo={ver === 'casado'}
              />
              <Cartao
                label="Baixado por aqui"
                qtd={resumo.baixado.q}
                valor={resumo.baixado.v}
                cor="border-emerald-200 bg-emerald-50"
                href={href({ ver: 'baixado' })}
                ativo={ver === 'baixado'}
              />
              <Cartao
                label="Conta já estava paga"
                qtd={resumo.ja_pago.q}
                valor={resumo.ja_pago.v}
                cor="border-emerald-200 bg-white"
                href={href({ ver: 'ja_pago' })}
                ativo={ver === 'ja_pago'}
              />
              <Cartao
                label="Sem conta em aberto"
                qtd={resumo.sem_conta.q}
                valor={resumo.sem_conta.v}
                cor="border-rose-200 bg-rose-50"
                href={href({ ver: 'sem_conta' })}
                ativo={ver === 'sem_conta'}
              />
            </div>

            {entreCasas.length > 0 && (
              <p className="mt-3 text-xs text-slate-600">
                {int(entreCasas.length)} Pix pras próprias casas (
                {brl(entreCasas.reduce((s, r) => s + r.pix.valor, 0))}) ficam de fora — é
                transferência entre as casas, não conta a pagar.
              </p>
            )}

            {casados.some((r) => outraCasa(r.conta)) && (
              <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs text-violet-900">
                <span className="font-semibold">{int(foraLote.outraCasa)}</span>{' '}
                {foraLote.outraCasa === 1 ? 'Pix pagou conta lançada' : 'Pix pagaram contas lançadas'}{' '}
                em outra casa. Ao baixar, a conta fica na casa dela e a dívida entra no{' '}
                <Link href="/movimento/transferencias/encontro" className="font-medium underline">
                  encontro de contas
                </Link>{' '}
                do mês do Pix. Esses ficam fora do botão de baixar todas — confira e baixe pela linha.
                <span className="mt-2 block rounded-lg border border-rose-200 bg-rose-50 p-2 text-rose-900">
                  <span className="font-semibold">🚫 Desde {BLOQUEIO_ENTRE_CASAS_DESDE.split('-').reverse().join('/')} uma casa não paga conta de outra</span>{' '}
                  (regra do dono). A casa que está na nota paga o fornecedor; mercadoria pra outra
                  casa vai por{' '}
                  <Link href="/movimento/transferencias" className="font-medium underline">
                    transferência
                  </Link>
                  , que gera o crédito, e as casas se acertam no encontro. Pix dessa data em diante
                  pagando conta de outra casa fica travado aqui; só o Admin baixa.
                </span>
              </div>
            )}

            <BaixarPixLote itens={lote} />
            {podeBaixar && foraLote.longe > 0 && (
              <p className="mt-2 text-xs text-slate-600">
                {int(foraLote.longe)}{' '}
                {foraLote.longe === 1 ? 'conta casada fica' : 'contas casadas ficam'} fora do botão
                porque o Pix saiu a mais de {PERTO_DIAS} dias do vencimento (pode ser outra conta do
                mesmo fornecedor) — confira e baixe pela linha.
              </p>
            )}

            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Pix em</th>
                    <th className="px-4 py-2">Pra quem (extrato)</th>
                    <th className="px-4 py-2 text-right">Valor</th>
                    <th className="px-4 py-2">Em Contas a pagar</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-xs text-slate-500">
                        Nenhum Pix nesse filtro.
                      </td>
                    </tr>
                  ) : (
                    visiveis.map((r) => (
                      <tr key={r.pix.id} className="border-t border-slate-100 align-top">
                        <td className="px-4 py-2 font-mono text-xs text-slate-700">
                          {formatDate(r.pix.data)}
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-800">
                          {r.pix.favorecido ?? (
                            <span className="text-slate-500">{r.pix.descricao}</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-sm font-medium text-slate-900">
                          {brl(r.pix.valor)}
                        </td>
                        <td className="px-4 py-2 text-xs">
                          {r.tipo === 'casado' && (
                            <>
                              <ContaLink conta={r.conta} classe="bg-amber-100 text-amber-800">
                                ⚠ em aberto · {r.conta.fornecedorNome ?? r.conta.descricao ?? 'conta'} · venc.{' '}
                                {formatDate(r.conta.dataVencimento)}
                              </ContaLink>
                              <CasaBadge nome={outraCasa(r.conta)} />
                              {podeBaixar && !travada(r, r.conta) && (
                                <span className="ml-1.5">
                                  <BaixarPix item={paraBaixa(r, r.conta)} />
                                </span>
                              )}
                              {travada(r, r.conta) && (
                                <span className="mt-1 block text-[10px] font-semibold text-rose-700">
                                  🚫 casa errada: desde 22/10 uma casa não paga conta de outra — sem
                                  baixa por aqui; só o Admin lança
                                </span>
                              )}
                              {!noLote(r) && !outraCasa(r.conta) && (
                                <span className="ml-1.5 text-[10px] text-amber-700">
                                  vencimento longe do Pix, confira
                                </span>
                              )}
                            </>
                          )}
                          {r.tipo === 'baixado' && (
                            <>
                              <ContaLink
                                conta={contaPorId.get(r.contaId) ?? { id: r.contaId }}
                                classe="bg-emerald-100 text-emerald-800"
                              >
                                ✓ baixada por este Pix
                                {contaPorId.get(r.contaId) &&
                                  ` · ${contaPorId.get(r.contaId)!.fornecedorNome ?? contaPorId.get(r.contaId)!.descricao ?? 'conta'}`}
                              </ContaLink>
                              <CasaBadge nome={outraCasa(contaPorId.get(r.contaId))} />
                              {encontros.get(r.pix.id) && (
                                <span className="ml-1.5 whitespace-nowrap rounded bg-violet-700 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                  ⚖️{' '}
                                  {encontros.get(r.pix.id)!.status === 'COMPENSADO'
                                    ? 'compensado no encontro'
                                    : 'no encontro de contas'}
                                </span>
                              )}
                              {podeBaixar && encontros.get(r.pix.id)?.status !== 'COMPENSADO' && (
                                <DesfazerPix
                                  pixId={r.pix.id}
                                  rotulo={`${r.pix.favorecido ?? 'o Pix'} (${brl(r.pix.valor)})`}
                                />
                              )}
                            </>
                          )}
                          {r.tipo === 'ja_pago' && (
                            <>
                              <ContaLink conta={r.conta} classe="bg-emerald-50 text-emerald-800">
                                ✓ já paga · {r.conta.fornecedorNome ?? r.conta.descricao ?? 'conta'}
                                {r.conta.dataPagamento && ` em ${formatDate(r.conta.dataPagamento)}`}
                              </ContaLink>
                              <CasaBadge nome={outraCasa(r.conta)} />
                            </>
                          )}
                          {r.tipo === 'sem_conta' && (
                            <>
                              <span className="inline-flex rounded-md bg-rose-100 px-2 py-0.5 text-rose-800">
                                nenhuma conta em aberto com esse nome e valor
                              </span>
                              {r.mesmoValor.length > 0 && (
                                <ul className="mt-1.5 space-y-1">
                                  {r.mesmoValor.map((c) => (
                                    <li key={c.id} className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
                                      <span>mesmo valor:</span>
                                      <Link href={`/financeiro/conta/${c.id}`} className="text-slate-800 hover:underline">
                                        {rotuloConta(c)}
                                      </Link>
                                      <CasaBadge nome={outraCasa(c)} />
                                      {travada(r, c) && (
                                        <span className="text-[10px] font-semibold text-rose-700">
                                          🚫 casa errada (desde 22/10)
                                        </span>
                                      )}
                                      {podeBaixar && !travada(r, c) && (
                                        <BaixarPix
                                          item={paraBaixa(r, c)}
                                          texto="baixar esta"
                                          aviso={`Atenção: o Pix foi pra "${r.pix.favorecido ?? 'favorecido sem nome'}" e a conta é de "${c.fornecedorNome ?? c.descricao ?? 'sem fornecedor'}". Só baixe se tiver certeza que é a mesma.`}
                                        />
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function ContaLink({
  conta,
  classe,
  children,
}: {
  conta: { id: string };
  classe: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={`/financeiro/conta/${conta.id}`}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 hover:underline ${classe}`}
    >
      {children}
    </Link>
  );
}

function CasaBadge({ nome }: { nome: string | null }) {
  if (!nome) return null;
  return (
    <span className="ml-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800">
      conta da {nome}
    </span>
  );
}

function Cartao({
  label,
  qtd,
  valor,
  cor,
  href,
  ativo,
}: {
  label: string;
  qtd: number;
  valor: number;
  cor: string;
  href: string;
  ativo: boolean;
}) {
  return (
    <Link href={href}>
      <div
        className={`rounded-xl border p-4 hover:shadow-sm ${cor} ${ativo ? 'ring-2 ring-slate-900' : ''}`}
      >
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600">{label}</p>
        <p className="mt-1 text-2xl font-bold text-slate-900">{int(qtd)}</p>
        <p className="text-xs text-slate-700">{brl(valor)}</p>
      </div>
    </Link>
  );
}
