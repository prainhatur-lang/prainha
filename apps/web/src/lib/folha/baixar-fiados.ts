// Helper compartilhado: cria comandos 'baixar_fiado' pro agente zerar
// o saldo de fiado dos garçons no Consumer Rede.
//
// Usado por:
//   - POST /api/folha-equipe/folhas/:id/baixar-fiados  (manual, fallback)
//   - POST /api/folha-equipe/folhas/:id/fechar         (automatico)

import { db, schema } from '@concilia/db';
import { and, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

export interface BaixarFiadosResult {
  comandos: number;
  ignorados: number;
  pessoas: Array<{ nome: string; saldo: number }>;
  msg?: string;
}

export async function criarComandosBaixarFiado(args: {
  filialId: string;
  folhaId: string;
  dataInicio: string;
  dataFim: string;
  userId: string;
}): Promise<BaixarFiadosResult> {
  const { filialId, folhaId, dataInicio, dataFim, userId } = args;

  // Pessoas vinculadas com cliente E saldo > 0
  let pessoas = await db
    .select({
      fornecedorId: schema.fornecedorFolha.fornecedorId,
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
        eq(schema.fornecedor.filialId, filialId),
        eq(schema.fornecedorFolha.ativo, true),
        isNotNull(schema.fornecedorFolha.clienteId),
        isNotNull(schema.cliente.saldoAtualContaCorrente),
        gt(schema.cliente.saldoAtualContaCorrente, '0'),
      ),
    );

  if (pessoas.length === 0) {
    return { comandos: 0, ignorados: 0, pessoas: [], msg: 'Nenhuma pessoa com saldo de fiado' };
  }

  // Só zera no Consumer quem teve o fiado EFETIVAMENTE descontado na folha
  // (a conta_pagar de comissão saiu com descontos>0). Quem ficou em aberto
  // — comissão não cobriu ou sem comissão na semana — NÃO é zerado: o saldo
  // carrega pro próximo fechamento. Senão a dívida seria perdoada de graça.
  const comDesconto = await db
    .select({ fornecedorId: schema.contaPagar.fornecedorId })
    .from(schema.contaPagar)
    .where(
      and(
        eq(schema.contaPagar.folhaSemanaId, folhaId),
        isNull(schema.contaPagar.dataDelete),
        isNotNull(schema.contaPagar.descontos),
        gt(schema.contaPagar.descontos, '0'),
      ),
    );
  const coletados = new Set(comDesconto.map((c) => c.fornecedorId).filter(Boolean));
  const pessoasAberto = pessoas.filter((p) => !coletados.has(p.fornecedorId));
  pessoas = pessoas.filter((p) => coletados.has(p.fornecedorId));

  if (pessoas.length === 0) {
    return {
      comandos: 0,
      ignorados: 0,
      pessoas: [],
      msg: `Nenhum fiado descontado nesta folha — ${pessoasAberto.length} ficaram em aberto (carregam pra próxima).`,
    };
  }

  const observacao = `Compensado folha ${formatBr(dataInicio)} a ${formatBr(dataFim)}`;

  // Idempotencia: ja existe comando pendente/executando pra mesma filial+codigoCliente?
  const codigos = pessoas
    .map((p) => p.clienteCodigoExterno)
    .filter((c): c is number => c != null);
  const existentes = codigos.length
    ? await db
        .select({ codigoCliente: sql<number>`(payload->>'codigoCliente')::int` })
        .from(schema.agenteComando)
        .where(
          and(
            eq(schema.agenteComando.filialId, filialId),
            eq(schema.agenteComando.tipo, 'baixar_fiado'),
            inArray(schema.agenteComando.status, ['pendente', 'executando']),
            inArray(sql`(payload->>'codigoCliente')::int`, codigos),
          ),
        )
    : [];
  const jaTem = new Set(existentes.map((e) => e.codigoCliente));
  const pessoasNovas = pessoas.filter(
    (p) => p.clienteCodigoExterno != null && !jaTem.has(p.clienteCodigoExterno),
  );
  const ignorados = pessoas.length - pessoasNovas.length;

  if (pessoasNovas.length === 0) {
    return {
      comandos: 0,
      ignorados,
      pessoas: [],
      msg: `Todos os ${ignorados} comandos já estavam na fila — nada novo criado.`,
    };
  }

  const comandos = pessoasNovas.map((p) => ({
    filialId,
    tipo: 'baixar_fiado',
    payload: {
      codigoCliente: p.clienteCodigoExterno,
      observacao,
      saldoEsperado: p.saldo, // só pra debug — agente lê o real
      pessoa: p.fornecedorNome,
    },
    criadoPor: userId,
  }));

  await db.insert(schema.agenteComando).values(comandos);

  return {
    comandos: comandos.length,
    ignorados,
    pessoas: pessoasNovas.map((p) => ({ nome: p.fornecedorNome ?? '(sem nome)', saldo: Number(p.saldo) })),
  };
}

function formatBr(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
