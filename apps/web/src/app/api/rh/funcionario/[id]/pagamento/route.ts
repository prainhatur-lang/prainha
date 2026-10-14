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
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { createClient } from '@/lib/supabase/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { garantirPapeisDaPessoa } from '@/lib/rh/pessoa-unica';
import { temConta } from '@/lib/rh/conta-da-pessoa';

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
    // Sem a marcação, ainda vale se a pessoa já está na folha daqui (mesmo
    // CPF) ou bateu ponto aqui: a marcação some quando alguém desmarca, mas a
    // folha da casa continua cobrando a conta (Regina/Prainha Mar, 14/10/2026:
    // ponto e folha na Mar, e a conta não tinha onde ser digitada).
    const jaNaCasa =
      !extra && func.cpf
        ? (
            await db
              .select({ id: schema.fornecedor.id })
              .from(schema.fornecedor)
              .innerJoin(schema.fornecedorFolha, eq(schema.fornecedorFolha.fornecedorId, schema.fornecedor.id))
              .where(
                and(
                  eq(schema.fornecedor.filialId, filialId),
                  isNull(schema.fornecedor.dataDelete),
                  sql`regexp_replace(coalesce(${schema.fornecedor.cnpjOuCpf}, ''), '[^0-9]', '', 'g') = ${func.cpf}`,
                ),
              )
              .limit(1)
          ).length > 0 ||
          (
            await db
              .select({ id: schema.pontoBatida.id })
              .from(schema.pontoBatida)
              .where(
                and(
                  eq(schema.pontoBatida.funcionarioId, id),
                  eq(schema.pontoBatida.filialId, filialId),
                  isNull(schema.pontoBatida.excluidaEm),
                ),
              )
              .limit(1)
          ).length > 0
        : false;
    if (!extra && !jaNaCasa) {
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

  // Conta como estava ANTES nesta casa — as outras casas que tinham a mesma
  // cópia acompanham a troca (mais abaixo).
  const [contaAntes] = await db
    .select({
      chavePix: schema.fornecedor.chavePix,
      bancoNome: schema.fornecedor.bancoNome,
      bancoAgencia: schema.fornecedor.bancoAgencia,
      bancoConta: schema.fornecedor.bancoConta,
    })
    .from(schema.fornecedor)
    .where(eq(schema.fornecedor.id, fornecedorId))
    .limit(1);

  // Dados bancários/PIX moram no fornecedor (são da pessoa — mas o fornecedor
  // é por filial, então cada casa guarda a própria cópia).
  const contaNova =
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
          };
  await db.update(schema.fornecedor).set(contaNova).where(eq(schema.fornecedor.id, fornecedorId));

  // A conta é da PESSOA: repassa pras outras casas onde ela está na folha (mesmo
  // CPF) e a conta está vazia ou é a mesma cópia antiga daqui. Conta diferente
  // digitada de propósito na outra casa fica como está.
  let contaRepassada = 0;
  const cpfDigitos = (func.cpf ?? '').replace(/\D/g, '');
  if (temConta(contaNova) && cpfDigitos.length === 11) {
    const igualAntes = (campo: 'chavePix' | 'bancoNome' | 'bancoAgencia' | 'bancoConta') => {
      const coluna = schema.fornecedor[campo];
      const v = contaAntes?.[campo]?.trim() || null;
      return v == null ? sql`nullif(trim(${coluna}), '') is null` : sql`trim(${coluna}) = ${v}`;
    };
    const repassados = await db
      .update(schema.fornecedor)
      .set(contaNova)
      .where(
        and(
          sql`${schema.fornecedor.filialId} <> ${filialId}`,
          isNull(schema.fornecedor.dataDelete),
          sql`regexp_replace(coalesce(${schema.fornecedor.cnpjOuCpf}, ''), '[^0-9]', '', 'g') = ${cpfDigitos}`,
          sql`exists (select 1 from fornecedor_folha ff where ff.fornecedor_id = ${schema.fornecedor.id})`,
          sql`(
            (nullif(trim(${schema.fornecedor.chavePix}), '') is null and nullif(trim(${schema.fornecedor.bancoConta}), '') is null)
            or (${igualAntes('chavePix')} and ${igualAntes('bancoNome')} and ${igualAntes('bancoAgencia')} and ${igualAntes('bancoConta')})
          )`,
        ),
      )
      .returning({ id: schema.fornecedor.id });
    contaRepassada = repassados.length;
  }

  return NextResponse.json({
    ok: true,
    filialId,
    fornecedorId,
    clienteId: papeis.clienteId,
    criouCliente: papeis.criouCliente,
    comandoLojaId: papeis.comandoLojaId,
    contaRepassada,
  });
}
