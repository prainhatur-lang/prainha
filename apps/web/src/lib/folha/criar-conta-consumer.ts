// Write-back da folha pro Consumer: cria comandos 'criar_conta_pagar' pro
// agente inserir cada lançamento da folha como conta a pagar (em aberto) na
// tabela CONTASPAGAR do Firebird.
//
// GATED: só roda quando env FOLHA_WRITEBACK_CONSUMER === 'true'. Desligado por
// padrão até o INSERT no Firebird ser validado (generator + escala de VALOR;
// ver fb-test/diag-contaspagar.js e agente-local criarContaPagar()).
//
// Idempotência: se já existem comandos 'criar_conta_pagar' pra esta folha
// (qualquer status != erro), não recria — evita duplicar no Consumer ao
// reabrir/refechar. (v1: refechar NÃO atualiza o que já foi pro Consumer.)

import { db, schema } from '@concilia/db';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Lancamento } from './calcular';

export interface WriteBackResult {
  comandos: number;
  pulados: number;
  avisos: string[];
  ligado: boolean;
}

export function writeBackLigado(): boolean {
  return process.env.FOLHA_WRITEBACK_CONSUMER === 'true';
}

export async function criarComandosContaPagarConsumer(args: {
  filialId: string;
  folhaId: string;
  lancamentos: Lancamento[];
  /** tipo do lançamento -> categoria_conta.id (Postgres) */
  categoriaPorTipo: Record<Lancamento['tipo'], string | null>;
  /** YYYY-MM-DD */
  dataVencimento: string;
  /** YYYY-MM (vira YYYYMM no Consumer) */
  competencia: string;
  userId: string;
}): Promise<WriteBackResult> {
  const avisos: string[] = [];
  if (!writeBackLigado()) {
    return { comandos: 0, pulados: 0, avisos: ['write-back Consumer desligado (flag)'], ligado: false };
  }

  const { filialId, folhaId, lancamentos, categoriaPorTipo, dataVencimento, competencia, userId } =
    args;

  if (lancamentos.length === 0) {
    return { comandos: 0, pulados: 0, avisos, ligado: true };
  }

  // Idempotência por folha.
  const jaExiste = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.agenteComando)
    .where(
      and(
        eq(schema.agenteComando.filialId, filialId),
        eq(schema.agenteComando.tipo, 'criar_conta_pagar'),
        ne(schema.agenteComando.status, 'erro'),
        eq(sql`(payload->>'folhaSemanaId')`, folhaId),
      ),
    );
  if ((jaExiste[0]?.n ?? 0) > 0) {
    return {
      comandos: 0,
      pulados: lancamentos.length,
      avisos: ['comandos de conta a pagar já existiam pra esta folha — nada recriado.'],
      ligado: true,
    };
  }

  // Resolve fornecedor -> codigoExterno (Consumer).
  const fornecedorIds = [...new Set(lancamentos.map((l) => l.fornecedorId))];
  const fornecedores = await db
    .select({ id: schema.fornecedor.id, codigoExterno: schema.fornecedor.codigoExterno })
    .from(schema.fornecedor)
    .where(inArray(schema.fornecedor.id, fornecedorIds));
  const codFornecedor = new Map(fornecedores.map((f) => [f.id, f.codigoExterno]));

  // Resolve categoria -> codigoExterno (Consumer).
  const categoriaIds = [...new Set(Object.values(categoriaPorTipo).filter((v): v is string => !!v))];
  const categorias = categoriaIds.length
    ? await db
        .select({ id: schema.categoriaConta.id, codigoExterno: schema.categoriaConta.codigoExterno })
        .from(schema.categoriaConta)
        .where(inArray(schema.categoriaConta.id, categoriaIds))
    : [];
  const codCategoria = new Map(categorias.map((c) => [c.id, c.codigoExterno]));

  const competencia6 = competencia.replace('-', '').slice(0, 6);

  const comandos: Array<{
    filialId: string;
    tipo: string;
    payload: Record<string, unknown>;
    criadoPor: string;
  }> = [];
  let pulados = 0;

  for (const l of lancamentos) {
    const codForn = codFornecedor.get(l.fornecedorId);
    const catId = categoriaPorTipo[l.tipo];
    const codCat = catId ? codCategoria.get(catId) : null;
    if (codForn == null || codCat == null) {
      pulados++;
      avisos.push(
        `${l.pessoaNome}: lançamento ${l.tipo} não espelhado no Consumer (sem código de ${
          codForn == null ? 'fornecedor' : 'categoria'
        }).`,
      );
      continue;
    }
    comandos.push({
      filialId,
      tipo: 'criar_conta_pagar',
      payload: {
        folhaSemanaId: folhaId,
        codigoFornecedor: codForn,
        codigoCategoria: codCat,
        valor: l.valorBruto,
        descontos: l.desconto > 0 ? l.desconto : null,
        dataVencimento,
        competencia: competencia6,
        descricao: l.descricao.slice(0, 80),
        observacao: (l.detalhe || l.descricao).slice(0, 100),
      },
      criadoPor: userId,
    });
  }

  if (comandos.length > 0) {
    await db.insert(schema.agenteComando).values(comandos);
  }

  return { comandos: comandos.length, pulados, avisos, ligado: true };
}
