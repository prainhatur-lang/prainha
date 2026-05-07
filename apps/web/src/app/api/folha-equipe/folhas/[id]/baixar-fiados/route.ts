// Cria comandos pro agente baixar fiado no Consumer.
// Pra cada pessoa vinculada da folha que tem cliente.saldo_atual_conta_corrente > 0,
// gera 1 comando 'baixar_fiado' que vai inserir uma linha em CONTACORRENTE
// com DEBITO = saldo, zerando.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Login', { status: 401 });

  const { id } = await params;
  const [folha] = await db
    .select()
    .from(schema.folhaSemana)
    .where(eq(schema.folhaSemana.id, id))
    .limit(1);
  if (!folha) return new NextResponse('Folha não encontrada', { status: 404 });

  const acesso = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, folha.filialId),
      ),
    )
    .limit(1);
  if (acesso.length === 0) return new NextResponse('Sem acesso', { status: 403 });

  // Pessoas vinculadas com cliente E saldo > 0
  const pessoas = await db
    .select({
      fornecedorNome: schema.fornecedor.nome,
      clienteCodigoExterno: schema.cliente.codigoExterno,
      clienteNome: schema.cliente.nome,
      saldo: schema.cliente.saldoAtualContaCorrente,
    })
    .from(schema.fornecedorFolha)
    .innerJoin(
      schema.fornecedor,
      eq(schema.fornecedor.id, schema.fornecedorFolha.fornecedorId),
    )
    .innerJoin(schema.cliente, eq(schema.cliente.id, schema.fornecedorFolha.clienteId))
    .where(
      and(
        eq(schema.fornecedor.filialId, folha.filialId),
        eq(schema.fornecedorFolha.ativo, true),
        isNotNull(schema.fornecedorFolha.clienteId),
        isNotNull(schema.cliente.saldoAtualContaCorrente),
        gt(schema.cliente.saldoAtualContaCorrente, '0'),
      ),
    );

  if (pessoas.length === 0) {
    return NextResponse.json({ ok: true, comandos: 0, msg: 'Nenhuma pessoa com saldo de fiado' });
  }

  const observacao = `Compensado folha ${formatBr(folha.dataInicio)} a ${formatBr(folha.dataFim)}`;

  // Idempotencia: se ja existe comando baixar_fiado pendente ou executando pra mesma
  // filial+codigoCliente, nao cria de novo (evita duplicar baixa em caso de duplo-clique
  // ou reabrir a folha e clicar de novo antes do agente rodar).
  const codigos = pessoas
    .map((p) => p.clienteCodigoExterno)
    .filter((c): c is number => c != null);
  const existentes = codigos.length
    ? await db
        .select({ codigoCliente: sql<number>`(payload->>'codigoCliente')::int` })
        .from(schema.agenteComando)
        .where(
          and(
            eq(schema.agenteComando.filialId, folha.filialId),
            eq(schema.agenteComando.tipo, 'baixar_fiado'),
            inArray(schema.agenteComando.status, ['pendente', 'executando']),
            inArray(
              sql`(payload->>'codigoCliente')::int`,
              codigos,
            ),
          ),
        )
    : [];
  const jaTem = new Set(existentes.map((e) => e.codigoCliente));
  const pessoasNovas = pessoas.filter(
    (p) => p.clienteCodigoExterno != null && !jaTem.has(p.clienteCodigoExterno),
  );
  const ignorados = pessoas.length - pessoasNovas.length;

  if (pessoasNovas.length === 0) {
    return NextResponse.json({
      ok: true,
      comandos: 0,
      ignorados,
      msg: `Todos os ${ignorados} comandos já estavam na fila — nada novo criado.`,
    });
  }

  const comandos = pessoasNovas.map((p) => ({
    filialId: folha.filialId,
    tipo: 'baixar_fiado',
    payload: {
      codigoCliente: p.clienteCodigoExterno,
      observacao,
      saldoEsperado: p.saldo, // só pra debug — agente lê o real
      pessoa: p.fornecedorNome,
    },
    criadoPor: user.id,
  }));

  await db.insert(schema.agenteComando).values(comandos);

  return NextResponse.json({
    ok: true,
    comandos: comandos.length,
    ignorados,
    pessoas: pessoasNovas.map((p) => ({ nome: p.fornecedorNome, saldo: Number(p.saldo) })),
  });
}

function formatBr(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
