'use client';

// Card de um fornecedor na tela de pedidos a pagar por Pix: chave e valor pra
// copiar, cadastro da chave que falta (mesmo editor do cadastro de
// fornecedores, que replica pras outras casas) e a baixa das contas marcadas
// depois que o dono pagou no Inter. A baixa usa a rota de sempre da conta.
// Desde 20/10/2026 também "Pagar Pix agora": manda o Pix pela API do Inter
// (só Admin) e, se o banco processar, dá a baixa sozinho. O caminho antigo
// (copiar, pagar no app, "Paguei no Inter") continua igual.

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EditPix } from '@/app/cadastros/fornecedores/edit-pix';

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
  };
}

const quemCurto = (s: string) => (s.includes('@') ? s.split('@')[0]! : s);

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
  const chave = grupo.chavePix?.trim() || null;
  const travadas = useMemo(() => new Set(contasTravadas), [contasTravadas]);
  const marcadaTravada = grupo.contas.some((c) => marcadas.has(c.id) && travadas.has(c.id));
  const [confirmando, setConfirmando] = useState(false);
  const [valorDigitado, setValorDigitado] = useState('');
  const [enviando, setEnviando] = useState(false);
  const totalCentavos = Math.round(totalMarcado * 100);
  const digitadoCentavos = (() => {
    const t = valorDigitado.replace(/[^\d,.]/g, '');
    if (!t) return null;
    const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  })();
  const valorConfere = digitadoCentavos !== null && digitadoCentavos === totalCentavos;
  const mostraPagarPix = podePagarPix && !!filialId && !!grupo.fornecedorId;

  async function pagarPix() {
    if (!filialId || !grupo.fornecedorId || !valorConfere) return;
    const contas = grupo.contas.filter((c) => marcadas.has(c.id));
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
    setConfirmando(false);
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
            </div>
          ) : (
            <div className="mt-2 text-xs font-medium text-amber-700">Sem chave Pix cadastrada</div>
          )}
          {grupo.pixFavorecido && (
            <div className="mt-1 text-xs text-slate-600">Recebe em nome de {grupo.pixFavorecido}</div>
          )}
          {grupo.fornecedorId && podeEditarFornecedor && (
            <EditPix
              fornecedorId={grupo.fornecedorId}
              chaveAtual={grupo.chavePix}
              favorecidoAtual={grupo.pixFavorecido}
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
                  Pix em andamento
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
            </div>
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
      {mostraPagarPix && (
        <div className="border-t border-slate-100 bg-violet-50/50 px-4 py-3">
          {!temInterPix ? (
            <p className="text-xs text-slate-500">
              💸 Pagar Pix pelo sistema: esta casa ainda não tem a integração de pagamentos do Inter.
            </p>
          ) : !chave ? (
            <p className="text-xs text-slate-500">💸 Pagar Pix pelo sistema: cadastre a chave Pix primeiro.</p>
          ) : marcadaTravada ? (
            <p className="text-xs text-violet-800">
              Uma conta marcada já está num Pix enviado pelo sistema. Confira na lista &quot;Pix enviados pelo
              sistema&quot; antes de pagar de novo.
            </p>
          ) : !confirmando ? (
            <div className="flex justify-end">
              <button
                type="button"
                disabled={totalMarcado <= 0 || pending || enviando}
                onClick={() => {
                  setConfirmando(true);
                  setValorDigitado('');
                  setMsg(null);
                }}
                className="rounded-md bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white disabled:bg-slate-400"
              >
                💸 Pagar Pix agora ({brl(totalMarcado)})
              </button>
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              <div className="font-semibold text-violet-900">Confira antes de mandar o Pix pelo Inter:</div>
              <div className="grid gap-1 rounded-md border border-violet-200 bg-white p-3 text-xs sm:grid-cols-3">
                <div>
                  <div className="text-slate-500">Recebe</div>
                  <div className="font-medium text-slate-900">{grupo.pixFavorecido || grupo.nome}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-slate-500">Chave Pix</div>
                  <div className="break-all font-mono text-slate-900">{chave}</div>
                </div>
                <div>
                  <div className="text-slate-500">Valor ({grupo.contas.filter((c) => marcadas.has(c.id)).length} conta(s))</div>
                  <div className="text-base font-bold text-slate-900">{brl(totalMarcado)}</div>
                </div>
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
                    placeholder={valorParaCopiar(totalMarcado)}
                    className={`ml-1 w-28 rounded-md border px-2 py-1 text-right font-mono text-xs ${
                      valorDigitado && !valorConfere ? 'border-rose-400' : 'border-slate-300'
                    }`}
                  />
                </label>
                <button
                  type="button"
                  disabled={enviando}
                  onClick={() => setConfirmando(false)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!valorConfere || enviando}
                  onClick={() => void pagarPix()}
                  className="rounded-md bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white disabled:bg-slate-400"
                >
                  {enviando ? 'Mandando Pix…' : `Confirmar e mandar ${brl(totalMarcado)}`}
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                O dinheiro sai da conta do Inter desta casa. Se o Inter pedir aprovação no app, o Pix fica esperando
                e a baixa sai depois, no &quot;Conferir no Inter&quot;.
              </p>
            </div>
          )}
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
