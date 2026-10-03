// Correção manual de ponto — inclusão, alteração ou exclusão de 1 batida.
// justificativa é obrigatória (min 10 chars): toda correção fica registrada
// em ponto_batida_ajuste com o antes/depois, pra auditoria de RH.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { negarSemPerm } from '@/lib/exigir-perm';
import { projetarPontoEmFolhaHoras } from '@/lib/rh/projetar-horas';
import { conflitoOutraCasa } from '@/lib/rh/conflito-casas';
import { horaMinutoBr, madrugadaDoDia, msgMadrugadaFutura, quandoNoDiaOperacional } from '@/lib/rh/dia-operacional';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  funcionarioId: z.string().uuid(),
  // Casa que está aberta na tela. Quem circula entre lojas tem cadastro numa
  // casa e bate ponto em outra: sem isso a inclusão caía na casa do cadastro e
  // sumia da grade (Isabel, 02/10/2026 — lançada 5x na Bar, olhando a Mar).
  filialId: z.string().uuid().optional(),
  dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  acao: z.enum(['inclusao', 'alteracao', 'exclusao']),
  batidaId: z.string().uuid().optional(),
  quando: z.string().min(10).optional(),
  tipo: z.enum(['entrada', 'saida']).optional(),
  justificativa: z.string().min(10).max(500),
});

/** Horário digitado na tela é o da loja (BRT). Se chegar sem fuso (aba aberta
 *  com a tela antiga), assume -03:00 — o servidor roda em UTC e gravaria a
 *  batida 3 horas antes. */
function quandoBr(s: string): Date {
  const temFuso = /(Z|[+-]\d{2}:?\d{2})$/i.test(s);
  return new Date(temFuso ? s : `${s}-03:00`);
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const semPerm = await negarSemPerm(user.id, 'ponto.corrigir');
  if (semPerm) return semPerm;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'body inválido', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  if (d.acao !== 'exclusao' && (!d.quando || !d.tipo)) {
    return NextResponse.json({ error: 'quando e tipo são obrigatórios pra incluir/alterar' }, { status: 400 });
  }
  if (d.acao !== 'inclusao' && !d.batidaId) {
    return NextResponse.json({ error: 'batidaId é obrigatório pra alterar/excluir' }, { status: 400 });
  }
  // O dia do ponto vira às 05:00 (como na loja): hora antes disso na coluna do
  // dia D é a madrugada de D+1 — quem entrou à noite e saiu depois da
  // meia-noite. A tela já manda o dia certo; aba aberta com a tela antiga manda
  // o próprio D, e aqui vai pro dia seguinte.
  const quando = d.quando ? quandoNoDiaOperacional(d.dia, quandoBr(d.quando)) : null;
  if (d.acao !== 'exclusao' && (!quando || Number.isNaN(quando.getTime()))) {
    return NextResponse.json({ error: 'horário inválido' }, { status: 400 });
  }
  // Madrugada que ainda não chegou não entra: a batida ficaria no futuro.
  if (d.acao !== 'exclusao' && quando && madrugadaDoDia(d.dia, quando) && quando.getTime() > Date.now()) {
    return NextResponse.json({ error: msgMadrugadaFutura(d.dia, horaMinutoBr(quando)) }, { status: 400 });
  }

  const [func] = await db
    .select({ filialId: schema.funcionario.filialId })
    .from(schema.funcionario)
    .where(eq(schema.funcionario.id, d.funcionarioId))
    .limit(1);
  if (!func) return NextResponse.json({ error: 'funcionário não encontrado' }, { status: 404 });

  // Sem filialId (aba aberta com a tela antiga) vale a casa do cadastro, como sempre foi.
  const filialTela = d.filialId ?? func.filialId;
  if (filialTela !== func.filialId) {
    const [vinculo] = await db
      .select({ id: schema.funcionarioFilialExtra.id })
      .from(schema.funcionarioFilialExtra)
      .where(
        and(
          eq(schema.funcionarioFilialExtra.funcionarioId, d.funcionarioId),
          eq(schema.funcionarioFilialExtra.filialId, filialTela),
        ),
      )
      .limit(1);
    if (!vinculo) return NextResponse.json({ error: 'funcionário não é desta filial' }, { status: 400 });
  }

  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, filialTela)))
    .limit(1);
  if (!acesso) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  // Casa onde a batida mora — é ela que recalcula as horas do dia.
  let filialBatida = filialTela;

  let batidaId: string | null = null;
  let valorAntes: { quando: string; tipo: string } | null = null;
  let valorDepois: { quando: string; tipo: string } | null = null;

  if (d.acao === 'inclusao') {
    const conflito = await conflitoOutraCasa({
      funcionarioId: d.funcionarioId, filialId: filialTela, dia: d.dia, quando: quando!, tipo: d.tipo!,
    });
    if (conflito) return NextResponse.json({ error: conflito }, { status: 409 });
    const [criada] = await db
      .insert(schema.pontoBatida)
      .values({
        filialId: filialTela,
        funcionarioId: d.funcionarioId,
        quando: quando!,
        diaOperacional: d.dia,
        tipo: d.tipo!,
        origem: 'correcao',
      })
      .returning({ id: schema.pontoBatida.id });
    batidaId = criada.id;
    valorDepois = { quando: quando!.toISOString(), tipo: d.tipo! };
  } else {
    const [atual] = await db
      .select()
      .from(schema.pontoBatida)
      .where(and(eq(schema.pontoBatida.id, d.batidaId!), eq(schema.pontoBatida.funcionarioId, d.funcionarioId)))
      .limit(1);
    if (!atual) return NextResponse.json({ error: 'batida não encontrada' }, { status: 404 });
    if (atual.filialId !== filialTela && atual.filialId !== func.filialId) {
      return NextResponse.json({ error: 'sem acesso' }, { status: 403 });
    }
    filialBatida = atual.filialId;
    valorAntes = { quando: atual.quando.toISOString(), tipo: atual.tipo };
    batidaId = atual.id;

    if (d.acao === 'alteracao') {
      const conflito = await conflitoOutraCasa({
        funcionarioId: d.funcionarioId, filialId: atual.filialId, dia: d.dia, quando: quando!, tipo: d.tipo!, batidaId: atual.id,
      });
      if (conflito) return NextResponse.json({ error: conflito }, { status: 409 });
      await db
        .update(schema.pontoBatida)
        .set({ quando: quando!, tipo: d.tipo!, origem: 'correcao' })
        .where(eq(schema.pontoBatida.id, atual.id));
      valorDepois = { quando: quando!.toISOString(), tipo: d.tipo! };
    } else {
      await db
        .update(schema.pontoBatida)
        .set({ excluidaEm: new Date(), excluidaPor: user.id })
        .where(eq(schema.pontoBatida.id, atual.id));
      valorDepois = null;
    }
  }

  await db.insert(schema.pontoBatidaAjuste).values({
    filialId: filialBatida,
    funcionarioId: d.funcionarioId,
    batidaId,
    dia: d.dia,
    acao: d.acao,
    valorAntes,
    valorDepois,
    justificativa: d.justificativa,
    usuarioId: user.id,
  });

  // Incluir ou excluir muda a ordem do dia: o relógio alterna entrada/saída
  // pela sequência, então quem esqueceu de bater a primeira entrada fica com
  // tudo trocado dali pra frente. Refaz a alternância (1ª = entrada) e deixa
  // cada troca na auditoria. Alteração não mexe: ali o RH escolheu o tipo.
  let reordenadas = 0;
  if (d.acao !== 'alteracao') {
    const doDia = await db
      .select({ id: schema.pontoBatida.id, quando: schema.pontoBatida.quando, tipo: schema.pontoBatida.tipo })
      .from(schema.pontoBatida)
      .where(
        and(
          eq(schema.pontoBatida.filialId, filialBatida),
          eq(schema.pontoBatida.funcionarioId, d.funcionarioId),
          eq(schema.pontoBatida.diaOperacional, d.dia),
          isNull(schema.pontoBatida.excluidaEm),
        ),
      )
      .orderBy(asc(schema.pontoBatida.quando));
    for (const [i, b] of doDia.entries()) {
      const certo = i % 2 === 0 ? 'entrada' : 'saida';
      if (b.tipo === certo) continue;
      // origem 'correcao' faz a troca descer pra loja (ver api/loja/ponto).
      await db.update(schema.pontoBatida).set({ tipo: certo, origem: 'correcao' }).where(eq(schema.pontoBatida.id, b.id));
      await db.insert(schema.pontoBatidaAjuste).values({
        filialId: filialBatida,
        funcionarioId: d.funcionarioId,
        batidaId: b.id,
        dia: d.dia,
        acao: 'alteracao',
        valorAntes: { quando: b.quando.toISOString(), tipo: b.tipo },
        valorDepois: { quando: b.quando.toISOString(), tipo: certo },
        justificativa: `Sequência reajustada: ${d.justificativa}`.slice(0, 500),
        usuarioId: user.id,
      });
      reordenadas++;
    }
  }

  const resultado = await projetarPontoEmFolhaHoras(filialBatida, d.dia, d.dia);
  return NextResponse.json({ ok: true, reordenadas, ...resultado });
}
