'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Resp {
  ok?: boolean;
  error?: string;
  totalTentado?: number;
  manifestadas?: number;
  comErro?: number;
  erros?: { chave: string; motivo: string }[];
  xmlBaixados?: number;
  xmlAviso?: string;
}

/** Confirmação da Operação (210200) — pra nota resumo que passou dos 10 dias
 *  da ciência (a SEFAZ responde 596). Libera o XML completo, mas declara à
 *  SEFAZ que a mercadoria foi recebida: só pra nota que de fato chegou. */
export function ConfirmarOperacaoBtn({
  filialId,
  chaves,
  resumo,
  lote = false,
}: {
  filialId: string;
  chaves: string[];
  /** Texto curto do que vai ser confirmado (fornecedor/valor), entra no aviso. */
  resumo?: string;
  lote?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  async function confirmar() {
    if (chaves.length === 0) return;
    const alvo = lote ? `${chaves.length} nota(s)` : 'esta nota';
    if (
      !confirm(
        `Confirmar a operação de ${alvo}${resumo ? ` (${resumo})` : ''}?\n\n` +
          'Isso DECLARA À SEFAZ QUE A MERCADORIA FOI RECEBIDA e não dá pra desfazer. ' +
          'Só confirme nota que de fato chegou. Depois disso a SEFAZ libera o XML completo.',
      )
    )
      return;
    setLoading(true);
    setMsg(null);
    try {
      const r = await fetch('/api/notas/manifestar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, chaves: chaves.slice(0, 50), evento: 'confirmacao' }),
      });
      const d = (await r.json().catch(() => ({}))) as Resp;
      if (!r.ok || !d.ok) {
        setMsg({ tipo: 'erro', texto: d.error ?? `HTTP ${r.status}` });
        return;
      }
      if (!d.manifestadas) {
        setMsg({
          tipo: 'erro',
          texto: d.erros?.[0]?.motivo ?? (d.comErro ? 'recusada' : 'nenhuma nota pra confirmar'),
        });
        return;
      }
      let texto = `✓ ${d.manifestadas}/${d.totalTentado} confirmada(s).`;
      if (d.comErro) texto += ` ${d.comErro} recusada(s): ${d.erros?.[0]?.motivo ?? ''}`;
      if (d.xmlBaixados) texto += ` XML baixado: ${d.xmlBaixados}.`;
      else if (d.xmlAviso) texto += ` XML: ${d.xmlAviso}`;
      else texto += ' O XML vem na próxima consulta.';
      setMsg({ tipo: 'ok', texto });
      start(() => router.refresh());
    } catch (e) {
      setMsg({ tipo: 'erro', texto: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className={`inline-flex ${lote ? 'items-center gap-3' : 'flex-col items-start gap-0.5'}`}>
      <button
        type="button"
        onClick={confirmar}
        disabled={loading || pending || chaves.length === 0}
        className={
          lote
            ? 'rounded-md bg-orange-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-600 disabled:opacity-50'
            : 'rounded border border-orange-400 px-1.5 py-0.5 text-[10px] font-medium text-orange-800 hover:bg-orange-50 disabled:opacity-50'
        }
        title="Passou dos 10 dias da ciência: a Confirmação da Operação (até 180 dias) libera o XML. Declara que a mercadoria chegou."
      >
        {loading
          ? '...'
          : lote
            ? `Confirmar operação (${chaves.length})`
            : 'Confirmar operação'}
      </button>
      {msg && (
        <span
          className={`max-w-[260px] whitespace-normal break-words leading-tight ${
            lote ? 'text-[11px]' : 'text-[10px]'
          } ${msg.tipo === 'ok' ? 'text-emerald-700' : 'text-rose-600'}`}
        >
          {msg.texto}
        </span>
      )}
    </span>
  );
}
