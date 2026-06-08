'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function AprovarButton({ cotacaoId }: { cotacaoId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function aprovar() {
    if (
      !confirm(
        'Confirmar aprovação? Vai gerar 1 pedido por fornecedor vencedor e ' +
          'ENVIAR cada pedido pro fornecedor no WhatsApp automaticamente.\n\n' +
          'Se algum fornecedor não atingir o valor mínimo de pedido, os itens dele ' +
          'são reassignados pro próximo colocado.',
      )
    )
      return;
    setErro(null);
    setInfo(null);
    try {
      const r = await fetch(`/api/cotacao/${cotacaoId}/aprovar`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      const partes: string[] = [];
      partes.push(`${(d.pedidos as unknown[]).length} pedido(s) gerado(s)`);
      if (d.envioConfigurado) {
        partes.push(`${d.enviados ?? 0} enviado(s) no WhatsApp`);
      } else {
        partes.push('envio automático desligado — enviar manualmente em Pedidos');
      }
      if (d.reassigned) partes.push(`${d.reassigned} item(s) reassignado(s) por valor mínimo`);
      setInfo(`✓ ${partes.join(' · ')}`);
      const falhas = (d.falhasEnvio ?? []) as Array<{ numero: number; error: string }>;
      if (falhas.length) {
        setErro(
          'Não enviados: ' +
            falhas.map((f) => `pedido #${f.numero} (${f.error})`).join('; ') +
            '. Reenvie em Pedidos.',
        );
      }
      start(() => router.refresh());
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={aprovar}
        disabled={pending}
        className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {pending ? 'Aprovando...' : 'Aprovar e gerar pedidos'}
      </button>
      {info && <span className="text-xs text-emerald-700">{info}</span>}
      {erro && <span className="text-xs text-rose-700">{erro}</span>}
    </div>
  );
}
