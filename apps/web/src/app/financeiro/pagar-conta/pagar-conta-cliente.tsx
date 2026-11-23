'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { escolherCodigoPagavel, lerCodigoConta, type CodigoLido } from '@/lib/conta-consumo';

export type ContaAberta = { id: string; rotulo: string; valor: number; vencimento: string };
export type PagamentoLinha = {
  id: string;
  tipo: 'BOLETO' | 'PIX';
  favorecido: string | null;
  descricao: string | null;
  valor: number;
  dataPagamento: string | null;
  status: string;
  statusInter: string | null;
  erro: string | null;
  usuarioEmail: string | null;
  criadoEm: string | null;
  baixado: boolean;
  contaPagarId: string | null;
};

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dmy = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');

const COR_STATUS: Record<string, string> = {
  PAGO: 'bg-emerald-100 text-emerald-800',
  ERRO: 'bg-red-100 text-red-800',
  CANCELADO: 'bg-slate-200 text-slate-700',
  APROVACAO: 'bg-amber-100 text-amber-800',
  AGENDADO: 'bg-sky-100 text-sky-800',
  ENVIANDO: 'bg-amber-100 text-amber-800',
};
const NOME_STATUS: Record<string, string> = {
  PAGO: 'Pago',
  ERRO: 'Não pago',
  CANCELADO: 'Cancelado',
  APROVACAO: 'Esperando aprovação no Inter',
  AGENDADO: 'Agendado',
  ENVIANDO: 'Sem resposta — conferir',
};

export function PagarContaCliente(props: {
  filialId: string;
  podePagar: boolean;
  temInter: boolean;
  hoje: string;
  contas: ContaAberta[];
  pagamentos: PagamentoLinha[];
}) {
  const router = useRouter();
  const [texto, setTexto] = useState('');
  const [lendo, setLendo] = useState(false);
  const [avisoLeitura, setAvisoLeitura] = useState<string | null>(null);
  const [valorDigitado, setValorDigitado] = useState('');
  const [data, setData] = useState(props.hoje);
  const [contaId, setContaId] = useState('');
  const [descricao, setDescricao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [conferindo, setConferindo] = useState(false);

  const leitura = useMemo(() => (texto.trim() ? lerCodigoConta(texto) : null), [texto]);
  const dado: CodigoLido | null = leitura?.ok ? leitura.dado : null;
  const valorNum = Number(valorDigitado.replace(/\./g, '').replace(',', '.'));
  const valor = dado?.valor ?? (valorNum > 0 ? Math.round(valorNum * 100) / 100 : null);
  const vencida = dado?.tipo === 'BOLETO' && dado.vencimento && dado.vencimento < props.hoje;
  const contaSel = props.contas.find((c) => c.id === contaId) ?? null;
  // contas com o mesmo valor primeiro (é quase sempre a conta certa)
  const contasOrdenadas = useMemo(() => {
    if (!valor) return props.contas;
    return [...props.contas].sort(
      (a, b) => Number(Math.abs(b.valor - valor) < 0.01) - Number(Math.abs(a.valor - valor) < 0.01),
    );
  }, [props.contas, valor]);

  async function lerArquivo(f: File) {
    setLendo(true);
    setAvisoLeitura(null);
    setMsg(null);
    try {
      const { lerCodigosDoArquivo } = await import('./ler-codigo-conta');
      const achados = await lerCodigosDoArquivo(f);
      const r = escolherCodigoPagavel(achados);
      if (!r) {
        setAvisoLeitura(
          achados.length
            ? 'Li o arquivo, mas o código que achei não é de pagamento (talvez o QR da nota fiscal). Cole ou digite a linha digitável.'
            : 'Não achei QR nem código de barras no arquivo. Tente uma foto mais de perto e reta, ou digite a linha digitável.',
        );
        return;
      }
      if (!r.ok) {
        setAvisoLeitura(r.erro);
        return;
      }
      setTexto(r.dado.codigo);
    } catch (e) {
      setAvisoLeitura(`Não deu pra ler o arquivo: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLendo(false);
    }
  }

  async function pagar() {
    if (!dado || !valor) return;
    const quem = dado.tipo === 'PIX' ? (dado.favorecido ?? 'o favorecido do QR') : 'o boleto';
    const conf = window.confirm(
      `Pagar ${brl(valor)} pra ${quem}${dado.tipo === 'BOLETO' && data > props.hoje ? ` (agendado pra ${dmy(data)})` : ''} pela conta do Inter desta casa?${contaSel ? `\n\nBaixa na conta a pagar: ${contaSel.rotulo}` : '\n\n(Sem conta a pagar ligada — não dá baixa em nada.)'}`,
    );
    if (!conf) return;
    setEnviando(true);
    setMsg(null);
    try {
      const r = await fetch('/api/financeiro/conta-consumo/pagar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filialId: props.filialId,
          codigo: dado.codigo,
          valorConfirmado: valor,
          dataPagamento: dado.tipo === 'BOLETO' ? data : undefined,
          contaPagarId: contaId || null,
          descricao: descricao.trim() || undefined,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; mensagem?: string; error?: string };
      if (r.ok && j.ok) {
        setMsg({ ok: true, texto: j.mensagem ?? 'Enviado.' });
        setTexto('');
        setValorDigitado('');
        setContaId('');
        setDescricao('');
      } else {
        setMsg({ ok: false, texto: j.error ?? `Erro ${r.status}` });
      }
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, texto: `Sem resposta do servidor. PODE ter sido pago — confira a lista abaixo antes de tentar de novo. (${e instanceof Error ? e.message : e})` });
      router.refresh();
    } finally {
      setEnviando(false);
    }
  }

  async function conferir() {
    setConferindo(true);
    try {
      const r = await fetch('/api/financeiro/conta-consumo/conferir', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filialId: props.filialId }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string; conferidos?: number; pagos?: number; recusados?: number };
      setMsg(
        r.ok
          ? { ok: true, texto: `Conferido no Inter: ${j.conferidos ?? 0} consultado(s), ${j.pagos ?? 0} pago(s), ${j.recusados ?? 0} recusado(s).` }
          : { ok: false, texto: j.error ?? `Erro ${r.status}` },
      );
      router.refresh();
    } finally {
      setConferindo(false);
    }
  }

  async function resolver(id: string, acao: 'saiu' | 'nao_saiu') {
    const pergunta =
      acao === 'saiu'
        ? 'Você conferiu no app do Inter que esse pagamento SAIU? Vai marcar como pago e dar a baixa.'
        : 'Você conferiu no app do Inter que esse pagamento NÃO saiu? Vai liberar pra pagar de novo.';
    if (!window.confirm(pergunta)) return;
    const r = await fetch('/api/financeiro/conta-consumo/resolver', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, acao }),
    });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) setMsg({ ok: false, texto: j.error ?? `Erro ${r.status}` });
    router.refresh();
  }

  const abertos = props.pagamentos.some((p) => ['ENVIANDO', 'APROVACAO', 'AGENDADO'].includes(p.status));

  return (
    <div className="space-y-6">
      {!props.temInter && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Esta casa não tem a integração de pagamentos do Inter configurada — não dá pra pagar por aqui.
        </div>
      )}

      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Foto ou PDF da conta</label>
          <input
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            disabled={lendo}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void lerArquivo(f);
              e.target.value = '';
            }}
            className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
          />
          {lendo && <p className="mt-1 text-xs text-slate-500">Lendo o código…</p>}
          {avisoLeitura && <p className="mt-1 text-xs text-amber-700">{avisoLeitura}</p>}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Ou cole o código</label>
          <textarea
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              setMsg(null);
            }}
            rows={3}
            placeholder="Linha digitável (47 ou 48 números) ou Pix copia-e-cola (000201…)"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
          />
          {leitura && !leitura.ok && <p className="mt-1 text-xs text-red-700">{leitura.erro}</p>}
        </div>

        {dado && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="grid gap-1 sm:grid-cols-2">
              <div>
                <span className="text-slate-500">Tipo: </span>
                <b>
                  {dado.tipo === 'PIX'
                    ? `Pix${dado.dinamico ? ' (cobrança)' : ''}`
                    : dado.especie === 'CONVENIO'
                      ? 'Conta de consumo / convênio'
                      : 'Boleto bancário'}
                </b>
              </div>
              {dado.tipo === 'PIX' ? (
                <>
                  <div>
                    <span className="text-slate-500">Favorecido: </span>
                    <b>{dado.favorecido ?? '—'}</b>
                    {dado.cidade ? <span className="text-slate-500"> ({dado.cidade})</span> : null}
                  </div>
                  {dado.infoAdicional && (
                    <div className="sm:col-span-2">
                      <span className="text-slate-500">Info: </span>
                      {dado.infoAdicional}
                    </div>
                  )}
                </>
              ) : (
                <>
                  {dado.segmento && (
                    <div>
                      <span className="text-slate-500">Segmento: </span>
                      {dado.segmento}
                    </div>
                  )}
                  <div>
                    <span className="text-slate-500">Vencimento: </span>
                    <b className={vencida ? 'text-red-700' : ''}>{dmy(dado.vencimento)}</b>
                    {vencida && <span className="text-red-700"> — vencida</span>}
                  </div>
                </>
              )}
              <div>
                <span className="text-slate-500">Valor: </span>
                {dado.valor ? (
                  <b className="text-lg">{brl(dado.valor)}</b>
                ) : (
                  <input
                    value={valorDigitado}
                    onChange={(e) => setValorDigitado(e.target.value)}
                    placeholder="valor (o código não traz)"
                    inputMode="decimal"
                    className="w-40 rounded border border-slate-300 px-2 py-1"
                  />
                )}
              </div>
            </div>
            {vencida && (
              <p className="mt-2 text-xs text-red-700">
                Conta vencida: o banco pode recusar ou cobrar multa/juros. Se recusar, nada sai — aí use o Pix do QR
                (quando a conta tem) ou a 2ª via.
              </p>
            )}
            {dado.tipo === 'PIX' && (
              <p className="mt-2 text-xs text-slate-600">
                Confira o favorecido: o Pix vai pra chave que está no QR da conta.
              </p>
            )}
          </div>
        )}

        {dado && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">Dar baixa na conta a pagar (opcional)</label>
              <select
                value={contaId}
                onChange={(e) => setContaId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
              >
                <option value="">— nenhuma (só pagar) —</option>
                {contasOrdenadas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {valor && Math.abs(c.valor - valor) < 0.01 ? '★ ' : ''}
                    {c.rotulo} · {brl(c.valor)}
                  </option>
                ))}
              </select>
            </div>
            {dado.tipo === 'BOLETO' && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Data do pagamento</label>
                <input
                  type="date"
                  value={data}
                  min={props.hoje}
                  onChange={(e) => setData(e.target.value || props.hoje)}
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
                />
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Descrição (opcional)</label>
              <input
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                maxLength={140}
                placeholder="ex.: Energia out/2026"
                className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
              />
            </div>
          </div>
        )}

        {msg && (
          <div className={`rounded-lg p-3 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'}`}>{msg.texto}</div>
        )}

        {dado &&
          (props.podePagar ? (
            <button
              type="button"
              onClick={pagar}
              disabled={enviando || !valor || !props.temInter}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {enviando ? 'Pagando…' : `💸 Pagar ${valor ? brl(valor) : ''} pelo Inter`}
            </button>
          ) : (
            <p className="text-sm text-slate-500">Só o Admin paga por aqui.</p>
          ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="font-semibold text-slate-900">Pagas por esta tela</h2>
          {abertos && (
            <button
              type="button"
              onClick={conferir}
              disabled={conferindo}
              className="ml-auto rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {conferindo ? 'Conferindo…' : 'Conferir no Inter'}
            </button>
          )}
        </div>
        {props.pagamentos.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma ainda.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {props.pagamentos.map((p) => (
              <li key={p.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COR_STATUS[p.status] ?? 'bg-slate-100'}`}>
                    {NOME_STATUS[p.status] ?? p.status}
                  </span>
                  <b>{brl(p.valor)}</b>
                  <span className="text-slate-700">{p.descricao ?? p.favorecido ?? (p.tipo === 'PIX' ? 'Pix' : 'Boleto')}</span>
                  <span className="text-xs text-slate-500">
                    {p.tipo === 'PIX' ? 'Pix' : 'boleto'} · {dmy(p.dataPagamento)} · {p.usuarioEmail ?? ''}
                    {p.contaPagarId ? (p.baixado && p.status === 'PAGO' ? ' · baixa feita' : ' · com conta ligada') : ''}
                  </span>
                </div>
                {p.erro && <p className="mt-1 text-xs text-slate-500">{p.erro}</p>}
                {props.podePagar && p.status === 'ENVIANDO' && (
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      onClick={() => resolver(p.id, 'saiu')}
                      className="rounded border border-emerald-300 px-2 py-0.5 text-xs text-emerald-800 hover:bg-emerald-50"
                    >
                      Saiu no Inter
                    </button>
                    <button
                      type="button"
                      onClick={() => resolver(p.id, 'nao_saiu')}
                      className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-800 hover:bg-red-50"
                    >
                      Não saiu
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
