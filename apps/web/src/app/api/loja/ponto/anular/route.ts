// Anulação de batida feita NA LOJA — botão "Não sou eu" do ponto facial
// (27/09/2026: a Mayara foi cadastrar o rosto e o tablet bateu saída do
// Alexandre). A loja manda os id_local já subidos; aqui vira exclusão lógica
// (excluida_em, igual à correção do RH) e as horas do dia são recalculadas.
//
// Auth: mesma assinatura HMAC de /api/loja/ponto (escopo 'ponto').
import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function confere(partes: string[], sig: string): boolean {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return false;
  const esperada = createHmac('sha256', seg).update(partes.join('|')).digest('hex');
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(sig || ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function autoriza(f: string, e: number, s: string) {
  return /^[0-9a-f-]{36}$/i.test(f) && e * 1000 >= Date.now() && confere([f, 'ponto', String(e)], s);
}

const Body = z.object({
  f: z.string(),
  e: z.coerce.number(),
  s: z.string(),
  ids: z.array(z.coerce.number().int().positive()).min(1).max(200),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, erro: 'corpo inválido' }, { status: 400 });
  const { f, e, s, ids } = parsed.data;
  if (!autoriza(f, e, s)) return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });

  const { db, schema } = await import('@concilia/db');
  const { and, eq, inArray, isNull } = await import('drizzle-orm');
  const { projetarPontoEmFolhaHoras } = await import('@/lib/rh/projetar-horas');

  const anuladas = await db
    .update(schema.pontoBatida)
    .set({ excluidaEm: new Date() })
    .where(
      and(
        eq(schema.pontoBatida.filialId, f),
        inArray(schema.pontoBatida.idLocal, ids),
        isNull(schema.pontoBatida.excluidaEm),
      ),
    )
    .returning({ dia: schema.pontoBatida.diaOperacional });

  if (anuladas.length > 0) {
    const dias = anuladas.map((a) => a.dia);
    const diaMin = dias.reduce((m, d) => (d < m ? d : m));
    const diaMax = dias.reduce((m, d) => (d > m ? d : m));
    await projetarPontoEmFolhaHoras(f, diaMin, diaMax).catch((err) =>
      console.error('[loja/ponto/anular] projeção em folha_horas falhou:', err),
    );
  }

  return NextResponse.json({ ok: true, anuladas: anuladas.length });
}
