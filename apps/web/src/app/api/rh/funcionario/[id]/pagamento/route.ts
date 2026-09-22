// PUT /api/rh/funcionario/[id]/pagamento — dados de PAGAMENTO do funcionário,
// direto do cadastro unificado do RH ("não estamos encontrando onde colocar
// os dados do pagamento", dono 26/08/2026).
//
// Por baixo continua o modelo da folha (fornecedor + fornecedor_folha). Se o
// funcionário ainda não tem fornecedor na filial, ESTA rota cria o fornecedor
// (nascido na nuvem, codigo_externo NULL) e o vínculo da folha na hora.
//
// ACORDO É POR LOJA: fornecedor é por filial, então quem circula entre lojas
// tem um fornecedor_folha em cada casa — e pode ser gerente fixo numa e
// diarista na outra. `filialId` no body escolhe qual acordo está sendo
// editado (default = lotação principal); a filial tem que ser a principal ou
// uma das extras do funcionário.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { createClient } from '@/lib/supabase/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { garantirPapeisDaPessoa } from '@/lib/rh/pessoa-unica';

export const dynamic = 'force-dynamic';

const Body = z.object({
  /** Filial do acordo (default = lotação principal do funcionário). */
  filialId: z.string().uuid().optional(),
  papel: z.enum(['funcionario', 'diarista', 'gerente']),
  gerenteModelo: z.enum(['1pp_dos_10pct', 'fixo_por_dia']).nullable().optional(),
  gerenteValorFixoDia: z.number().positive().nullable().optional(),
  diaristaModelo: z.enum(['por_hora', 'fixo_por_dia']).optional(),
  diaristaTaxaHoraOverride: z.number().positive().nullable().optional(),
  diaristaValorFixoDia: z.number().positive().nullable().optional(),
  bonusFixoSemanal: z.number().positive().nullable().optional(),
  bonusPorDia: z.number().positive().nullable().optional(),
  /** false = sai da folha semanal DESTA loja (mantém histórico/ajustes). */
  ativo: z.boolean().optional(),
  /** marcar a pessoa também como cliente (consumo/fiado) — escolha de quem cadastra */
  tambemCliente: z.boolean().optional(),
  /** 'pix' | 'banco' — como essa pessoa recebe */
  formaPagamento: z.enum(['pix', 'banco']).optional(),
  chavePix: z.string().max(100).nullable().optional(),
  bancoNome: z.string().max(100).nullable().optional(),
  bancoAgencia: z.string().max(20).nullable().optional(),
  bancoConta: z.string().max(30).nullable().optional(),
});

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'funcionario.update');
  if (semPerm) return semPerm;

  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const b = parsed.data;

  const [func] = await db
    .select({
      id: schema.funcionario.id,
      filialId: schema.funcionario.filialId,
      nome: schema.funcionario.nome,
      cpf: schema.funcionario.cpf,
      fornecedorId: schema.funcionario.fornecedorId,
    })
    .from(schema.funcionario)
    .where(eq(schema.funcionario.id, id))
    .limit(1);
  if (!func) return NextResponse.json({ error: 'funcionário não encontrado' }, { status: 404 });

  const filialId = b.filialId ?? func.filialId;
  if (filialId !== func.filialId) {
    const [extra] = await db
      .select({ id: schema.funcionarioFilialExtra.id })
      .from(schema.funcionarioFilialExtra)
      .where(
        and(
          eq(schema.funcionarioFilialExtra.funcionarioId, id),
          eq(schema.funcionarioFilialExtra.filialId, filialId),
        ),
      )
      .limit(1);
    if (!extra) {
      return NextResponse.json(
        { error: 'o funcionário não trabalha nessa loja — marque "também bate ponto em" primeiro' },
        { status: 400 },
      );
    }
    if (!func.cpf) {
      return NextResponse.json(
        { error: 'informe o CPF do funcionário pra configurar o pagamento em outra loja' },
        { status: 400 },
      );
    }
  }

  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, filialId),
      ),
    )
    .limit(1);
  if (!acesso) return NextResponse.json({ error: 'sem acesso à filial' }, { status: 403 });

  // CADASTRO ÚNICO: garante fornecedor (recebe) + cliente (consome/fiado) NA
  // FILIAL DO ACORDO e amarra os dois — uma pessoa, três papéis, por casa.
  let papeis: Awaited<ReturnType<typeof garantirPapeisDaPessoa>>;
  try {
    papeis = await garantirPapeisDaPessoa(id, {
      criadoPor: user.id,
      enfileirarNaLoja: true,
      tambemCliente: b.tambemCliente === true,
      filialId,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  if (!papeis) return NextResponse.json({ error: 'funcionário não encontrado' }, { status: 404 });
  const fornecedorId = papeis.fornecedorId;
  const ativo = b.ativo ?? true;

  const valores = {
    papel: b.papel,
    gerenteModelo: b.gerenteModelo ?? null,
    gerenteValorFixoDia: b.gerenteValorFixoDia != null ? String(b.gerenteValorFixoDia) : null,
    diaristaModelo: b.diaristaModelo ?? 'por_hora',
    diaristaTaxaHoraOverride:
      b.diaristaTaxaHoraOverride != null ? String(b.diaristaTaxaHoraOverride) : null,
    diaristaValorFixoDia: b.diaristaValorFixoDia != null ? String(b.diaristaValorFixoDia) : null,
    bonusFixoSemanal: b.bonusFixoSemanal != null ? String(b.bonusFixoSemanal) : null,
    bonusPorDia: b.bonusPorDia != null ? String(b.bonusPorDia) : null,
    ativo,
  };

  await db
    .insert(schema.fornecedorFolha)
    .values({ fornecedorId, ...valores })
    .onConflictDoUpdate({
      target: schema.fornecedorFolha.fornecedorId,
      set: { ...valores, atualizadoEm: new Date() },
    });

  // Dados bancários/PIX moram no fornecedor (são da pessoa — mas o fornecedor
  // é por filial, então cada casa guarda a própria cópia).
  await db
    .update(schema.fornecedor)
    .set(
      b.formaPagamento === 'banco'
        ? {
            chavePix: null,
            bancoNome: b.bancoNome?.trim() || null,
            bancoAgencia: b.bancoAgencia?.trim() || null,
            bancoConta: b.bancoConta?.trim() || null,
          }
        : b.formaPagamento === 'pix'
          ? { chavePix: b.chavePix?.trim() || null, bancoNome: null, bancoAgencia: null, bancoConta: null }
          : {
              chavePix: b.chavePix?.trim() || null,
              bancoNome: b.bancoNome?.trim() || null,
              bancoAgencia: b.bancoAgencia?.trim() || null,
              bancoConta: b.bancoConta?.trim() || null,
            },
    )
    .where(eq(schema.fornecedor.id, fornecedorId));

  return NextResponse.json({
    ok: true,
    filialId,
    fornecedorId,
    clienteId: papeis.clienteId,
    criouCliente: papeis.criouCliente,
    comandoLojaId: papeis.comandoLojaId,
  });
}
