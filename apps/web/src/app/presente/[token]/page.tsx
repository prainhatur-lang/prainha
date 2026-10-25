// Página PÚBLICA do vale-presente (/presente/[token]) — sem login (rota
// liberada no proxy.ts). Aguardando: Pix. Pago: voucher QUITADO com código,
// que o casal mostra na casa.

import { notFound } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { PresenteClient } from './presente-client';

export const dynamic = 'force-dynamic';

export default async function PresentePage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  if (!token || token.length < 20) notFound();

  const [linha] = await db
    .select({ v: schema.valePresente, filialNome: schema.filial.nome })
    .from(schema.valePresente)
    .innerJoin(schema.filial, eq(schema.filial.id, schema.valePresente.filialId))
    .where(eq(schema.valePresente.token, token))
    .limit(1);
  if (!linha) notFound();
  const { v, filialNome } = linha;

  const dataUso = v.dataUso
    ? new Date(`${String(v.dataUso)}T12:00:00-03:00`).toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
      })
    : null;

  return (
    <main className="min-h-screen bg-amber-50 px-4 py-8">
      <PresenteClient
        token={token}
        tipo={v.tipo}
        casa={filialNome}
        codigo={v.codigo}
        compradorNome={v.compradorNome}
        presenteados={v.presenteados}
        mensagem={v.mensagem}
        dataUso={dataUso}
        pessoas={v.pessoas}
        itens={v.itens}
        subtotal={Number(v.subtotal)}
        servico={Number(v.servico)}
        total={Number(v.total)}
        statusInicial={v.status}
        usadoEm={v.usadoEm ? v.usadoEm.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null}
        pixInicial={{ qrCodeString: v.pagamentoQrcode, qrCodeImg: v.pagamentoQrcodeImg }}
      />
    </main>
  );
}
