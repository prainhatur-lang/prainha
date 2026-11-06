// PUT /api/rh/funcionario/[id]/conta-inter — conta corrente do Inter que paga a
// FOLHA da pessoa (dono 06/11/2026: "nós temos duas contas agora: a da Caixa,
// que paga os 10%, e a do Inter, que paga a folha. Tem que ter os dois campos").
//
// A conta dos 10% continua no cadastro de sempre (fornecedor: PIX/banco, rota
// /pagamento). Esta é a outra, guardada em conta_inter_folha pelo CPF — é
// dela que sai o arquivo "Folha de pagamento" do Inter.
// Body: { conta: "12345678-9" | null } — null/vazio apaga.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { createClient } from '@/lib/supabase/server';
import { negarSemPerm } from '@/lib/exigir-perm';

export const dynamic = 'force-dynamic';

const Body = z.object({
  conta: z.string().max(30).nullable(),
  /** Quem paga a folha. Hoje só a E.B. */
  empresa: z.enum(['EB', 'PRAINHA']).optional(),
});

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'funcionario.update');
  if (semPerm) return semPerm;

  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'body invalido' }, { status: 400 });
  const empresa = parsed.data.empresa ?? 'EB';

  const [func] = await db
    .select({ nome: schema.funcionario.nome, cpf: schema.funcionario.cpf })
    .from(schema.funcionario)
    .where(eq(schema.funcionario.id, id))
    .limit(1);
  if (!func) return NextResponse.json({ error: 'funcionário não encontrado' }, { status: 404 });
  const cpf = (func.cpf ?? '').replace(/\D/g, '');
  if (cpf.length !== 11) return NextResponse.json({ error: 'cadastre o CPF antes da conta do Inter' }, { status: 400 });

  const digitos = (parsed.data.conta ?? '').replace(/\D/g, '');
  const onde = and(eq(schema.contaInterFolha.empresa, empresa), eq(schema.contaInterFolha.cpf, cpf));
  if (!digitos) {
    await db.delete(schema.contaInterFolha).where(onde);
    return NextResponse.json({ ok: true, conta: null });
  }
  if (digitos.length < 5) return NextResponse.json({ error: 'conta do Inter inválida (ex.: 12345678-9)' }, { status: 400 });
  // Inter escreve com o dígito separado: 12345678-9
  const conta = `${digitos.slice(0, -1)}-${digitos.slice(-1)}`;
  await db
    .insert(schema.contaInterFolha)
    .values({ empresa, cpf, nome: func.nome.toUpperCase(), conta, fonte: 'cadastro' })
    .onConflictDoUpdate({
      target: [schema.contaInterFolha.empresa, schema.contaInterFolha.cpf],
      set: { conta, fonte: 'cadastro', atualizadoEm: new Date() },
    });
  return NextResponse.json({ ok: true, conta });
}
