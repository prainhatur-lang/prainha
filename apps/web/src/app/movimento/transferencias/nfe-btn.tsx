'use client';

// Nota fiscal (NF-e) da transferência — opcional. A transferência vale
// sozinha (só financeiro); quem enviou emite a nota depois, se quiser.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Nota = { id: string; numero: number; serie: number; ambiente: number; chave: string };

async function pedirNfe(id: string, homologacao: boolean): Promise<{ nota?: Nota; erro?: string }> {
  try {
    const r = await fetch(`/api/transferencias/${id}/nfe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ homologacao }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { erro: j.error ?? 'Erro ao emitir a nota' };
    return { nota: j.nota as Nota };
  } catch (e) {
    return { erro: `Sem resposta do servidor: ${(e as Error).message}` };
  }
}

/** Botão pequeno da lista de transferências. */
export function EmitirNfeButton({ id, numero, rotulo }: { id: string; numero: number; rotulo?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function emitir() {
    if (!confirm(`Emitir a nota fiscal (NF-e) da transferência #${numero}? Ela vai pra SEFAZ agora.`)) return;
    setBusy(true);
    const r = await pedirNfe(id, false);
    setBusy(false);
    if (r.erro) {
      alert(r.erro);
      router.refresh();
      return;
    }
    router.push(`/movimento/transferencias/${id}/nfe`);
  }
  return (
    <button
      onClick={emitir}
      disabled={busy}
      className="rounded border border-indigo-200 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
    >
      {busy ? 'Emitindo…' : (rotulo ?? '🧾 Emitir NF-e')}
    </button>
  );
}

/** Pergunta logo depois de registrar a transferência: quer a nota fiscal? */
export function PerguntaNfe({ id, numero, urlLista }: { id: string; numero: number; urlLista: string }) {
  const [busy, setBusy] = useState<'prod' | 'hom' | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [nota, setNota] = useState<Nota | null>(null);

  async function emitir(homologacao: boolean) {
    setErro(null);
    setBusy(homologacao ? 'hom' : 'prod');
    const r = await pedirNfe(id, homologacao);
    setBusy(null);
    if (r.erro) return setErro(r.erro);
    setNota(r.nota ?? null);
  }

  if (nota) {
    return (
      <div className="rounded-lg border border-indigo-200 bg-white p-4">
        <p className="text-sm font-semibold text-indigo-900">
          ✓ NF-e nº {nota.numero} (série {nota.serie}) autorizada
          {nota.ambiente !== 1 ? ' — em HOMOLOGAÇÃO (teste, sem valor fiscal)' : ''}
        </p>
        <p className="mt-1 break-all font-mono text-[11px] text-slate-500">{nota.chave}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={`/movimento/transferencias/${id}/nfe`}
            className="rounded-md bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800"
          >
            🖨 Abrir DANFE pra imprimir
          </a>
          <a
            href={urlLista}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Ver transferências
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-indigo-200 bg-white p-4">
      <p className="text-sm font-semibold text-slate-900">Quer emitir a nota fiscal dessa transferência?</p>
      <p className="mt-1 text-xs text-slate-600">
        A transferência #{numero} já vale sozinha (só financeiro, sem valor fiscal). A NF-e de transferência é
        opcional — dá pra emitir agora ou depois, pela lista de transferências.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => emitir(false)}
          disabled={busy !== null}
          className="rounded-md bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
        >
          {busy === 'prod' ? 'Emitindo na SEFAZ…' : '🧾 Sim, emitir NF-e'}
        </button>
        <a
          href={urlLista}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          Não, só a transferência
        </a>
        <button
          onClick={() => emitir(true)}
          disabled={busy !== null}
          className="text-xs text-slate-500 underline hover:text-slate-700 disabled:opacity-50"
        >
          {busy === 'hom' ? 'testando…' : 'testar em homologação (sem valor fiscal)'}
        </button>
      </div>
      {erro && <p className="mt-2 rounded bg-rose-50 px-3 py-2 text-xs text-rose-800">{erro}</p>}
    </div>
  );
}

/** Ações da página do DANFE: imprimir, baixar XML, cancelar a nota. */
export function AcoesNfe({
  transferenciaId,
  nfeId,
  podeCancelar,
}: {
  transferenciaId: string;
  nfeId: string;
  podeCancelar: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function cancelar() {
    const justificativa = prompt('Motivo do cancelamento da nota fiscal (mínimo 15 letras):');
    if (justificativa == null) return;
    if (justificativa.trim().length < 15) return alert('O motivo precisa ter pelo menos 15 letras.');
    setBusy(true);
    const r = await fetch(`/api/transferencias/${transferenciaId}/nfe/cancelar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nfeId, justificativa: justificativa.trim() }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return alert(j.error ?? 'Erro ao cancelar a nota');
    router.refresh();
  }
  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <button
        onClick={() => window.print()}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
      >
        🖨 Imprimir DANFE
      </button>
      <a
        href={`/api/transferencias/${transferenciaId}/nfe/xml?nfeId=${nfeId}`}
        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
      >
        ⬇ XML
      </a>
      {podeCancelar && (
        <button
          onClick={cancelar}
          disabled={busy}
          className="rounded-md border border-rose-200 bg-white px-4 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
        >
          {busy ? 'Cancelando…' : 'Cancelar NF-e'}
        </button>
      )}
    </div>
  );
}
