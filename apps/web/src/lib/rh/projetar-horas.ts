// Ponte ponto_batida -> ponto_dia -> folha_horas. Idempotente: pode rodar
// quantas vezes quiser pro mesmo intervalo, sempre chega no mesmo estado.
//
// lib/folha/calcular.ts (motor de comissão) NÃO é tocado — só passa a
// receber linhas de folha_horas com uma origem a mais ('ponto_proprio'),
// convivendo com 'espelho' (upload manual, ainda ativo na transição) e
// 'manual' (correção humana, que a cláusula setWhere abaixo NUNCA sobrescreve).

import { db, schema } from '@concilia/db';
import { and, eq, gte, lte, isNull, sql } from 'drizzle-orm';
import { calcularDia, type Batida } from './calcular-ponto';
import { semanaContemDia } from '@/lib/folha/semana';

export interface ResultadoProjecao {
  diasCalculados: number;
  linhasFolha: number;
  /** Nomes de funcionário sem fornecedor correspondente na filial — a tela
   *  de ponto mostra "sem vínculo de folha" pra esses, sem quebrar nada. */
  semVinculo: string[];
}

/** Reconstrói ponto_dia e projeta em folha_horas pro intervalo [de, ate]
 *  (YYYY-MM-DD, inclusive) de uma filial. */
export async function projetarPontoEmFolhaHoras(
  filialId: string,
  de: string,
  ate: string,
): Promise<ResultadoProjecao> {
  const batidas = await db
    .select({
      funcionarioId: schema.pontoBatida.funcionarioId,
      quando: schema.pontoBatida.quando,
      diaOperacional: schema.pontoBatida.diaOperacional,
      tipo: schema.pontoBatida.tipo,
    })
    .from(schema.pontoBatida)
    .where(
      and(
        eq(schema.pontoBatida.filialId, filialId),
        gte(schema.pontoBatida.diaOperacional, de),
        lte(schema.pontoBatida.diaOperacional, ate),
        isNull(schema.pontoBatida.excluidaEm),
      ),
    );

  const grupos = new Map<string, Batida[]>(); // chave: `${funcionarioId}|${dia}`
  for (const b of batidas) {
    const chave = `${b.funcionarioId}|${b.diaOperacional}`;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave)!.push({ quando: b.quando, tipo: b.tipo as 'entrada' | 'saida' });
  }

  const semVinculo = new Set<string>();
  let linhasFolha = 0;

  for (const [chave, bs] of grupos) {
    const [funcionarioId, dia] = chave.split('|');
    const calc = calcularDia(bs);

    await db
      .insert(schema.pontoDia)
      .values({ filialId, funcionarioId, dia, totalMin: calc.totalMin, status: calc.status, pares: calc.pares })
      .onConflictDoUpdate({
        target: [schema.pontoDia.filialId, schema.pontoDia.funcionarioId, schema.pontoDia.dia],
        set: { totalMin: calc.totalMin, status: calc.status, pares: calc.pares, calculadoEm: new Date() },
      });

    const fornecedorId = await resolverFornecedor(filialId, funcionarioId);
    if (!fornecedorId) {
      const [func] = await db
        .select({ nome: schema.funcionario.nome })
        .from(schema.funcionario)
        .where(eq(schema.funcionario.id, funcionarioId))
        .limit(1);
      semVinculo.add(func?.nome ?? funcionarioId);
      continue;
    }

    // Folha fechada é snapshot imutável (regra do projeto) — pula se a
    // semana não existir ainda ou já não estiver mais aberta.
    const { inicio } = semanaContemDia(new Date(dia + 'T12:00:00'));
    const [folha] = await db
      .select({ id: schema.folhaSemana.id, status: schema.folhaSemana.status })
      .from(schema.folhaSemana)
      .where(and(eq(schema.folhaSemana.filialId, filialId), eq(schema.folhaSemana.dataInicio, inicio)))
      .limit(1);
    if (!folha || folha.status !== 'aberta') continue;

    await db
      .insert(schema.folhaHoras)
      .values({ folhaSemanaId: folha.id, fornecedorId, dia, totalMin: calc.totalMin, origem: 'ponto_proprio' })
      .onConflictDoUpdate({
        target: [schema.folhaHoras.folhaSemanaId, schema.folhaHoras.fornecedorId, schema.folhaHoras.dia],
        set: { totalMin: sql`excluded.total_min`, origem: sql`excluded.origem` },
        // Correção humana NUNCA é sobrescrita pelo robô.
        setWhere: sql`${schema.folhaHoras.origem} <> 'manual'`,
      });
    linhasFolha++;
  }

  return { diasCalculados: grupos.size, linhasFolha, semVinculo: [...semVinculo] };
}

/** funcionario -> fornecedor DENTRO da filial da batida: FK direta primeiro
 *  (quando a filial bate), senão casa por CPF — cobre quem trabalha em duas
 *  casas sem precisar de tabela nova. */
async function resolverFornecedor(filialId: string, funcionarioId: string): Promise<string | null> {
  const [func] = await db
    .select({ fornecedorId: schema.funcionario.fornecedorId, cpf: schema.funcionario.cpf })
    .from(schema.funcionario)
    .where(eq(schema.funcionario.id, funcionarioId))
    .limit(1);
  if (!func) return null;

  if (func.fornecedorId) {
    const [f] = await db
      .select({ id: schema.fornecedor.id })
      .from(schema.fornecedor)
      .where(and(eq(schema.fornecedor.id, func.fornecedorId), eq(schema.fornecedor.filialId, filialId)))
      .limit(1);
    if (f) return f.id;
  }
  if (func.cpf) {
    const [f] = await db
      .select({ id: schema.fornecedor.id })
      .from(schema.fornecedor)
      .innerJoin(schema.fornecedorFolha, eq(schema.fornecedorFolha.fornecedorId, schema.fornecedor.id))
      .where(and(eq(schema.fornecedor.filialId, filialId), eq(schema.fornecedor.cnpjOuCpf, func.cpf)))
      .limit(1);
    if (f) return f.id;
  }
  return null;
}
