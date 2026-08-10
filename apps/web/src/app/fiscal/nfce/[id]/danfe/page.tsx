// 2ª via do DANFE NFC-e — página imprimível do painel (administração).
// O caixa da loja imprime só na emissão; reimpressão é AQUI, sem prazo.
// Renderiza os mesmos blocos do cupom (48 col) + QR em SVG, formatado 80mm.

import { notFound } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { exigirPermPage } from '@/lib/exigir-perm';
import { dadosDanfeDaNota } from '@/lib/nfce/emitir';
import { montarDanfeBlocos } from '@/lib/nfce/danfe';
import QRCode from 'qrcode-svg';
import { BotaoImprimir } from './imprimir';

export const dynamic = 'force-dynamic';

export default async function DanfePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await exigirPermPage('nfce.read');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [nota] = await db
    .select()
    .from(schema.nfceEmitida)
    .where(eq(schema.nfceEmitida.id, id))
    .limit(1);
  if (!nota) notFound();

  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, nota.filialId),
      ),
    )
    .limit(1);
  if (!acesso) notFound();

  // DANFE cancelado não se reimprime — documento sem valor não circula.
  if (nota.status !== 'AUTORIZADA') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-lg font-semibold text-slate-900">Sem 2ª via</p>
          <p className="mt-2 max-w-sm text-sm text-slate-600">
            Esta NFC-e está <b>{nota.status}</b> — DANFE cancelado/não autorizado não é
            reimpresso. O XML continua disponível no painel pro contador.
          </p>
          <a href="/fiscal/nfce" className="mt-4 inline-block text-sm text-slate-700 underline">
            ◂ voltar ao painel
          </a>
        </div>
      </main>
    );
  }

  const [fil] = await db
    .select({ cnpj: schema.filial.cnpj, cfg: schema.filial.fiscalConfig })
    .from(schema.filial)
    .where(eq(schema.filial.id, nota.filialId))
    .limit(1);
  if (!fil?.cfg?.endereco) notFound();

  const blocos = montarDanfeBlocos(dadosDanfeDaNota(nota, fil.cfg, fil.cnpj), 48);

  return (
    <main className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto w-fit">
        <div className="no-print mb-4 flex items-center gap-3">
          <BotaoImprimir />
          <a href="/fiscal/nfce" className="text-sm text-slate-600 underline">
            ◂ voltar ao painel
          </a>
        </div>
        <div className="cupom bg-white px-4 py-5 shadow print:shadow-none">
          {blocos.map((b, i) => {
            if (b.qr) {
              const svg = new QRCode({
                content: b.qr,
                padding: 0,
                width: 170,
                height: 170,
                ecl: 'M',
                join: true,
              }).svg();
              return (
                <div
                  key={i}
                  className="my-2 flex justify-center"
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              );
            }
            const grande = (b.tamanho ?? 16) >= 21;
            return (
              <pre
                key={i}
                style={{
                  fontFamily: '"Courier New", ui-monospace, monospace',
                  fontSize: grande ? 14 : 10.5,
                  lineHeight: 1.35,
                  fontWeight: b.negrito ? 700 : 400,
                  textAlign: 'center',
                  whiteSpace: 'pre',
                  margin: 0,
                }}
              >
                {b.texto}
              </pre>
            );
          })}
        </div>
      </div>
      <style>{`
        .cupom { width: 88mm; }
        @media print {
          .no-print { display: none !important; }
          @page { size: 88mm auto; margin: 2mm; }
          body { background: #fff; }
        }
      `}</style>
    </main>
  );
}
