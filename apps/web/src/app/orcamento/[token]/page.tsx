// Página PÚBLICA do orçamento de evento (/orcamento/[token]) — o cliente vê
// o documento, aceita o contrato e paga a entrada via Pix. Sem login: o
// token na URL identifica o orçamento (rota liberada no proxy.ts).

import { notFound } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { DocOrcamento } from '../../orcamentos/doc-orcamento';
import { AceiteClient } from './aceite-client';

export const dynamic = 'force-dynamic';

export default async function OrcamentoPublicoPage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  if (!token || token.length < 20) notFound();

  const [linha] = await db
    .select({
      o: schema.orcamentoEvento,
      filialNome: schema.filial.nome,
      filialCnpj: schema.filial.cnpj,
    })
    .from(schema.orcamentoEvento)
    .innerJoin(schema.filial, eq(schema.filial.id, schema.orcamentoEvento.filialId))
    .where(eq(schema.orcamentoEvento.aceiteToken, token))
    .limit(1);
  if (!linha) notFound();
  const { o, filialNome, filialCnpj } = linha;

  return (
    <main className="min-h-screen bg-slate-100 pb-10 print:bg-white">
      <div className="mx-auto max-w-4xl px-3">
        <DocOrcamento o={o} filialNome={filialNome} filialCnpj={filialCnpj} linkAceite={null} />
        <AceiteClient
          token={token}
          clienteNome={o.clienteNome}
          entradaValor={o.entradaValor == null ? null : Number(o.entradaValor)}
          aceiteNomeInicial={o.aceiteNome}
          aceiteEmInicial={o.aceiteEm ? o.aceiteEm.toISOString() : null}
          pagamentoInicial={{
            status: o.pagamentoStatus,
            qrCodeString: o.pagamentoQrcode,
            qrCodeImg: o.pagamentoQrcodeImg,
          }}
        />
        <p className="mt-6 text-center text-[11px] text-slate-400 print:hidden">
          {filialNome} · dúvidas? chama a gente no WhatsApp
        </p>
      </div>
    </main>
  );
}
