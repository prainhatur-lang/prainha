import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

// POST: adicionar varias pessoas (em batch) a folha da filial.
const PostBody = z.object({
  filialId: z.string().uuid(),
  pessoas: z
    .array(
      z.object({
        fornecedorId: z.string().uuid(),
        clienteId: z.string().uuid().nullable(),
        papel: z.enum(['funcionario', 'diarista', 'gerente']),
      }),
    )
    .min(1)
    .max(50),
});

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Login necessário', { status: 401 });

  let body: z.infer<typeof PostBody>;
  try {
    body = PostBody.parse(await req.json());
  } catch (e) {
    return new NextResponse(`Body inválido: ${(e as Error).message}`, { status: 400 });
  }

  // RBAC
  const acesso = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, body.filialId),
      ),
    )
    .limit(1);
  if (acesso.length === 0) {
    return new NextResponse('Sem acesso a essa filial', { status: 403 });
  }

  // Verifica que todos os fornecedorIds são da filial
  const fornIds = body.pessoas.map((p) => p.fornecedorId);
  const fornsValidos = await db
    .select({ id: schema.fornecedor.id })
    .from(schema.fornecedor)
    .where(
      and(
        eq(schema.fornecedor.filialId, body.filialId),
        inArray(schema.fornecedor.id, fornIds),
      ),
    );
  if (fornsValidos.length !== fornIds.length) {
    return new NextResponse('Algum fornecedor não é da filial selecionada', { status: 400 });
  }

  // Insere — ignora conflitos (caso ja exista, mantém)
  await db
    .insert(schema.fornecedorFolha)
    .values(
      body.pessoas.map((p) => ({
        fornecedorId: p.fornecedorId,
        clienteId: p.clienteId,
        papel: p.papel,
        ativo: true,
        criadoEm: new Date(),
        atualizadoEm: new Date(),
      })),
    )
    .onConflictDoNothing({ target: schema.fornecedorFolha.fornecedorId });

  return NextResponse.json({ ok: true, criados: body.pessoas.length });
}

// PUT: atualizar uma pessoa especifica.
const PutBody = z.object({
  fornecedorId: z.string().uuid(),
  papel: z.enum(['funcionario', 'diarista', 'gerente']),
  gerenteModelo: z.enum(['1pp_dos_10pct', 'fixo_por_dia']).nullable(),
  gerenteValorFixoDia: z.number().nullable(),
  diaristaTaxaHoraOverride: z.number().nullable(),
  diaristaModelo: z.enum(['por_hora', 'fixo_por_dia']).optional(),
  diaristaValorFixoDia: z.number().nullable().optional(),
  bonusFixoSemanal: z.number().nullable().optional(),
  bonusPorDia: z.number().nullable().optional(),
  ativo: z.boolean(),
  // Dados bancarios — opcionais, viram NULL no DB se vazios.
  bancoNome: z.string().max(100).nullable().optional(),
  bancoAgencia: z.string().max(20).nullable().optional(),
  bancoConta: z.string().max(30).nullable().optional(),
  chavePix: z.string().max(100).nullable().optional(),
});

export async function PUT(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Login necessário', { status: 401 });

  let body: z.infer<typeof PutBody>;
  try {
    body = PutBody.parse(await req.json());
  } catch (e) {
    return new NextResponse(`Body inválido: ${(e as Error).message}`, { status: 400 });
  }

  // Confere que o fornecedor pertence a uma filial onde o user tem acesso
  const [forn] = await db
    .select({ filialId: schema.fornecedor.filialId })
    .from(schema.fornecedor)
    .where(eq(schema.fornecedor.id, body.fornecedorId))
    .limit(1);
  if (!forn) return new NextResponse('Fornecedor não encontrado', { status: 404 });

  const acesso = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, forn.filialId),
      ),
    )
    .limit(1);
  if (acesso.length === 0) {
    return new NextResponse('Sem acesso', { status: 403 });
  }

  await db
    .update(schema.fornecedorFolha)
    .set({
      papel: body.papel,
      gerenteModelo: body.gerenteModelo,
      gerenteValorFixoDia:
        body.gerenteValorFixoDia !== null ? String(body.gerenteValorFixoDia) : null,
      diaristaTaxaHoraOverride:
        body.diaristaTaxaHoraOverride !== null ? String(body.diaristaTaxaHoraOverride) : null,
      diaristaModelo: body.diaristaModelo ?? 'por_hora',
      diaristaValorFixoDia:
        body.diaristaValorFixoDia != null ? String(body.diaristaValorFixoDia) : null,
      bonusFixoSemanal:
        body.bonusFixoSemanal != null ? String(body.bonusFixoSemanal) : null,
      bonusPorDia: body.bonusPorDia != null ? String(body.bonusPorDia) : null,
      ativo: body.ativo,
      atualizadoEm: new Date(),
    })
    .where(eq(schema.fornecedorFolha.fornecedorId, body.fornecedorId));

  // Dados bancarios vivem em fornecedor (sao da pessoa, nao do vinculo
  // com a folha). Atualiza so se algum campo bancario veio no body.
  const temBancarios =
    'bancoNome' in body ||
    'bancoAgencia' in body ||
    'bancoConta' in body ||
    'chavePix' in body;
  if (temBancarios) {
    await db
      .update(schema.fornecedor)
      .set({
        bancoNome: body.bancoNome?.trim() || null,
        bancoAgencia: body.bancoAgencia?.trim() || null,
        bancoConta: body.bancoConta?.trim() || null,
        chavePix: body.chavePix?.trim() || null,
      })
      .where(eq(schema.fornecedor.id, body.fornecedorId));
  }

  return NextResponse.json({ ok: true });
}
