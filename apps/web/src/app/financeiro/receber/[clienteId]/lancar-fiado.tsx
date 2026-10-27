'use client';

// Lançar fiado pela tela: crédito (cliente passou a dever) ou pagamento.
// O lançamento vai pra fila e a LOJA aplica no Consumer em até ~1 min — por
// isso o aviso de "aguardando". Sem isso o usuário acharia que não funcionou.
//
// CONDIÇÃO e FORMA (pedido do dono): a forma é o código real do PDV
// (FORMASPAGAMENTO) — a loja cria o PAGAMENTOS com ela e amarra no movimento,
// que é como o próprio Consumer registra pagamento de conta corrente. A
// condição (à vista / a prazo + vencimento) não existe no Firebird: vai no
// texto da observação e fica guardada aqui na nuvem.
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Pix recebido no extrato (resposta de /api/financeiro/fiado/pix-recebidos). */
interface PixRecebido {
  id: string;
  data: string;
  valor: number;
  pagador: string | null;
  usado: number;
  restante: number;
  parecido: number;
}

const brlTxt = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataTxt = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** Códigos reais do Consumer (forma_pagamento_consumer). A API valida. */
const FORMAS: Array<{ codigo: number; label: string }> = [
  { codigo: 1, label: 'Dinheiro' },
  { codigo: 18, label: 'Pix' },
  { codigo: 4, label: 'Cartão de débito' },
  { codigo: 3, label: 'Cartão de crédito' },
  { codigo: 19, label: 'Transferência / carteira digital' },
  { codigo: 17, label: 'Depósito bancário' },
  { codigo: 2, label: 'Cheque' },
];

/** Hoje + n dias em data local (nunca toISOString: vira o dia anterior no BRT). */
function emDias(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function LancarFiado({ clienteId, saldo }: { clienteId: string; saldo: number }) {
  const router = useRouter();
  const [tipo, setTipo] = useState<'credito' | 'pagamento'>('pagamento');
  const [valor, setValor] = useState('');
  const [forma, setForma] = useState('1');
  const [condicao, setCondicao] = useState<'avista' | 'prazo'>('avista');
  const [vencimento, setVencimento] = useState(emDias(30));
  const [obs, setObs] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  // Pix do extrato que pagou a baixa (opcional)
  const [pix, setPix] = useState<PixRecebido | null>(null);
  const [lista, setLista] = useState<PixRecebido[] | null>(null);
  const [abrirPix, setAbrirPix] = useState(false);
  const [carregandoPix, setCarregandoPix] = useState(false);
  const [erroPix, setErroPix] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  const num = Number(valor.replace(/\./g, '').replace(',', '.'));
  const valido =
    Number.isFinite(num) && num > 0 &&
    (tipo === 'credito' || !!forma) &&
    (condicao === 'avista' || !!vencimento) &&
    (!pix || num <= pix.restante + 0.005);

  async function carregarPix() {
    setAbrirPix(true);
    if (lista || carregandoPix) return;
    setCarregandoPix(true);
    setErroPix(null);
    try {
      const r = await fetch(`/api/financeiro/fiado/pix-recebidos?clienteId=${clienteId}`);
      const j = await r.json();
      if (!r.ok || !j.ok) setErroPix(j.erro || 'não deu pra carregar o extrato');
      else setLista(j.pix as PixRecebido[]);
    } catch {
      setErroPix('sem conexão');
    } finally {
      setCarregandoPix(false);
    }
  }

  function escolherPix(p: PixRecebido) {
    setPix(p);
    setAbrirPix(false);
    setForma('18');
    // sugere o menor entre o que sobra no Pix e o que o cliente deve
    const sugerido = saldo > 0.01 ? Math.min(p.restante, saldo) : p.restante;
    setValor(sugerido.toFixed(2).replace('.', ','));
  }

  const termo = busca.trim().toUpperCase();
  const termoNum = Number(busca.replace(/\./g, '').replace(',', '.'));
  const filtrados = (lista ?? []).filter((p) => {
    if (!termo) return true;
    if ((p.pagador ?? '').toUpperCase().includes(termo)) return true;
    return Number.isFinite(termoNum) && termoNum > 0 && Math.abs(p.valor - termoNum) < 1;
  });

  function trocarTipo(t: 'credito' | 'pagamento') {
    setTipo(t);
    // dívida nasce a prazo (tem data pra pagar); pagamento é à vista por natureza
    setCondicao(t === 'credito' ? 'prazo' : 'avista');
    if (t === 'credito') { setForma(''); setPix(null); setAbrirPix(false); }
    else if (!forma) setForma('1');
  }

  async function enviar() {
    if (!valido || enviando) return;
    setEnviando(true);
    setMsg(null);
    try {
      const r = await fetch('/api/financeiro/fiado/lancar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clienteId,
          tipo,
          valor: num,
          observacao: obs.trim() || undefined,
          formaCodigo: forma ? Number(forma) : undefined,
          condicao,
          vencimento: condicao === 'prazo' ? vencimento : undefined,
          lancamentoBancoId: tipo === 'pagamento' && pix ? pix.id : undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setMsg({ ok: false, texto: j.erro || 'não deu pra lançar' });
      } else {
        setMsg({ ok: true, texto: 'Lançado. A loja aplica em até 1 minuto — a página atualiza sozinha.' });
        setValor('');
        setObs('');
        setPix(null);
        setLista(null);
        setTimeout(() => router.refresh(), 3000);
      }
    } catch {
      setMsg({ ok: false, texto: 'sem conexão' });
    } finally {
      setEnviando(false);
    }
  }

  const rotulo = 'block text-[11px] font-medium uppercase tracking-wide text-slate-500';
  const campo = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Lançar na conta corrente</h2>
      <p className="mt-1 text-xs text-slate-500">
        Crédito faz o cliente dever mais; pagamento abate.{' '}
        {saldo > 0.01 && <>Hoje ele deve <b>{saldo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</b>.</>}
        {saldo < -0.01 && <>Hoje ele tem <b>crédito de {(-saldo).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</b> (não deve nada).</>}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => trocarTipo('pagamento')}
          className={`rounded-lg border px-4 py-2 text-sm font-medium ${
            tipo === 'pagamento' ? 'border-blue-700 bg-blue-50 text-blue-800' : 'border-slate-200 text-slate-600'
          }`}
        >
          Pagamento (abate)
        </button>
        <button
          type="button"
          onClick={() => trocarTipo('credito')}
          className={`rounded-lg border px-4 py-2 text-sm font-medium ${
            tipo === 'credito' ? 'border-rose-500 bg-rose-50 text-rose-800' : 'border-slate-200 text-slate-600'
          }`}
        >
          Crédito (dívida)
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className={rotulo} htmlFor="fiado-valor">Valor</label>
          <input
            id="fiado-valor"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            inputMode="decimal"
            placeholder="0,00"
            className={campo}
          />
        </div>

        <div>
          <label className={rotulo} htmlFor="fiado-condicao">Condição</label>
          <select
            id="fiado-condicao"
            value={condicao}
            onChange={(e) => setCondicao(e.target.value as 'avista' | 'prazo')}
            className={campo}
          >
            <option value="avista">À vista</option>
            <option value="prazo">A prazo</option>
          </select>
        </div>

        <div>
          <label className={rotulo} htmlFor="fiado-forma">
            Forma de pagamento {tipo === 'credito' && <span className="normal-case text-slate-400">(opcional)</span>}
          </label>
          <select
            id="fiado-forma"
            value={forma}
            onChange={(e) => setForma(e.target.value)}
            className={campo}
          >
            {tipo === 'credito' && <option value="">— não se aplica</option>}
            {FORMAS.map((f) => (
              <option key={f.codigo} value={String(f.codigo)}>{f.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={rotulo} htmlFor="fiado-venc">
            {condicao === 'prazo' ? 'Vencimento' : 'Vencimento (só a prazo)'}
          </label>
          <input
            id="fiado-venc"
            type="date"
            value={vencimento}
            disabled={condicao !== 'prazo'}
            onChange={(e) => setVencimento(e.target.value)}
            className={`${campo} disabled:bg-slate-50 disabled:text-slate-400`}
          />
        </div>
      </div>

      {tipo === 'pagamento' && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={rotulo}>Pix recebido (extrato do banco)</span>
            <span className="text-[11px] text-slate-400">opcional · amarra a baixa ao Pix que pagou</span>
          </div>
          {pix ? (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <span className="rounded-md border border-blue-300 bg-white px-3 py-1.5 text-blue-900">
                🔗 {dataTxt(pix.data)} · <b>{brlTxt(pix.valor)}</b> · {pix.pagador ?? 'pagador não identificado'}
                {pix.usado > 0.009 && <span className="text-slate-500"> · sobra {brlTxt(pix.restante)}</span>}
              </span>
              <button type="button" onClick={carregarPix} className="text-xs text-slate-600 underline">trocar</button>
              <button type="button" onClick={() => setPix(null)} className="text-xs text-rose-700 underline">tirar</button>
              {num > pix.restante + 0.005 && (
                <span className="text-xs font-medium text-rose-700">valor maior que o que sobra no Pix ({brlTxt(pix.restante)})</span>
              )}
            </div>
          ) : (
            !abrirPix && (
              <button
                type="button"
                onClick={carregarPix}
                className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-slate-400"
              >
                Escolher o Pix recebido…
              </button>
            )
          )}

          {abrirPix && (
            <div className="mt-3">
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="buscar por nome de quem pagou ou valor"
                className={`${campo} mt-0 bg-white`}
              />
              {carregandoPix && <p className="mt-2 text-xs text-slate-500">carregando extrato…</p>}
              {erroPix && <p className="mt-2 text-xs text-rose-700">{erroPix}</p>}
              {lista && filtrados.length === 0 && (
                <p className="mt-2 text-xs text-slate-500">
                  Nenhum Pix recebido nos últimos 120 dias com esse filtro. Se o dinheiro caiu em outro banco
                  (fora do extrato do Inter), lance sem Pix e anote na observação.
                </p>
              )}
              {filtrados.length > 0 && (
                <ul className="mt-2 max-h-64 divide-y divide-slate-200 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                  {filtrados.slice(0, 60).map((p) => {
                    const esgotado = p.restante <= 0.009;
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          disabled={esgotado}
                          onClick={() => escolherPix(p)}
                          className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-sm hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
                        >
                          <span className="w-20 text-slate-500">{dataTxt(p.data)}</span>
                          <span className="w-28 font-semibold text-slate-900">{brlTxt(p.valor)}</span>
                          <span className="min-w-0 flex-1 truncate text-slate-700">{p.pagador ?? '—'}</span>
                          {p.parecido > 0 && (
                            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800">nome parecido</span>
                          )}
                          {esgotado ? (
                            <span className="text-[11px] text-slate-500">já usado em baixa</span>
                          ) : p.usado > 0.009 ? (
                            <span className="text-[11px] text-amber-700">sobra {brlTxt(p.restante)}</span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <button type="button" onClick={() => setAbrirPix(false)} className="mt-2 text-xs text-slate-500 underline">fechar</button>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <label className={rotulo} htmlFor="fiado-obs">Observação</label>
          <input
            id="fiado-obs"
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            placeholder={tipo === 'pagamento' ? 'ex.: pagou no escritório' : 'ex.: consumo do evento'}
            className={campo}
            maxLength={200}
          />
        </div>
        <button
          type="button"
          onClick={enviar}
          disabled={!valido || enviando}
          className="mt-1 self-end rounded-lg bg-slate-900 px-6 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {enviando ? 'enviando…' : 'Lançar'}
        </button>
      </div>

      {tipo === 'pagamento' && (
        <p className="mt-2 text-[11px] text-slate-400">
          Pagamento lançado aqui NÃO entra em caixa de loja — é recebimento do
          escritório. Dinheiro que o cliente entrega no balcão deve ser recebido
          pela tela do caixa.
        </p>
      )}

      {msg && (
        <p className={`mt-3 text-sm ${msg.ok ? 'text-blue-800' : 'text-rose-700'}`}>{msg.texto}</p>
      )}
    </div>
  );
}
