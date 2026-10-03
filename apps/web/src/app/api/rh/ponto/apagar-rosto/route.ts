// Apaga o rosto cadastrado no ponto facial (ex: alguém se cadastrou tocando
// no nome de outra pessoa). A loja pega no próximo pull do roster: rosto
// nulo na nuvem + já sincronizado lá = apagado (vendas-local loopPontoRoster).
//
// O pull da loja é de 3 em 3 min. Pra pessoa não chegar no tablet antes dele
// (03/10/2026, Sara: o nome dela não vinha na lista de quem cadastra), depois
// de apagar a nuvem avisa as lojas onde a pessoa bate ponto — lotação principal
// + vínculos extras, a mesma regra do roster — pra puxarem na hora. O aviso é
// só um empurrão: se a loja não responde, o rosto já foi apagado do mesmo jeito
// e ela pega no pull de sempre. `lojas` na resposta diz o que cada uma respondeu.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';
import { negarSemPerm } from '@/lib/exigir-perm';
import { avisarLojaRosterPonto } from '@/lib/ponto-loja';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30; // cada loja segura o aviso até 5 s enquanto puxa o roster

const Body = z.object({ funcionarioId: z.string().uuid() });

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const semPerm = await negarSemPerm(user.id, 'ponto.corrigir');
  if (semPerm) return semPerm;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'body inválido' }, { status: 400 });

  const [func] = await db
    .select({ filialId: schema.funcionario.filialId })
    .from(schema.funcionario)
    .where(eq(schema.funcionario.id, parsed.data.funcionarioId))
    .limit(1);
  if (!func) return NextResponse.json({ error: 'funcionário não encontrado' }, { status: 404 });

  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, func.filialId)))
    .limit(1);
  if (!acesso) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  await db
    .update(schema.funcionario)
    .set({ faceDescriptor: null, atualizadoEm: new Date() })
    .where(eq(schema.funcionario.id, parsed.data.funcionarioId));

  // Daqui pra baixo nada derruba a resposta: o rosto já foi apagado.
  let lojas: { nome: string; avisada: boolean; atualizada: boolean }[] = [];
  try {
    const extras = await db
      .select({ filialId: schema.funcionarioFilialExtra.filialId })
      .from(schema.funcionarioFilialExtra)
      .where(eq(schema.funcionarioFilialExtra.funcionarioId, parsed.data.funcionarioId));
    const filialIds = [...new Set([func.filialId, ...extras.map((x) => x.filialId)])];
    const nomes = await db
      .select({ id: schema.filial.id, nome: schema.filial.nome })
      .from(schema.filial)
      .where(inArray(schema.filial.id, filialIds));
    lojas = await Promise.all(
      filialIds.map(async (filialId) => {
        const r = await avisarLojaRosterPonto(filialId);
        if (!r.ok) console.warn(`[ponto] aviso de roster não chegou na loja ${filialId.slice(0, 8)}: ${r.erro}`);
        return {
          nome: nomes.find((n) => n.id === filialId)?.nome ?? 'loja',
          avisada: r.ok,
          atualizada: r.ok && r.atualizado,
        };
      }),
    );
  } catch (err) {
    console.warn('[ponto] aviso de roster às lojas falhou:', err instanceof Error ? err.message : err);
  }
  return NextResponse.json({ ok: true, lojas });
}
