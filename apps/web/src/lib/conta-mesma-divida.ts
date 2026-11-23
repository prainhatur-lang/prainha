// Mesma dívida lançada duas vezes (23/11/2026): o boleto do fornecedor (DDA,
// NF-e com duplicata, boleto anexado) e o "pedido sem nota"/conta à mão que
// vira Pix. Sem trava, paga-se as duas. Aqui:
//  - VÍNCULO explícito: conta_pagar.mesma_divida_id (qualquer lado aponta).
//  - PARECIDA: mesma casa, mesmo fornecedor (ou mesma raiz de CNPJ), valor
//    perto (até R$ 1 ou 2%) e vencimento a até 10 dias. Some quando alguém
//    confere que não é a mesma (gemea_conferida_em em qualquer das duas).
// "Paga" = tem data de pagamento, alguma baixa, ou está num borderô.

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

export interface Gemea {
  id: string;
  descricao: string | null;
  valor: number;
  venc: string; // YYYY-MM-DD
  origem: string | null;
  temBoleto: boolean;
  /** Já paga (data de pagamento, baixa) ou num borderô. */
  paga: boolean;
  pagaEm: string | null; // YYYY-MM-DD
  emBordero: boolean;
  /** Ligada de propósito (é a mesma dívida). false = só parecida. */
  vinculo: boolean;
}

type Linha = {
  alvo_id: string;
  id: string;
  descricao: string | null;
  valor: string;
  venc: string;
  origem: string | null;
  tem_boleto: boolean;
  paga: boolean;
  paga_em: string | null;
  em_bordero: boolean;
  vinculo: boolean;
};

/** Gêmeas de cada conta (vinculadas ou parecidas). Conta sem gêmea não entra no mapa. */
export async function gemeasDasContas(contaIds: string[]): Promise<Map<string, Gemea[]>> {
  const out = new Map<string, Gemea[]>();
  const ids = [...new Set(contaIds)].filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (ids.length === 0) return out;
  const lista = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const linhas = (await db.execute(sql`
    WITH alvo AS (
      SELECT c.id, c.filial_id, c.fornecedor_id, c.valor, c.data_vencimento,
             c.descricao, c.origem, c.mesma_divida_id, c.gemea_conferida_em,
             nullif(left(regexp_replace(coalesce(f.cnpj_ou_cpf, ''), '\\D', '', 'g'), 8), '') AS raiz,
             length(regexp_replace(coalesce(f.cnpj_ou_cpf, ''), '\\D', '', 'g')) = 14 AS eh_cnpj
        FROM conta_pagar c
        LEFT JOIN fornecedor f ON f.id = c.fornecedor_id
       WHERE c.id IN (${lista})
    )
    SELECT a.id AS alvo_id, o.id, o.descricao, o.valor::text AS valor,
           o.data_vencimento::text AS venc, o.origem,
           (o.boleto_storage_path IS NOT NULL) AS tem_boleto,
           (o.data_pagamento IS NOT NULL OR o.bordero_id IS NOT NULL
             OR EXISTS (SELECT 1 FROM conta_pagar_baixa b WHERE b.conta_pagar_id = o.id)) AS paga,
           coalesce(o.data_pagamento::text,
             (SELECT max(b.data)::text FROM conta_pagar_baixa b WHERE b.conta_pagar_id = o.id)) AS paga_em,
           (o.bordero_id IS NOT NULL) AS em_bordero,
           (o.id = a.mesma_divida_id OR o.mesma_divida_id = a.id) AS vinculo
      FROM alvo a
      JOIN conta_pagar o
        ON o.id <> a.id
       AND o.data_delete IS NULL
       AND o.filial_id = a.filial_id
      LEFT JOIN fornecedor fo ON fo.id = o.fornecedor_id
     WHERE o.id = a.mesma_divida_id
        OR o.mesma_divida_id = a.id
        OR (
             a.gemea_conferida_em IS NULL AND o.gemea_conferida_em IS NULL
         AND (o.fornecedor_id = a.fornecedor_id
              OR (a.eh_cnpj AND a.raiz IS NOT NULL
                  AND left(regexp_replace(coalesce(fo.cnpj_ou_cpf, ''), '\\D', '', 'g'), 8) = a.raiz))
         AND abs(o.valor - a.valor) <= greatest(0.5, a.valor * 0.01)
         AND abs(o.data_vencimento - a.data_vencimento) <= 7
         -- descrição igual = conta recorrente (quinzena, show, aluguel), não o mesmo boleto
         AND lower(trim(coalesce(o.descricao, ''))) <> lower(trim(coalesce(a.descricao, '')))
         -- despesa da gaveta é dinheiro na mão, não boleto; valor pequeno não vale o aviso
         AND a.valor >= 50
         AND coalesce(o.descricao, '') NOT ILIKE 'Saída do caixa%'
         AND coalesce(a.descricao, '') NOT ILIKE 'Saída do caixa%'
         AND coalesce(o.origem, '') NOT IN ('FOLHA', 'BORDERO', 'TRANSFERENCIA', 'ENCONTRO_CONTAS')
         AND coalesce(a.origem, '') NOT IN ('FOLHA', 'BORDERO', 'TRANSFERENCIA', 'ENCONTRO_CONTAS')
        )
     ORDER BY a.id, o.data_vencimento
  `)) as unknown as Linha[];
  for (const l of linhas) {
    const g: Gemea = {
      id: l.id,
      descricao: l.descricao,
      valor: Number(l.valor),
      venc: l.venc,
      origem: l.origem,
      temBoleto: !!l.tem_boleto,
      paga: !!l.paga,
      pagaEm: l.paga_em,
      emBordero: !!l.em_bordero,
      vinculo: !!l.vinculo,
    };
    const arr = out.get(l.alvo_id);
    if (arr) arr.push(g);
    else out.set(l.alvo_id, [g]);
  }
  return out;
}

/**
 * Trava antes de pagar (Pix pelo sistema ou baixa à mão): a conta tem gêmea
 * já paga? Vinculada → é pagamento em dobro, bloqueia. Só parecida → pede pra
 * conferir antes (é a mesma ou não é?). null = pode pagar.
 */
export async function travaMesmaDivida(contaIds: string[]): Promise<{ tipo: 'vinculada' | 'parecida'; msg: string } | null> {
  const gem = await gemeasDasContas(contaIds);
  const fmt = (g: Gemea) =>
    `${g.descricao ?? 'conta'} de R$ ${g.valor.toFixed(2).replace('.', ',')} (venc ${g.venc.split('-').reverse().join('/')})` +
    (g.emBordero ? ' — está num borderô' : g.pagaEm ? ` — paga em ${g.pagaEm.split('-').reverse().join('/')}` : ' — já paga');
  for (const arr of gem.values()) {
    const v = arr.find((g) => g.vinculo && g.paga);
    if (v) {
      return {
        tipo: 'vinculada',
        msg: `Esta conta é a MESMA dívida de ${fmt(v)}. Pagar de novo é pagar em dobro. Se não for a mesma, desfaça o vínculo na tela de Pedidos a pagar por Pix.`,
      };
    }
  }
  for (const arr of gem.values()) {
    const p = arr.find((g) => !g.vinculo && g.paga);
    if (p) {
      return {
        tipo: 'parecida',
        msg: `Parece a mesma dívida de ${fmt(p)}. Confira antes: na tela de Pedidos a pagar por Pix, marque "é a mesma" (não paga de novo) ou "não é" (libera).`,
      };
    }
  }
  return null;
}

/** Forma efetiva da conta: a da conta por cima da do fornecedor. */
export function formaEfetiva(formaConta: string | null | undefined, formaFornecedor: string | null | undefined): 'boleto' | 'pix' | null {
  const f = formaConta || formaFornecedor || null;
  return f === 'boleto' || f === 'pix' ? f : null;
}
