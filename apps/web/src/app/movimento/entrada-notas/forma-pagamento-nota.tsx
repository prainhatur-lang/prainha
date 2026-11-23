'use client';

// "Como se paga?" NA ENTRADA da nota/recibo (dono 23/11/2026): a forma de
// pagamento se decide quando a nota entra, não na hora de pagar.
//  - Nota ou recibo com boleto → 🧾 Boleto (não pede chave Pix; não sai Pix).
//  - Recibo no Pix → 💠 Pix e CONFIRMA a chave do cadastro do fornecedor
//    (Pix só na chave autorizada) e o WhatsApp de quem recebe, obrigatório,
//    pra onde vai o comprovante. Se o cadastro mudar depois, o Pix trava.
// As contas a pagar desta nota herdam a forma (a conta ainda pode trocar).

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EditPix, ConferenciaPixLinha } from '@/app/cadastros/fornecedores/edit-pix';
import { EditWhatsapp } from '@/app/cadastros/fornecedores/edit-whatsapp';
import { conferirChavePix } from '@/lib/pix-titular';

interface Estado {
  forma: 'boleto' | 'pix' | null;
  pixChaveConfirmada: string | null;
  fornecedor: { id: string; nome: string | null; chavePix: string | null; pixFavorecido: string | null; doc: string | null; foneWhatsapp: string | null } | null;
}

export function FormaPagamentoNota({ notaId, compacto = false }: { notaId: string; compacto?: boolean }) {
  const router = useRouter();
  const [est, setEst] = useState<Estado | null>(null);
  const [escolhendoPix, setEscolhendoPix] = useState(false);
  const [pending, setPending] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/nota-compra/${notaId}/forma-pagamento`, { cache: 'no-store' });
    if (r.ok) setEst((await r.json()) as Estado);
  }, [notaId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function salvar(forma: 'boleto' | 'pix' | null, chaveConfirmada?: string) {
    setPending(true);
    setErro(null);
    try {
      const r = await fetch(`/api/nota-compra/${notaId}/forma-pagamento`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ forma, chaveConfirmada }),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        setErro(d.error ?? `erro ${r.status}`);
        await carregar();
        return;
      }
      setEscolhendoPix(false);
      await carregar();
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  if (!est) return null;
  const chaveCad = est.fornecedor?.chavePix?.trim() || null;
  const chaveMudou = est.forma === 'pix' && !!est.pixChaveConfirmada && est.pixChaveConfirmada !== chaveCad;
  const mostrarPix = escolhendoPix || chaveMudou;
  const zapOk = (est.fornecedor?.foneWhatsapp ?? '').replace(/\D/g, '').length >= 10;
  const conf =
    chaveCad && est.fornecedor
      ? conferirChavePix({ chave: chaveCad, docFornecedor: est.fornecedor.doc, favorecido: est.fornecedor.pixFavorecido })
      : null;

  const btn = (ativo: boolean) =>
    `rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
      ativo ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
    }`;

  return (
    <div
      className={
        compacto
          ? 'mt-2 rounded-md border border-slate-200 bg-slate-50 p-2'
          : `mt-4 rounded-xl border p-3 ${est.forma ? 'border-slate-200 bg-white' : 'border-amber-300 bg-amber-50'}`
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-800">Como se paga?</span>
        <button type="button" disabled={pending} className={btn(est.forma === 'boleto')} onClick={() => salvar('boleto')}>
          🧾 Boleto
        </button>
        <button
          type="button"
          disabled={pending}
          className={btn(est.forma === 'pix' && !chaveMudou)}
          onClick={() => setEscolhendoPix(true)}
        >
          💠 Pix
        </button>
        {est.forma && (
          <button
            type="button"
            disabled={pending}
            className="text-[11px] text-slate-500 underline hover:text-slate-700"
            onClick={() => salvar(null)}
          >
            limpar
          </button>
        )}
        {!est.forma && (
          <span className="text-[11px] text-amber-800">informe na entrada: nota/recibo com boleto, ou Pix (confirmando a chave)</span>
        )}
        {est.forma === 'boleto' && (
          <span className="text-[11px] text-slate-600">paga pelo boleto — não pede chave Pix e não sai Pix por esta nota</span>
        )}
        {est.forma === 'pix' && !chaveMudou && est.pixChaveConfirmada && (
          <span className="text-[11px] text-emerald-700">
            ✓ Pix na chave <span className="font-mono">{est.pixChaveConfirmada}</span> (confirmada na entrada)
          </span>
        )}
      </div>

      {chaveMudou && (
        <p className="mt-1 text-[11px] font-semibold text-rose-700">
          A chave Pix do cadastro mudou depois da entrada (era {est.pixChaveConfirmada}). O Pix desta nota fica travado até
          confirmar de novo.
        </p>
      )}

      {mostrarPix && (
        <div className="mt-2 rounded-md border border-sky-200 bg-sky-50 p-2 text-xs text-slate-700">
          {!est.fornecedor ? (
            <p>Vincule o fornecedor da nota antes de marcar Pix.</p>
          ) : chaveCad ? (
            <>
              <p>
                Confirme a chave Pix que o fornecedor informou:{' '}
                <span className="font-mono font-semibold text-slate-900">{chaveCad}</span>
                {est.fornecedor.pixFavorecido && <> — recebe: {est.fornecedor.pixFavorecido}</>}
              </p>
              <ConferenciaPixLinha c={conf} />
              <div className={`mt-2 flex flex-wrap items-center gap-2 ${zapOk ? '' : 'rounded border border-amber-300 bg-amber-50 p-1.5'}`}>
                <span className={zapOk ? 'text-slate-700' : 'font-semibold text-amber-800'}>
                  WhatsApp de quem recebe (vai o comprovante){zapOk ? ':' : ' — obrigatório:'}
                </span>
                <EditWhatsapp fornecedorId={est.fornecedor.id} valorAtual={est.fornecedor.foneWhatsapp} />
                {!zapOk && (
                  <button type="button" className="text-[11px] text-sky-700 underline" onClick={() => void carregar()}>
                    ↻ já cadastrei
                  </button>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={pending || conf?.nivel === 'diverge' || !zapOk}
                  title={zapOk ? undefined : 'Cadastre o WhatsApp de quem recebe antes de confirmar'}
                  className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  onClick={() => salvar('pix', chaveCad)}
                >
                  ✓ Confirmo: pagar nesta chave
                </button>
                <span className="text-[11px] text-slate-500">chave errada? corrija no cadastro:</span>
                <EditPix
                  fornecedorId={est.fornecedor.id}
                  chaveAtual={est.fornecedor.chavePix}
                  favorecidoAtual={est.fornecedor.pixFavorecido}
                  docFornecedor={est.fornecedor.doc}
                />
                <button type="button" className="text-[11px] text-sky-700 underline" onClick={() => void carregar()}>
                  ↻ recarregar
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-amber-800">
                O fornecedor não tem chave Pix no cadastro. Cadastre a chave que ele informou (nunca o CPF por conta própria)
                e o WhatsApp de quem recebe (vai o comprovante) — os dois são obrigatórios — e depois confirme:
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <EditPix
                  fornecedorId={est.fornecedor.id}
                  chaveAtual={null}
                  favorecidoAtual={est.fornecedor.pixFavorecido}
                  docFornecedor={est.fornecedor.doc}
                />
                <EditWhatsapp fornecedorId={est.fornecedor.id} valorAtual={est.fornecedor.foneWhatsapp} />
                <button type="button" className="text-[11px] text-sky-700 underline" onClick={() => void carregar()}>
                  ↻ já cadastrei
                </button>
              </div>
            </>
          )}
          {!chaveMudou && (
            <button type="button" className="mt-1 text-[11px] text-slate-500 underline" onClick={() => setEscolhendoPix(false)}>
              cancelar
            </button>
          )}
        </div>
      )}
      {erro && <p className="mt-1 text-[11px] text-rose-700">{erro}</p>}
    </div>
  );
}
