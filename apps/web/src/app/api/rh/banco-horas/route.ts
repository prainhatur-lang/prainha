// Banco de horas e escala — três ações da tela /rh/banco-horas:
//   lancamento        acerto, horas pagas ou folga tirada do banco (com motivo)
//   atribuir_jornada  escala da pessoa a partir de um dia (linha nova, a antiga fica)
//   criar_jornada     escala nova (horas por dia da semana)
// Nada aqui mexe em batida de ponto nem em folha. O saldo que veio do Stelanto
// ('saldo_inicial') não é criado nem alterado por esta rota.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { negarSemPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { hojeBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const MinDia = z.number().int().min(0).max(16 * 60).optional();

const Body = z.discriminatedUnion('acao', [
  z.object({
    acao: z.literal('lancamento'),
    funcionarioId: z.string().uuid(),
    tipo: z.enum(['ajuste', 'pagamento', 'folga']),
    // Com sinal. Teto de 600 h por lançamento: pega dedo errado (minuto no lugar de hora).
    minutos: z.number().int().min(-36000).max(36000).refine((m) => m !== 0, 'minutos não pode ser zero'),
    dia: Dia,
    descricao: z.string().trim().min(10).max(500),
  }),
  z.object({
    acao: z.literal('atribuir_jornada'),
    funcionarioId: z.string().uuid(),
    jornadaId: z.string().uuid(),
    vigenteDesde: Dia,
  }),
  z.object({
    acao: z.literal('criar_jornada'),
    nome: z.string().trim().min(3).max(120),
    tipo: z.enum(['fixa', 'intermitente']),
    minSeg: MinDia,
    minTer: MinDia,
    minQua: MinDia,
    minQui: MinDia,
    minSex: MinDia,
    minSab: MinDia,
    minDom: MinDia,
  }),
]);

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const semPerm = await negarSemPerm(user.id, 'ponto.corrigir');
  if (semPerm) return semPerm;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'dados inválidos', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  if (d.acao === 'criar_jornada') {
    const fixa = d.tipo === 'fixa';
    const mins = {
      minSeg: fixa ? (d.minSeg ?? 0) : 0,
      minTer: fixa ? (d.minTer ?? 0) : 0,
      minQua: fixa ? (d.minQua ?? 0) : 0,
      minQui: fixa ? (d.minQui ?? 0) : 0,
      minSex: fixa ? (d.minSex ?? 0) : 0,
      minSab: fixa ? (d.minSab ?? 0) : 0,
      minDom: fixa ? (d.minDom ?? 0) : 0,
    };
    if (fixa && Object.values(mins).every((m) => m === 0)) {
      return NextResponse.json({ error: 'escala fixa precisa de horas em pelo menos um dia' }, { status: 400 });
    }
    const [criada] = await db
      .insert(schema.rhJornada)
      .values({ nome: d.nome, tipo: d.tipo, origem: 'manual', ...mins })
      .onConflictDoNothing({ target: schema.rhJornada.nome })
      .returning({ id: schema.rhJornada.id });
    if (!criada) return NextResponse.json({ error: 'já existe uma escala com esse nome' }, { status: 409 });
    return NextResponse.json({ ok: true, id: criada.id });
  }

  // Daqui pra baixo a ação é sobre uma pessoa: só quem enxerga a casa dela.
  const [func] = await db
    .select({ filialId: schema.funcionario.filialId })
    .from(schema.funcionario)
    .where(eq(schema.funcionario.id, d.funcionarioId))
    .limit(1);
  if (!func) return NextResponse.json({ error: 'funcionário não encontrado' }, { status: 404 });
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === func.filialId)) {
    return NextResponse.json({ error: 'sem acesso à casa desse funcionário' }, { status: 403 });
  }

  if (d.acao === 'atribuir_jornada') {
    const [jornada] = await db
      .select({ id: schema.rhJornada.id })
      .from(schema.rhJornada)
      .where(eq(schema.rhJornada.id, d.jornadaId))
      .limit(1);
    if (!jornada) return NextResponse.json({ error: 'escala não encontrada' }, { status: 404 });
    // Mesma pessoa, mesmo dia de início: corrige a escolha em vez de duplicar.
    await db
      .insert(schema.funcionarioJornada)
      .values({ funcionarioId: d.funcionarioId, jornadaId: d.jornadaId, vigenteDesde: d.vigenteDesde, usuarioId: user.id })
      .onConflictDoUpdate({
        target: [schema.funcionarioJornada.funcionarioId, schema.funcionarioJornada.vigenteDesde],
        set: { jornadaId: d.jornadaId, usuarioId: user.id },
      });
    return NextResponse.json({ ok: true });
  }

  if (d.dia > hojeBr()) return NextResponse.json({ error: 'o dia do lançamento não pode ser no futuro' }, { status: 400 });
  await db.insert(schema.bancoHorasLancamento).values({
    funcionarioId: d.funcionarioId,
    dia: d.dia,
    minutos: d.minutos,
    tipo: d.tipo,
    origem: 'manual',
    descricao: d.descricao,
    usuarioId: user.id,
  });
  return NextResponse.json({ ok: true });
}
