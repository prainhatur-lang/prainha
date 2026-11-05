// Troca de folga feita NO TABLET do ponto (05/11/2026: Claudia trocou a folga
// com Edjane e a trava barrou a entrada). A loja manda as trocas que mudaram
// (criada, confirmada ou recusada pelo colega). Aqui grava em rh_troca_folga e,
// quando o colega CONFIRMA, muda a escala do mês dos dois (rh_escala_dia):
//   quem pediu  → trabalha em dia_trabalha, folga em dia_devolve
//   o colega    → folga em dia_trabalha, trabalha em dia_devolve
// Não pede aprovação do gerente (decisão do dono): ele só vê a lista no
// /rh/escala-mensal. Idempotente por (filial_id, id_local).
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

const Dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Troca = z.object({
  id: z.coerce.number().int().positive(),
  solicitante_id: z.string().uuid(),
  colega_id: z.string().uuid(),
  dia_trabalha: Dia,
  dia_devolve: Dia,
  status: z.enum(['aguardando', 'confirmada', 'recusada']),
  criada_em: z.string().min(10),
  respondida_em: z.string().min(10).nullable().optional(),
});
const Body = z.object({
  f: z.string(),
  e: z.coerce.number(),
  s: z.string(),
  trocas: z.array(Troca).min(1).max(100),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, erro: 'corpo inválido' }, { status: 400 });
  const { f, e, s, trocas } = parsed.data;
  if (!autoriza(f, e, s)) return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });

  const { db, schema } = await import('@concilia/db');
  const { and, eq, isNull, sql } = await import('drizzle-orm');

  const ok: number[] = [];
  for (const t of trocas) {
    try {
      const [linha] = await db
        .insert(schema.rhTrocaFolga)
        .values({
          filialId: f,
          idLocal: t.id,
          solicitanteId: t.solicitante_id,
          colegaId: t.colega_id,
          diaTrabalha: t.dia_trabalha,
          diaDevolve: t.dia_devolve,
          status: t.status,
          criadaEm: new Date(t.criada_em),
          respondidaEm: t.respondida_em ? new Date(t.respondida_em) : null,
        })
        .onConflictDoUpdate({
          target: [schema.rhTrocaFolga.filialId, schema.rhTrocaFolga.idLocal],
          // resposta do colega é uma só: depois de confirmada/recusada não volta
          set: {
            status: sql`CASE WHEN ${schema.rhTrocaFolga.status} = 'aguardando' THEN excluded.status ELSE ${schema.rhTrocaFolga.status} END`,
            respondidaEm: sql`COALESCE(${schema.rhTrocaFolga.respondidaEm}, excluded.respondida_em)`,
          },
        })
        .returning();

      if (linha && linha.status === 'confirmada' && !linha.escalaAplicadaEm) {
        const dias: { funcionarioId: string; dia: string; folga: boolean }[] = [
          { funcionarioId: linha.solicitanteId, dia: String(linha.diaTrabalha), folga: false },
          { funcionarioId: linha.solicitanteId, dia: String(linha.diaDevolve), folga: true },
          { funcionarioId: linha.colegaId, dia: String(linha.diaTrabalha), folga: true },
          { funcionarioId: linha.colegaId, dia: String(linha.diaDevolve), folga: false },
        ];
        await db.transaction(async (tx) => {
          for (const d of dias) {
            await tx
              .insert(schema.rhEscalaDia)
              .values({ funcionarioId: d.funcionarioId, dia: d.dia, filialId: f, folga: d.folga, atualizadoPor: null })
              .onConflictDoUpdate({
                target: [schema.rhEscalaDia.funcionarioId, schema.rhEscalaDia.dia],
                set: { folga: d.folga, filialId: f, atualizadoEm: new Date(), atualizadoPor: null },
              });
          }
          await tx
            .update(schema.rhTrocaFolga)
            .set({ escalaAplicadaEm: new Date() })
            .where(and(eq(schema.rhTrocaFolga.id, linha.id), isNull(schema.rhTrocaFolga.escalaAplicadaEm)));
        });
      }
      ok.push(t.id);
    } catch (err) {
      console.error('[ponto/troca]', t.id, err instanceof Error ? err.message : err);
    }
  }
  return NextResponse.json({ ok: true, ids: ok });
}
