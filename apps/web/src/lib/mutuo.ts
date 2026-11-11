// Empréstimo (mútuo) entre empresas do sistema — pedido do dono 11/11/2026
// ("a EB Serviços vai emprestar dinheiro para outra loja e depois tem que
// retornar esse dinheiro"). Vive em cima do contas a pagar: ver o cabeçalho de
// packages/db/src/schema/mutuo.ts. Tela: /financeiro/emprestimos.
//
// Não inventa chave Pix: o fornecedor criado aqui entra só com nome e CNPJ; a
// chave é cadastrada/autorizada pelo dono como em qualquer fornecedor.

import { db, schema } from '@concilia/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { recalcularAgregado } from '@/lib/conta-pagar-baixa';
import { registrarExclusao, resumoConta } from '@/lib/registro-exclusao';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class RecusaMutuo extends Error {}

export const ORIGEM_MUTUO = 'MUTUO';

type Empresa = { id: string; nome: string; cnpj: string };

/** Cadastro da `outra` empresa como fornecedor dentro de `filialId` (pelo CNPJ); cria se não tem. */
async function fornecedorDaEmpresa(tx: Tx, filialId: string, outra: Empresa): Promise<string> {
  const cnpj = outra.cnpj.replace(/\D/g, '');
  if (cnpj.length !== 14) throw new RecusaMutuo(`${outra.nome} está sem CNPJ no cadastro da empresa`);
  const [tem] = await tx
    .select({ id: schema.fornecedor.id })
    .from(schema.fornecedor)
    .where(and(
      eq(schema.fornecedor.filialId, filialId),
      isNull(schema.fornecedor.dataDelete),
      sql`regexp_replace(coalesce(${schema.fornecedor.cnpjOuCpf}, ''), '\\D', '', 'g') = ${cnpj}`,
    ))
    .limit(1);
  if (tem) return tem.id;
  const [novo] = await tx
    .insert(schema.fornecedor)
    .values({ filialId, nome: outra.nome.slice(0, 200), cnpjOuCpf: cnpj })
    .returning({ id: schema.fornecedor.id });
  return novo.id;
}

export async function criarMutuo(p: {
  usuarioId: string;
  credora: Empresa;
  devedora: Empresa;
  valor: number;
  /** dia em que o dinheiro foi/vai (YYYY-MM-DD) */
  data: string;
  dataDevolucao: string;
  observacao: string | null;
  /** o dinheiro já saiu da credora: a conta de saída nasce baixada nessa data */
  jaSaiu: boolean;
}): Promise<{ id: string; numero: number }> {
  if (p.credora.id === p.devedora.id) throw new RecusaMutuo('quem empresta e quem recebe são a mesma empresa');
  const valor = Math.round(p.valor * 100) / 100;
  if (!(valor > 0)) throw new RecusaMutuo('valor inválido');
  if (p.dataDevolucao < p.data) throw new RecusaMutuo('a devolução não pode ser antes do empréstimo');
  const agora = new Date();

  return db.transaction(async (tx) => {
    const [m] = await tx
      .insert(schema.mutuo)
      .values({
        filialCredoraId: p.credora.id,
        filialDevedoraId: p.devedora.id,
        data: p.data,
        valor: valor.toFixed(2),
        dataDevolucao: p.dataDevolucao,
        observacao: p.observacao,
        criadoPor: p.usuarioId,
      })
      .returning({ id: schema.mutuo.id, numero: schema.mutuo.numero });

    const fornNaCredora = await fornecedorDaEmpresa(tx, p.credora.id, p.devedora);
    const fornNaDevedora = await fornecedorDaEmpresa(tx, p.devedora.id, p.credora);
    const base = {
      criadoPor: p.usuarioId,
      criadoEm: agora,
      dataCadastro: agora,
      valor: valor.toFixed(2),
      origem: ORIGEM_MUTUO,
      parcela: 1,
      totalParcelas: 1,
      observacao: p.observacao,
    };

    const [saida] = await tx
      .insert(schema.contaPagar)
      .values({
        ...base,
        filialId: p.credora.id,
        fornecedorId: fornNaCredora,
        dataVencimento: p.data,
        competencia: p.data.slice(0, 7),
        descricao: `Empréstimo (mútuo) nº ${m.numero} — para ${p.devedora.nome}`,
      })
      .returning({ id: schema.contaPagar.id });

    const [devolucao] = await tx
      .insert(schema.contaPagar)
      .values({
        ...base,
        filialId: p.devedora.id,
        fornecedorId: fornNaDevedora,
        dataVencimento: p.dataDevolucao,
        competencia: p.dataDevolucao.slice(0, 7),
        descricao: `Devolução do empréstimo (mútuo) nº ${m.numero} — ${p.credora.nome}`,
      })
      .returning({ id: schema.contaPagar.id });

    if (p.jaSaiu) {
      await tx.insert(schema.contaPagarBaixa).values({
        filialId: p.credora.id,
        contaPagarId: saida.id,
        data: p.data,
        valor: valor.toFixed(2),
        observacao: `Mútuo nº ${m.numero}: dinheiro entregue a ${p.devedora.nome}`,
        criadoPor: p.usuarioId,
      });
      await recalcularAgregado(saida.id, valor, tx);
    }

    await tx
      .update(schema.mutuo)
      .set({ contaSaidaId: saida.id, contaDevolucaoId: devolucao.id })
      .where(eq(schema.mutuo.id, m.id));
    return m;
  });
}

/** Cancela um mútuo lançado errado. Só enquanto nada foi devolvido; se o
 *  dinheiro já saiu da credora, a baixa da saída tem que ser estornada antes. */
export async function cancelarMutuo(p: { usuarioId: string; mutuoId: string; motivo: string }) {
  const [m] = await db.select().from(schema.mutuo).where(eq(schema.mutuo.id, p.mutuoId)).limit(1);
  if (!m) throw new RecusaMutuo('empréstimo não encontrado');
  if (m.status === 'CANCELADO') throw new RecusaMutuo('esse empréstimo já foi cancelado');
  const ids = [m.contaSaidaId, m.contaDevolucaoId].filter((x): x is string => !!x);
  const contas = ids.length
    ? ((await db.execute(sql`
        SELECT c.id, c.filial_id, c.descricao, c.data_vencimento::text AS venc, c.valor::text AS valor,
               (SELECT COUNT(*) FROM conta_pagar_baixa b WHERE b.conta_pagar_id = c.id)::int AS baixas
          FROM conta_pagar c
         WHERE c.id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}) AND c.data_delete IS NULL
      `)) as unknown as Array<{ id: string; filial_id: string; descricao: string | null; venc: string; valor: string; baixas: number }>)
    : [];
  const dev = contas.find((c) => c.id === m.contaDevolucaoId);
  const sai = contas.find((c) => c.id === m.contaSaidaId);
  if (dev && dev.baixas > 0) throw new RecusaMutuo('já tem devolução lançada: estorne a baixa da conta de devolução antes de cancelar');
  if (sai && sai.baixas > 0) throw new RecusaMutuo('o dinheiro já saiu: estorne a baixa da conta de saída antes de cancelar');

  for (const c of contas) {
    await registrarExclusao({
      tabela: 'conta_pagar',
      registroId: c.id,
      filialId: c.filial_id,
      usuarioId: p.usuarioId,
      resumo: resumoConta(c.descricao, c.venc, c.valor),
      motivo: `Mútuo nº ${m.numero} cancelado: ${p.motivo}`,
      dados: c,
    });
  }
  const agora = new Date();
  await db.transaction(async (tx) => {
    for (const c of contas) {
      await tx.update(schema.contaPagar).set({ dataDelete: agora }).where(eq(schema.contaPagar.id, c.id));
    }
    await tx
      .update(schema.mutuo)
      .set({ status: 'CANCELADO', canceladoPor: p.usuarioId, canceladoEm: agora, canceladoMotivo: p.motivo })
      .where(eq(schema.mutuo.id, m.id));
  });
}

export type MutuoLinha = {
  id: string;
  numero: number;
  credoraId: string;
  devedoraId: string;
  credora: string;
  devedora: string;
  data: string;
  dataDevolucao: string;
  valor: number;
  observacao: string | null;
  status: string;
  canceladoMotivo: string | null;
  contaSaidaId: string | null;
  contaDevolucaoId: string | null;
  /** o dinheiro já saiu da credora (conta de saída quitada) */
  saiu: boolean;
  /** principal já devolvido (soma das baixas da conta de devolução) */
  devolvido: number;
  saldo: number;
  ultimaDevolucao: string | null;
};

/** Mútuos em que alguma das empresas informadas é credora ou devedora. */
export async function listarMutuos(filialIds: string[]): Promise<MutuoLinha[]> {
  if (!filialIds.length) return [];
  const lista = sql.join(filialIds.map((i) => sql`${i}::uuid`), sql`, `);
  const rows = (await db.execute(sql`
    SELECT m.id, m.numero, m.filial_credora_id, m.filial_devedora_id,
           fc.nome AS credora, fd.nome AS devedora,
           m.data::text AS data, m.data_devolucao::text AS data_devolucao, m.valor::text AS valor,
           m.observacao, m.status, m.cancelado_motivo, m.conta_saida_id, m.conta_devolucao_id,
           (cs.data_pagamento IS NOT NULL) AS saiu,
           COALESCE((SELECT SUM(b.valor) FROM conta_pagar_baixa b WHERE b.conta_pagar_id = m.conta_devolucao_id), 0)::text AS devolvido,
           (SELECT MAX(b.data)::text FROM conta_pagar_baixa b WHERE b.conta_pagar_id = m.conta_devolucao_id) AS ultima
      FROM mutuo m
      JOIN filial fc ON fc.id = m.filial_credora_id
      JOIN filial fd ON fd.id = m.filial_devedora_id
      LEFT JOIN conta_pagar cs ON cs.id = m.conta_saida_id
     WHERE m.filial_credora_id IN (${lista}) OR m.filial_devedora_id IN (${lista})
     ORDER BY (m.status = 'CANCELADO'), m.data DESC, m.numero DESC
     LIMIT 500
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => {
    const valor = Number(r.valor);
    const devolvido = Number(r.devolvido);
    return {
      id: String(r.id),
      numero: Number(r.numero),
      credoraId: String(r.filial_credora_id),
      devedoraId: String(r.filial_devedora_id),
      credora: String(r.credora),
      devedora: String(r.devedora),
      data: String(r.data),
      dataDevolucao: String(r.data_devolucao),
      valor,
      observacao: (r.observacao as string | null) ?? null,
      status: String(r.status),
      canceladoMotivo: (r.cancelado_motivo as string | null) ?? null,
      contaSaidaId: (r.conta_saida_id as string | null) ?? null,
      contaDevolucaoId: (r.conta_devolucao_id as string | null) ?? null,
      saiu: !!r.saiu,
      devolvido,
      saldo: Math.max(0, Math.round((valor - devolvido) * 100) / 100),
      ultimaDevolucao: (r.ultima as string | null) ?? null,
    };
  });
}
