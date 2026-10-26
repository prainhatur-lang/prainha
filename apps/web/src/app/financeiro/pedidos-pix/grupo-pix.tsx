'use client';

// Card de um fornecedor na tela de pedidos a pagar por Pix: chave e valor pra
// copiar, cadastro da chave que falta (mesmo editor do cadastro de
// fornecedores, que replica pras outras casas) e a baixa das contas marcadas
// depois que o dono pagou no Inter. A baixa usa a rota de sempre da conta.
// Desde 20/10/2026 também "💸 Pagar" em cada conta: manda o Pix pela API do
// Inter (só Admin) e, se o banco processar, dá a baixa sozinho. Um Pix por
// conta (nota/pedido), nunca somado — pra saber o que pagou o quê. O caminho
// antigo (copiar, pagar no app, "Paguei no Inter") continua igual.
// 22/10/2026: o painel de confirmar mostra o saldo do Inter e não deixa
// confirmar quando já se vê que falta (o servidor confere de novo).

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EditPix, ConferenciaPixLinha } from '@/app/cadastros/fornecedores/edit-pix';
import { conferirChavePix, type ConferenciaPix } from '@/lib/pix-titular';
import { EVENTO_SALDO_PIX, useSaldoPix } from './saldo-inter';

export interface PedidoPix {
  id: string;
  venc: string;
  descricao: string;
  valor: number;
  saldo: number;
  parcial: boolean;
  pareceBoleto: boolean;
  /** Pedido ligado, quem lançou e quem conferiu (20/10/2026). */
  origem?: {
    notaId: string | null;
    notaNumero: number | null;
    ehPedidoFoto: boolean;
    lancouConta: string | null;
    lancouEstoque: string | null;
    conferidaEm: string | null;
    conferiu: string | null;
    /** Foto do pedido / nota de serviço / boleto anexado (20/10/2026). */
    fotos?: Array<{ url: string; rotulo: string }>;
  };
}

const quemCurto = (s: string) => (s.includes('@') ? s.split('@')[0]! : s);

const ehPdf = (url: string) => /\.pdf($|\?)/i.test(url);

/** Miniaturas das fotos do pedido/boleto; clique abre grande por cima da tela. */
function FotosPedido({ fotos }: { fotos: Array<{ url: string; rotulo: string }> }) {
  const [aberta, setAberta] = useState<{ url: string; rotulo: string } | null>(null);
  if (fotos.length === 0) return null;
  return (
    <>
      <span className="flex flex-wrap items-center gap-1.5">
        {fotos.map((f) =>
          ehPdf(f.url) ? (
            <a
              key={f.url}
              href={f.url}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-medium text-sky-700 hover:bg-slate-50"
            >
              📎 {f.rotulo} (PDF)
            </a>
          ) : (
            <button
              key={f.url}
              type="button"
              onClick={() => setAberta(f)}
              title={`Ver a foto do ${f.rotulo}`}
              className="group flex items-center gap-1 rounded border border-slate-300 bg-white p-0.5 pr-1.5 hover:border-sky-400"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.url} alt={`foto do ${f.rotulo}`} loading="lazy" className="h-10 w-10 rounded object-cover" />
              <span className="font-medium text-sky-700 group-hover:underline">📷 {f.rotulo}</span>
            </button>
          ),
        )}
      </span>
      {aberta && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-4"
          onClick={() => setAberta(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={aberta.url}
            alt={`foto do ${aberta.rotulo}`}
            className="max-h-[85vh] max-w-full rounded bg-white object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="mt-3 flex gap-4 text-sm">
            <a
              href={aberta.url}
              target="_blank"
              rel="noreferrer"
              className="text-sky-300 underline"
              onClick={(e) => e.stopPropagation()}
            >
              abrir em outra aba
            </a>
            <button type="button" onClick={() => setAberta(null)} className="text-white underline">
              fechar
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function LinhaOrigem({ o }: { o: NonNullable<PedidoPix['origem']> }) {
  const lancou = o.lancouConta ?? o.lancouEstoque;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-[7.25rem] pr-4 pb-2 text-[11px] text-slate-500">
      {o.notaId ? (
        <a href={`/movimento/entrada-notas/${o.notaId}`} className="font-medium text-sky-700 hover:underline">
          📄 Ver {o.ehPedidoFoto ? 'pedido' : 'nota'}
          {o.notaNumero ? ` nº ${o.notaNumero}` : ''}
        </a>
      ) : (
        <span className="text-amber-700">⚠ sem pedido no sistema (lançada à mão)</span>
      )}
      {o.fotos && <FotosPedido fotos={o.fotos} />}
      <span>
        Lançou: <b className="font-medium text-slate-700">{lancou ? quemCurto(lancou) : 'não registrado'}</b>
      </span>
      {o.notaId &&
        (o.conferidaEm ? (
          <span>
            Conferiu:{' '}
            <b className="font-medium text-emerald-700">{o.conferiu ? quemCurto(o.conferiu) : 'não registrado'}</b> em{' '}
            {o.conferidaEm}
          </span>
        ) : (
          <span className="text-amber-700">⚠ não conferido</span>
        ))}
    </div>
  );
}

export interface GrupoPedidos {
  fornecedorId: string | null;
  nome: string;
  documento: string | null;
  chavePix: string | null;
  pixFavorecido: string | null;
  contas: PedidoPix[];
  /** Rescisão (26/10/2026): sem chave no cadastro, o Pix sai pelo CPF do funcionário. */
  chaveCpfRescisao?: string | null;
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (ymd: string) => ymd.split('-').reverse().join('/');
const valorParaCopiar = (v: number) => v.toFixed(2).replace('.', ',');

function diasAtraso(venc: string, hoje: string) {
  return Math.round((Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${venc}T12:00:00Z`)) / 86_400_000);
}

function BotaoCopiar({ texto, rotulo }: { texto: string; rotulo: string }) {
  const [ok, setOk] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      const t = document.createElement('textarea');
      t.value = texto;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    setOk(true);
    setTimeout(() => setOk(false), 1500);
  }
  return (
    <button
      type="button"
      onClick={() => void copiar()}
      className={`rounded-md border px-2 py-1 text-xs font-medium ${
        ok ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
      }`}
    >
      {ok ? '✓ copiado' : rotulo}
    </button>
  );
}

export function GrupoPix({
  grupo,
  hoje,
  podeBaixar,
  podeEditarFornecedor,
  filialId,
  podePagarPix = false,
  temInterPix = false,
  contasTravadas = [],
  situacaoPix = {},
}: {
  grupo: GrupoPedidos;
  hoje: string;
  podeBaixar: boolean;
  podeEditarFornecedor: boolean;
  filialId?: string;
  /** Admin pode mandar Pix pelo sistema (Inter). */
  podePagarPix?: boolean;
  /** Casa tem a integração de pagamentos do Inter. */
  temInterPix?: boolean;
  /** Contas que já estão num Pix enviado pelo sistema sem desfecho. */
  contasTravadas?: string[];
  /** Conta → situação do Pix em andamento (ex.: "falta aprovar no app do Inter"). */
  situacaoPix?: Record<string, string>;
}) {
  const router = useRouter();
  const [marcadas, setMarcadas] = useState<Set<string>>(
    () => new Set(grupo.contas.filter((c) => !c.pareceBoleto).map((c) => c.id)),
  );
  const [dataPgto, setDataPgto] = useState(hoje);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  const totalMarcado = useMemo(
    () => grupo.contas.filter((c) => marcadas.has(c.id)).reduce((s, c) => s + c.saldo, 0),
    [grupo.contas, marcadas],
  );
  const chaveCadastrada = grupo.chavePix?.trim() || null;
  const chave = chaveCadastrada || grupo.chaveCpfRescisao?.trim() || null;
  const chaveEhCpfRescisao = !chaveCadastrada && !!chave;
  // Anti-fraude (22/10/2026): chave × CPF/CNPJ do fornecedor.
  const conferencia = conferirChavePix({ chave, docFornecedor: grupo.documento, favorecido: grupo.pixFavorecido });
  const travadas = useMemo(() => new Set(contasTravadas), [contasTravadas]);
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);
  const contaConfirmando = grupo.contas.find((c) => c.id === confirmandoId) ?? null;
  const [valorDigitado, setValorDigitado] = useState('');
  const [enviando, setEnviando] = useState(false);
  const totalCentavos = Math.round((contaConfirmando?.saldo ?? 0) * 100);
  const digitadoCentavos = (() => {
    const t = valorDigitado.replace(/[^\d,.]/g, '');
    if (!t) return null;
    const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  })();
  const valorConfere = digitadoCentavos !== null && digitadoCentavos === totalCentavos;
  const mostraPagarPix = podePagarPix && !!filialId && !!grupo.fornecedorId;
  const podeBotaoPix = mostraPagarPix && temInterPix && !!chave;

  async function pagarPix() {
    if (!filialId || !grupo.fornecedorId || !valorConfere || !contaConfirmando) return;
    const contas = [contaConfirmando];
    setEnviando(true);
    setMsg(null);
    const r = await fetch('/api/financeiro/pedidos-pix/pagar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        filialId,
        fornecedorId: grupo.fornecedorId,
        contaIds: contas.map((c) => c.id),
        valorConfirmado: totalCentavos / 100,
      }),
    }).catch(() => null);
    const d = r ? ((await r.json().catch(() => ({}))) as { error?: string; mensagem?: string }) : {};
    setEnviando(false);
    setConfirmandoId(null);
    setValorDigitado('');
    if (!r) {
      setMsg({
        tipo: 'erro',
        texto: 'Sem resposta do sistema. O Pix PODE ter saído: confira no app do Inter e na lista "Pix enviados pelo sistema".',
      });
    } else if (r.ok && r.status !== 202) {
      setMsg({ tipo: 'ok', texto: d.mensagem ?? 'Pix enviado.' });
    } else {
      setMsg({ tipo: 'erro', texto: d.error ?? `Falhou (${r.status}).` });
    }
    window.dispatchEvent(new Event(EVENTO_SALDO_PIX));
    router.refresh();
  }

  function alternar(id: string) {
    setMarcadas((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function baixar() {
    const contas = grupo.contas.filter((c) => marcadas.has(c.id));
    if (contas.length === 0) return;
    const emPix = contas.filter((c) => travadas.has(c.id));
    if (emPix.length > 0) {
      const segue = window.confirm(
        `⚠ ${emPix.length} conta(s) marcada(s) já têm um Pix pelo sistema em andamento no Inter (${emPix
          .map((c) => situacaoPix[c.id] ?? 'em andamento')
          .join(', ')}).\n\nSe você pagou de outro jeito, REJEITE esse Pix pendente no app do Inter — senão o fornecedor recebe duas vezes.\nSe foi esse Pix que você aprovou, não precisa dar baixa: a tela confere sozinha no Inter.\n\nDar baixa manual mesmo assim?`,
      );
      if (!segue) return;
    }
    const ok = window.confirm(
      `Dar baixa em ${contas.length} conta(s) de ${grupo.nome}, total ${brl(totalMarcado)}, pagas em ${dataBr(dataPgto)}?\n\nSó confirme depois que o Pix saiu no Inter.`,
    );
    if (!ok) return;
    setPending(true);
    setMsg(null);
    const erros: string[] = [];
    for (const c of contas) {
      const r = await fetch(`/api/financeiro/contas/${c.id}/baixas`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          data: dataPgto,
          valor: Math.round(c.saldo * 100) / 100,
          observacao: 'Pix pago no Inter (tela Pedidos a pagar por Pix)',
        }),
      }).catch(() => null);
      if (!r || !r.ok) {
        const d = r ? ((await r.json().catch(() => ({}))) as { error?: string }) : {};
        erros.push(`${dataBr(c.venc)} ${brl(c.saldo)}: ${d.error ?? 'falha de rede'}`);
      }
    }
    setPending(false);
    if (erros.length > 0) {
      setMsg({ tipo: 'erro', texto: `Não baixou: ${erros.join(' · ')}` });
    } else {
      setMsg({ tipo: 'ok', texto: 'Baixa feita.' });
    }
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-4">
        <div className="min-w-0">
          <div className="font-semibold text-slate-900">{grupo.nome}</div>
          {grupo.documento && <div className="text-xs text-slate-500">CPF/CNPJ {grupo.documento}</div>}
          {chave ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-sky-50 px-2 py-1 font-mono text-sm text-sky-900 break-all">
                💠 {chave}
              </span>
              <BotaoCopiar texto={chave} rotulo="Copiar chave" />
              {chaveEhCpfRescisao && (
                <span className="text-[11px] text-slate-500">CPF do funcionário (rescisão)</span>
              )}
            </div>
          ) : (
            <div className="mt-2 text-xs font-medium text-amber-700">Sem chave Pix cadastrada</div>
          )}
          {grupo.pixFavorecido && (
            <div className="mt-1 text-xs text-slate-600">Recebe em nome de {grupo.pixFavorecido}</div>
          )}
          {conferencia && (
            <div className="mt-1 text-xs">
              <ConferenciaPixLinha c={conferencia} />
            </div>
          )}
          {grupo.fornecedorId && podeEditarFornecedor && (
            <EditPix
              fornecedorId={grupo.fornecedorId}
              chaveAtual={grupo.chavePix}
              favorecidoAtual={grupo.pixFavorecido}
              docFornecedor={grupo.documento}
            />
          )}
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">A pagar (marcadas)</div>
          <div className="text-xl font-bold text-slate-900">{brl(totalMarcado)}</div>
          {totalMarcado > 0 && (
            <div className="mt-1">
              <BotaoCopiar texto={valorParaCopiar(totalMarcado)} rotulo="Copiar valor" />
            </div>
          )}
        </div>
      </div>

      <ul className="divide-y divide-slate-100">
        {grupo.contas.map((c) => {
          const atraso = diasAtraso(c.venc, hoje);
          return (
            <li key={c.id}>
            <div className="flex items-center gap-3 px-4 py-2 text-sm">
              <input
                type="checkbox"
                checked={marcadas.has(c.id)}
                onChange={() => alternar(c.id)}
                className="h-4 w-4"
              />
              <span className="w-20 shrink-0 font-mono text-xs text-slate-600">{dataBr(c.venc)}</span>
              {travadas.has(c.id) && (
                <span className="shrink-0 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                  Pix em andamento{situacaoPix[c.id] ? `: ${situacaoPix[c.id]}` : ''}
                </span>
              )}
              <a
                href={`/financeiro/conta/${c.id}`}
                className="min-w-0 flex-1 truncate text-slate-800 hover:underline"
                title={c.descricao}
              >
                {c.descricao}
                {c.pareceBoleto && <span className="ml-2 text-[10px] text-slate-400">(boleto/NF-e)</span>}
                {c.parcial && <span className="ml-2 text-[10px] text-sky-700">(saldo de pagamento parcial)</span>}
              </a>
              {atraso > 0 ? (
                <span className="shrink-0 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">
                  {atraso}d atraso
                </span>
              ) : atraso === 0 ? (
                <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                  vence hoje
                </span>
              ) : null}
              <span className="w-24 shrink-0 text-right font-medium text-slate-900">{brl(c.saldo)}</span>
              {podeBotaoPix && !travadas.has(c.id) && (
                <button
                  type="button"
                  disabled={pending || enviando}
                  onClick={() => {
                    setConfirmandoId(confirmandoId === c.id ? null : c.id);
                    setValorDigitado('');
                    setMsg(null);
                  }}
                  className="shrink-0 rounded-md bg-violet-700 px-2 py-1 text-[11px] font-semibold text-white disabled:bg-slate-400"
                  title="Mandar o Pix só desta conta pelo Inter"
                >
                  💸 Pagar
                </button>
              )}
            </div>
            {contaConfirmando?.id === c.id && chave && (
              <PainelConfirmar
                filialId={filialId}
                recebe={grupo.pixFavorecido || grupo.nome}
                chave={chave}
                conferencia={conferencia}
                conta={c}
                valorDigitado={valorDigitado}
                setValorDigitado={setValorDigitado}
                valorConfere={valorConfere}
                enviando={enviando}
                cancelar={() => setConfirmandoId(null)}
                confirmar={() => void pagarPix()}
              />
            )}
            {c.origem && <LinhaOrigem o={c.origem} />}
            </li>
          );
        })}
      </ul>

      {podeBaixar && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3">
          <label className="text-xs text-slate-600">
            Pago em{' '}
            <input
              type="date"
              value={dataPgto}
              max={hoje}
              onChange={(e) => setDataPgto(e.target.value)}
              className="ml-1 rounded-md border border-slate-300 px-2 py-1 font-mono text-xs"
            />
          </label>
          <button
            type="button"
            disabled={pending || marcadas.size === 0}
            onClick={() => void baixar()}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:bg-slate-400"
          >
            {pending ? 'Baixando…' : `✓ Paguei no Inter: dar baixa (${brl(totalMarcado)})`}
          </button>
        </div>
      )}
      {mostraPagarPix && !podeBotaoPix && (
        <div className="border-t border-slate-100 bg-violet-50/50 px-4 py-2 text-xs text-slate-500">
          💸 Pagar Pix pelo sistema:{' '}
          {!temInterPix ? 'esta casa ainda não tem a integração de pagamentos do Inter.' : 'cadastre a chave Pix primeiro.'}
        </div>
      )}
      {msg && (
        <div
          className={`px-4 pb-3 text-xs ${msg.tipo === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}
        >
          {msg.texto}
        </div>
      )}
    </div>
  );
}

function PainelConfirmar({
  filialId,
  recebe,
  chave,
  conferencia,
  conta,
  valorDigitado,
  setValorDigitado,
  valorConfere,
  enviando,
  cancelar,
  confirmar,
}: {
  filialId?: string;
  recebe: string;
  chave: string;
  conferencia: ConferenciaPix | null;
  conta: PedidoPix;
  valorDigitado: string;
  setValorDigitado: (v: string) => void;
  valorConfere: boolean;
  enviando: boolean;
  cancelar: () => void;
  confirmar: () => void;
}) {
  const { saldo, erro: erroSaldo, carregando: lendoSaldo, ler: lerSaldo } = useSaldoPix(filialId);
  const faltaCentavos = saldo ? Math.round(conta.saldo * 100) - Math.round(saldo.livre * 100) : 0;
  const semSaldo = !!saldo && faltaCentavos > 0;
  const chaveDiverge = conferencia?.nivel === 'diverge';
  return (
    <div className="mx-4 mb-3 space-y-2 rounded-md border border-violet-200 bg-violet-50/60 p-3 text-sm">
      <div className="font-semibold text-violet-900">Confira antes de mandar o Pix desta conta pelo Inter:</div>
      <div className="grid gap-2 rounded-md border border-violet-200 bg-white p-3 text-xs sm:grid-cols-4">
        <div>
          <div className="text-slate-500">Recebe</div>
          <div className="font-medium text-slate-900">{recebe}</div>
        </div>
        <div className="min-w-0">
          <div className="text-slate-500">Chave Pix</div>
          <div className="break-all font-mono text-slate-900">{chave}</div>
        </div>
        <div className="min-w-0">
          <div className="text-slate-500">Conta</div>
          <div className="truncate text-slate-900" title={conta.descricao}>
            {conta.descricao} · venc {dataBr(conta.venc)}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Valor</div>
          <div className="text-base font-bold text-slate-900">{brl(conta.saldo)}</div>
        </div>
      </div>
      {conferencia && (
        <div
          className={`rounded-md border px-3 py-2 text-xs ${
            conferencia.nivel === 'ok'
              ? 'border-emerald-200 bg-emerald-50'
              : conferencia.nivel === 'diverge'
                ? 'border-rose-300 bg-rose-50'
                : 'border-amber-200 bg-amber-50'
          }`}
        >
          <ConferenciaPixLinha c={conferencia} />
          {chaveDiverge && (
            <span className="mt-1 block text-[11px] text-rose-800">
              O Pix não vai sair pra esta chave. Corrija a chave no cadastro, ou preencha &quot;quem recebe&quot; se
              o Pix cai mesmo nessa pessoa.
            </span>
          )}
          {(conferencia.nivel === 'nao_conferivel' || conferencia.nivel === 'terceiro') && (
            <span className="mt-1 block text-[11px] text-amber-800">
              Depois do envio, o sistema confere o CPF/CNPJ de quem recebeu (o Inter devolve) e avisa em
              &quot;Pix enviados&quot; se não for o fornecedor.
            </span>
          )}
        </div>
      )}
      <div
        className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-xs ${
          semSaldo ? 'border-rose-300 bg-rose-50 text-rose-800' : 'border-violet-200 bg-white text-slate-700'
        }`}
      >
        {saldo ? (
          <>
            <span>
              🏦 Saldo no Inter agora: <b>{brl(saldo.disponivel)}</b>
            </span>
            {saldo.qtdComprometidos > 0 && (
              <span className="text-amber-800">
                − {brl(saldo.comprometido)} em {saldo.qtdComprometidos} Pix do sistema sem desfecho → livre{' '}
                <b>{brl(saldo.livre)}</b>
              </span>
            )}
            {semSaldo ? (
              <b>Sem saldo pra este Pix: falta {brl(faltaCentavos / 100)}. O Pix não vai sair.</b>
            ) : (
              <span className="text-emerald-700">✓ tem saldo pra este Pix</span>
            )}
          </>
        ) : erroSaldo ? (
          <span className="text-amber-800">
            Não deu pra ler o saldo agora ({erroSaldo}). Ao confirmar, o sistema confere de novo e só manda se tiver
            saldo.
          </span>
        ) : (
          <span className="text-slate-500">🏦 conferindo o saldo no Inter…</span>
        )}
        <button
          type="button"
          disabled={lendoSaldo || enviando}
          onClick={() => void lerSaldo()}
          className="ml-auto rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 disabled:opacity-50"
        >
          {lendoSaldo ? 'lendo…' : '↻ saldo'}
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <label className="text-xs text-slate-600">
          Digite o valor pra confirmar{' '}
          <input
            type="text"
            inputMode="decimal"
            autoFocus
            value={valorDigitado}
            onChange={(e) => setValorDigitado(e.target.value)}
            placeholder={valorParaCopiar(conta.saldo)}
            className={`ml-1 w-28 rounded-md border px-2 py-1 text-right font-mono text-xs ${
              valorDigitado && !valorConfere ? 'border-rose-400' : 'border-slate-300'
            }`}
          />
        </label>
        <button
          type="button"
          disabled={enviando}
          onClick={cancelar}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={!valorConfere || enviando || semSaldo || chaveDiverge}
          onClick={confirmar}
          className="rounded-md bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white disabled:bg-slate-400"
        >
          {enviando ? 'Mandando Pix…' : `Confirmar e mandar ${brl(conta.saldo)}`}
        </button>
      </div>
      <p className="text-[11px] text-slate-500">
        Um Pix só desta conta, com a descrição dela. O dinheiro sai da conta do Inter desta casa. Se o Inter pedir
        aprovação no app, o Pix fica esperando e a baixa sai depois, no &quot;Conferir no Inter&quot;. Antes de
        mandar, o sistema confere o saldo da conta no Inter: se faltar, ou se o Inter não responder o saldo, o Pix
        não sai.
      </p>
    </div>
  );
}
