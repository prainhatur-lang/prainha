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

  const num = Number(valor.replace(/\./g, '').replace(',', '.'));
  const valido =
    Number.isFinite(num) && num > 0 &&
    (tipo === 'credito' || !!forma) &&
    (condicao === 'avista' || !!vencimento);

  function trocarTipo(t: 'credito' | 'pagamento') {
    setTipo(t);
    // dívida nasce a prazo (tem data pra pagar); pagamento é à vista por natureza
    setCondicao(t === 'credito' ? 'prazo' : 'avista');
    if (t === 'credito') setForma('');
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
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setMsg({ ok: false, texto: j.erro || 'não deu pra lançar' });
      } else {
        setMsg({ ok: true, texto: 'Lançado. A loja aplica em até 1 minuto — a página atualiza sozinha.' });
        setValor('');
        setObs('');
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
