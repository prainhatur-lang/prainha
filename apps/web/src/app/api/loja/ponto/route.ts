// PONTO PRÓPRIO — loja ↔ nuvem. GET entrega o roster ativo da filial (a loja
// espelha em ponto_funcionario, funciona sem internet); POST recebe o lote
// de batidas (ponto_batida É a fila do lado da loja, cursor por id).
//
// Idempotente: (filial_id, id_local) — reenviar o mesmo lote não duplica.
// Auth: mesma assinatura HMAC dos outros endpoints /api/loja/* (escopo 'ponto').
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

/** GET ?f&e&s — roster ativo da filial. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const f = url.searchParams.get('f') ?? '';
  const e = Number(url.searchParams.get('e'));
  const s = url.searchParams.get('s') ?? '';
  if (!autoriza(f, e, s)) return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });

  const { db, schema } = await import('@concilia/db');
  const { and, eq } = await import('drizzle-orm');

  const pessoas = await db
    .select({
      funcionarioId: schema.funcionario.id,
      nome: schema.funcionario.nome,
      cpf: schema.funcionario.cpf,
      setor: schema.funcionario.setor,
      cargo: schema.funcionario.cargo,
      loginLocal: schema.funcionario.loginLocal,
      faceDescriptor: schema.funcionario.faceDescriptor,
    })
    .from(schema.funcionario)
    .where(and(eq(schema.funcionario.filialId, f), eq(schema.funcionario.ativo, true)));

  return NextResponse.json({
    ok: true,
    pessoas: pessoas.map((p) => ({
      funcionario_id: p.funcionarioId,
      face_descriptor: p.faceDescriptor,
      nome: p.nome,
      cpf: p.cpf,
      setor: p.setor,
      cargo: p.cargo,
      login_local: p.loginLocal,
    })),
  });
}

const Batida = z.object({
  id: z.coerce.number().int().positive(),
  funcionario_id: z.string().uuid(),
  quando: z.string().min(10),
  dia_operacional: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tipo: z.enum(['entrada', 'saida']),
  dispositivo: z.string().max(120).nullable().optional(),
  login_local: z.string().max(60).nullable().optional(),
});
const Body = z.object({
  f: z.string(),
  e: z.coerce.number(),
  s: z.string(),
  batidas: z.array(Batida).max(500),
});

/** POST {f,e,s,batidas:[...]} — grava/atualiza o lote e projeta em folha_horas. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, erro: 'corpo inválido' }, { status: 400 });
  const { f, e, s, batidas } = parsed.data;
  if (!autoriza(f, e, s)) return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });
  if (batidas.length === 0) return NextResponse.json({ ok: true, recebidos: 0, ultimo_id: null });

  const { db, schema } = await import('@concilia/db');
  const { and, eq, inArray, sql } = await import('drizzle-orm');
  const { projetarPontoEmFolhaHoras } = await import('@/lib/rh/projetar-horas');

  // Descarta batidas de funcionario_id que não pertence a esta filial — loga, não derruba o lote.
  const idsUnicos = [...new Set(batidas.map((b) => b.funcionario_id))];
  const pertencem = await db
    .select({ id: schema.funcionario.id })
    .from(schema.funcionario)
    .where(and(eq(schema.funcionario.filialId, f), inArray(schema.funcionario.id, idsUnicos)));
  const idsValidos = new Set(pertencem.map((p) => p.id));

  const validas = batidas.filter(
    (b) => idsValidos.has(b.funcionario_id) && !Number.isNaN(new Date(b.quando).getTime()),
  );
  const rejeitadas = batidas.length - validas.length;
  if (rejeitadas > 0) {
    console.error(`[loja/ponto] ${rejeitadas} batida(s) descartada(s) — funcionario_id fora da filial ${f}`);
  }

  if (validas.length > 0) {
    await db
      .insert(schema.pontoBatida)
      .values(
        validas.map((b) => ({
          filialId: f,
          funcionarioId: b.funcionario_id,
          quando: new Date(b.quando),
          diaOperacional: b.dia_operacional,
          tipo: b.tipo,
          origem: 'vendas_local',
          idLocal: b.id,
          dispositivo: b.dispositivo ?? null,
          loginLocal: b.login_local ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: [schema.pontoBatida.filialId, schema.pontoBatida.idLocal],
        set: {
          quando: sql`excluded.quando`,
          diaOperacional: sql`excluded.dia_operacional`,
          tipo: sql`excluded.tipo`,
          dispositivo: sql`excluded.dispositivo`,
          loginLocal: sql`excluded.login_local`,
        },
      });

    const dias = validas.map((b) => b.dia_operacional);
    const diaMin = dias.reduce((m, d) => (d < m ? d : m));
    const diaMax = dias.reduce((m, d) => (d > m ? d : m));
    await projetarPontoEmFolhaHoras(f, diaMin, diaMax).catch((err) =>
      console.error('[loja/ponto] projeção em folha_horas falhou:', err),
    );
  }

  const ultimo = batidas.reduce((m, b) => Math.max(m, b.id), 0);
  return NextResponse.json({ ok: true, recebidos: validas.length, ultimo_id: ultimo });
}
