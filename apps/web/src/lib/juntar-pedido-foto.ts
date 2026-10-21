// Juntar o "📸 Pedido sem nota" na NF-e da SEFAZ da mesma compra.
//
// Até 20/10/2026 o Pedido sem nota aceitava foto/PDF de DANFE e criava uma
// segunda nota (origem PEDIDO_FOTO) pra compra que a SEFAZ já tinha trazido.
// Quase sempre o estoque e a conta (às vezes já paga) ficaram na foto e a NF-e
// oficial ficou parada — a lista mostrava a compra duas vezes.
//
// Juntar = passar pra NF-e tudo o que a foto lançou, sem mexer em estoque nem
// em pagamento:
//   - item a item: produto vinculado, movimentos de estoque e itens de pedido
//     de compra passam pro item da NF-e (pareados pelo valor, senão pela ordem);
//   - contas a pagar da foto passam pra NF-e (pagas continuam pagas);
//   - parcelas: as da NF-e ganham a conta que já existe (ou as da foto passam
//     pra NF-e), pra que "Lançar" na NF-e não crie conta de novo;
//   - conferência, fotos e o resto que aponta pra foto passam pra NF-e;
//   - a foto vai pro registro de exclusão e sai.
// Tudo numa transação: ou junta inteiro, ou nada muda.

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

const TOLERANCIA_VALOR = 0.02; // ±2%, igual à busca de lib/nfe-do-papel

type Linha = Record<string, unknown>;

function rows<T = Linha>(r: unknown): T[] {
  return r as unknown as T[];
}

export interface Gemea {
  id: string;
  numero: string | null;
  serie: string | null;
  origem: string | null;
  emitNome: string | null;
  valorTotal: string | null;
  dataEmissao: string | null;
  /** a foto (PEDIDO_FOTO) do par */
  fotoId: string;
  /** a NF-e da SEFAZ do par */
  nfeId: string;
}

/**
 * Acha a outra metade do par foto × NF-e: mesma casa, mesmo número, mesmo CNPJ
 * (só dígitos) e valor ±2%. Nota cancelada não conta.
 */
export async function acharGemea(notaId: string): Promise<Gemea | null> {
  const r = rows<{
    id: string;
    numero: string | null;
    serie: string | null;
    origem: string | null;
    emit_nome: string | null;
    valor_total: string | null;
    data_emissao: string | null;
    eh_foto: boolean;
  }>(
    await db.execute(sql`
      SELECT o.id, o.numero::text, o.serie::text, o.origem_importacao AS origem, o.emit_nome,
             o.valor_total::text, o.data_emissao::text,
             (n.origem_importacao = 'PEDIDO_FOTO') AS eh_foto
        FROM nota_compra n
        JOIN nota_compra o
          ON o.filial_id = n.filial_id
         AND o.id <> n.id
         AND ltrim(o.numero::text, '0') = ltrim(n.numero::text, '0')
         AND regexp_replace(coalesce(o.emit_cnpj, ''), '\\D', '', 'g') = regexp_replace(coalesce(n.emit_cnpj, ''), '\\D', '', 'g')
         AND regexp_replace(coalesce(n.emit_cnpj, ''), '\\D', '', 'g') <> ''
         AND abs(coalesce(o.valor_total, 0) - coalesce(n.valor_total, 0)) <= greatest(abs(coalesce(n.valor_total, 0)) * ${TOLERANCIA_VALOR}, 0.05)
         AND coalesce(upper(o.situacao), '') NOT LIKE 'CANCEL%'
         AND (o.origem_importacao = 'PEDIDO_FOTO') <> (n.origem_importacao = 'PEDIDO_FOTO')
       WHERE n.id = ${notaId}::uuid
         AND coalesce(n.numero::text, '') <> ''
         AND coalesce(upper(n.situacao), '') NOT LIKE 'CANCEL%'
       ORDER BY abs(coalesce(o.valor_total, 0) - coalesce(n.valor_total, 0)), o.criado_em
       LIMIT 1
    `),
  );
  const g = r[0];
  if (!g) return null;
  return {
    id: g.id,
    numero: g.numero,
    serie: g.serie,
    origem: g.origem,
    emitNome: g.emit_nome,
    valorTotal: g.valor_total,
    dataEmissao: g.data_emissao,
    fotoId: g.eh_foto ? notaId : g.id,
    nfeId: g.eh_foto ? g.id : notaId,
  };
}

export class ErroJuntar extends Error {
  constructor(msg: string, public status = 409) {
    super(msg);
  }
}

export interface ResultadoJuntar {
  fotoId: string;
  nfeId: string;
  itensPareados: number;
  movimentos: number;
  contas: number;
  parcelas: 'ligadas' | 'trocadas' | 'nenhuma';
  fotoVazia: boolean;
}

interface Item {
  id: string;
  numero_item: number | null;
  valor_total: string | null;
  produto_id: string | null;
  qtd_recebida: string | null;
  descricao: string | null;
}

/** Pareia os itens da foto com os da NF-e: primeiro pelo valor (±1 centavo), o resto pela ordem. */
function parear(foto: Item[], nfe: Item[]): Map<string, string> {
  const par = new Map<string, string>();
  const livres = new Set(nfe.map((i) => i.id));
  for (const f of foto) {
    const vf = Number(f.valor_total ?? 0);
    const achou = nfe.find((n) => livres.has(n.id) && Math.abs(Number(n.valor_total ?? 0) - vf) <= 0.011);
    if (achou) {
      par.set(f.id, achou.id);
      livres.delete(achou.id);
    }
  }
  if (foto.length === nfe.length) {
    const restoNfe = nfe.filter((n) => livres.has(n.id));
    const restoFoto = foto.filter((f) => !par.has(f.id));
    restoFoto.forEach((f, i) => {
      const n = restoNfe[i];
      if (n) {
        par.set(f.id, n.id);
        livres.delete(n.id);
      }
    });
  }
  return par;
}

export async function juntarFotoNaNfe(p: {
  fotoId: string;
  nfeId: string;
  usuarioId: string;
  motivo?: string | null;
}): Promise<ResultadoJuntar> {
  return db.transaction(async (tx) => {
    const notas = rows<Linha & { id: string; filial_id: string; origem_importacao: string | null }>(
      await tx.execute(sql`
        SELECT * FROM nota_compra WHERE id IN (${p.fotoId}::uuid, ${p.nfeId}::uuid) FOR UPDATE
      `),
    );
    const foto = notas.find((n) => n.id === p.fotoId);
    const nfe = notas.find((n) => n.id === p.nfeId);
    if (!foto || !nfe) throw new ErroJuntar('nota não encontrada', 404);
    if (foto.filial_id !== nfe.filial_id) throw new ErroJuntar('as duas notas são de casas diferentes');
    if (foto.origem_importacao !== 'PEDIDO_FOTO') throw new ErroJuntar('a primeira nota não é um Pedido sem nota');
    if (nfe.origem_importacao === 'PEDIDO_FOTO') throw new ErroJuntar('a nota de destino também é um Pedido sem nota');
    if (String(nfe.situacao ?? '').toUpperCase().startsWith('CANCEL')) throw new ErroJuntar('a NF-e está cancelada');

    const gemea = await acharGemea(p.fotoId);
    if (!gemea || gemea.nfeId !== p.nfeId) {
      throw new ErroJuntar('as notas não batem (número, CNPJ do fornecedor ou valor ±2%)');
    }

    const itensFoto = rows<Item>(
      await tx.execute(sql`
        SELECT id, numero_item, valor_total::text, produto_id, qtd_recebida::text, descricao
          FROM nota_compra_item WHERE nota_compra_id = ${p.fotoId}::uuid ORDER BY numero_item, id
      `),
    );
    const itensNfe = rows<Item>(
      await tx.execute(sql`
        SELECT id, numero_item, valor_total::text, produto_id, qtd_recebida::text, descricao
          FROM nota_compra_item WHERE nota_compra_id = ${p.nfeId}::uuid ORDER BY numero_item, id
      `),
    );

    // O que cada uma já lançou
    const lancado = async (notaId: string) => {
      const [r] = rows<{ movs: number; contas: number; dups: number }>(
        await tx.execute(sql`
          SELECT
            (SELECT count(*)::int FROM movimento_estoque m JOIN nota_compra_item i ON i.id = m.nota_compra_item_id
              WHERE i.nota_compra_id = ${notaId}::uuid) AS movs,
            (SELECT count(*)::int FROM conta_pagar c WHERE c.nota_compra_id = ${notaId}::uuid AND c.data_delete IS NULL) AS contas,
            (SELECT count(*)::int FROM nota_compra_duplicata d WHERE d.nota_compra_id = ${notaId}::uuid AND d.conta_pagar_id IS NOT NULL) AS dups
        `),
      );
      return r ?? { movs: 0, contas: 0, dups: 0 };
    };
    const lf = await lancado(p.fotoId);
    const ln = await lancado(p.nfeId);
    const fotoVazia = lf.movs === 0 && lf.contas === 0 && lf.dups === 0;
    const nfeVazia = ln.movs === 0 && ln.contas === 0 && ln.dups === 0;
    if (!fotoVazia && !nfeVazia) {
      throw new ErroJuntar(
        'as duas foram lançadas (estoque ou conta nas duas). Exclua o Pedido sem nota pelo botão de excluir, que estorna o estoque dele',
      );
    }

    let itensPareados = 0;
    let movimentos = 0;
    let contas = 0;
    let parcelas: ResultadoJuntar['parcelas'] = 'nenhuma';

    if (!fotoVazia) {
      // ---- itens ----
      const par = parear(itensFoto, itensNfe);
      const comMov = rows<{ item_id: string }>(
        await tx.execute(sql`
          SELECT DISTINCT m.nota_compra_item_id AS item_id FROM movimento_estoque m
            JOIN nota_compra_item i ON i.id = m.nota_compra_item_id
           WHERE i.nota_compra_id = ${p.fotoId}::uuid
        `),
      );
      const semPar = comMov.filter((m) => !par.has(m.item_id));
      if (semPar.length > 0) {
        const nomes = itensFoto.filter((i) => semPar.some((s) => s.item_id === i.id)).map((i) => i.descricao ?? '?');
        throw new ErroJuntar(`não achei na NF-e o item lançado pela foto: ${nomes.join(', ')}`);
      }
      for (const f of itensFoto) {
        const nId = par.get(f.id);
        if (!nId) continue;
        itensPareados++;
        await tx.execute(sql`
          UPDATE nota_compra_item SET
            produto_id = coalesce(produto_id, ${f.produto_id}::uuid),
            qtd_recebida = coalesce(qtd_recebida, ${f.qtd_recebida}::numeric)
           WHERE id = ${nId}::uuid
        `);
        const mv = rows(
          await tx.execute(sql`
            UPDATE movimento_estoque SET nota_compra_item_id = ${nId}::uuid
             WHERE nota_compra_item_id = ${f.id}::uuid RETURNING id
          `),
        );
        movimentos += mv.length;
        await tx.execute(sql`
          UPDATE pedido_compra_item SET nota_compra_item_id = ${nId}::uuid WHERE nota_compra_item_id = ${f.id}::uuid
        `);
      }

      // ---- contas ----
      const cs = rows(
        await tx.execute(sql`
          UPDATE conta_pagar SET nota_compra_id = ${p.nfeId}::uuid WHERE nota_compra_id = ${p.fotoId}::uuid RETURNING id
        `),
      );
      contas = cs.length;

      // ---- parcelas: a NF-e não pode criar a conta de novo no "Lançar" ----
      const dupsFoto = rows<{ id: string; conta_pagar_id: string }>(
        await tx.execute(sql`
          SELECT id, conta_pagar_id FROM nota_compra_duplicata
           WHERE nota_compra_id = ${p.fotoId}::uuid AND conta_pagar_id IS NOT NULL
           ORDER BY data_vencimento, numero
        `),
      );
      const dupsNfe = rows<{ id: string }>(
        await tx.execute(sql`
          SELECT id FROM nota_compra_duplicata
           WHERE nota_compra_id = ${p.nfeId}::uuid AND conta_pagar_id IS NULL
           ORDER BY data_vencimento, numero
        `),
      );
      if (dupsFoto.length > 0) {
        if (dupsNfe.length === dupsFoto.length) {
          for (let i = 0; i < dupsNfe.length; i++) {
            await tx.execute(sql`
              UPDATE nota_compra_duplicata SET conta_pagar_id = ${dupsFoto[i].conta_pagar_id}::uuid WHERE id = ${dupsNfe[i].id}::uuid
            `);
          }
          parcelas = 'ligadas';
        } else {
          // Quantidade diferente: valem as parcelas que viraram conta (as da foto).
          if (dupsNfe.length > 0) {
            await tx.execute(sql`
              DELETE FROM nota_compra_duplicata WHERE nota_compra_id = ${p.nfeId}::uuid AND conta_pagar_id IS NULL
            `);
          }
          await tx.execute(sql`
            UPDATE nota_compra_duplicata SET nota_compra_id = ${p.nfeId}::uuid
             WHERE nota_compra_id = ${p.fotoId}::uuid AND conta_pagar_id IS NOT NULL
          `);
          parcelas = 'trocadas';
        }
      }

      // ---- conferência e fotos ----
      await tx.execute(sql`
        UPDATE nota_compra n SET
          conferida_em = coalesce(n.conferida_em, f.conferida_em),
          conferida_por = coalesce(n.conferida_por, f.conferida_por),
          conferencia_obs = coalesce(n.conferencia_obs, f.conferencia_obs),
          fornecedor_id = coalesce(n.fornecedor_id, f.fornecedor_id)
          FROM nota_compra f
         WHERE n.id = ${p.nfeId}::uuid AND f.id = ${p.fotoId}::uuid
      `);
    }

    // A foto do pedido (e as extras) ficam guardadas na NF-e.
    await tx.execute(sql`
      UPDATE nota_compra n SET fotos_extras = (
        SELECT array_agg(DISTINCT x) FROM unnest(
          coalesce(n.fotos_extras, '{}'::text[])
          || coalesce(f.fotos_extras, '{}'::text[])
          || CASE WHEN coalesce(f.xml_storage_path, '') <> '' THEN ARRAY[f.xml_storage_path] ELSE '{}'::text[] END
        ) AS x WHERE coalesce(x, '') <> ''
      )
        FROM nota_compra f
       WHERE n.id = ${p.nfeId}::uuid AND f.id = ${p.fotoId}::uuid
    `);

    // O resto que aponta pra foto
    await tx.execute(sql`UPDATE nota_chave_leitura SET nota_compra_id = ${p.nfeId}::uuid WHERE nota_compra_id = ${p.fotoId}::uuid`);
    await tx.execute(sql`UPDATE pedido_compra SET nota_compra_id = ${p.nfeId}::uuid WHERE nota_compra_id = ${p.fotoId}::uuid`);
    await tx.execute(sql`UPDATE transferencia_filial SET nota_compra_id = ${p.nfeId}::uuid WHERE nota_compra_id = ${p.fotoId}::uuid`);
    await tx.execute(sql`
      UPDATE nota_compra_boleto_pendente SET nota_compra_id = ${p.nfeId}::uuid WHERE nota_compra_id = ${p.fotoId}::uuid
    `);

    // Registro de exclusão da foto (com tudo o que ela tinha) e tchau.
    const [u] = rows<{ email: string | null }>(
      await tx.execute(sql`SELECT email FROM usuario WHERE id = ${p.usuarioId}::uuid LIMIT 1`),
    );
    const motivo = [
      `juntada com a NF-e nº ${String(nfe.numero ?? '?')} da SEFAZ (DANFE lançado pelo Pedido sem nota)`,
      p.motivo?.trim() || null,
    ]
      .filter(Boolean)
      .join(' — ');
    await tx.execute(sql`
      INSERT INTO registro_exclusao (tabela, registro_id, filial_id, usuario_id, usuario_email, resumo, motivo, dados)
      VALUES ('nota_compra', ${p.fotoId}::uuid, ${foto.filial_id}::uuid, ${p.usuarioId}::uuid, ${u?.email ?? null},
              ${`Pedido sem nota nº ${String(foto.numero ?? '?')} · ${String(foto.emit_nome ?? '')} → NF-e ${String(nfe.chave ?? '')}`},
              ${motivo},
              ${JSON.stringify({ nota: foto, itens: itensFoto, nfeId: p.nfeId, itensPareados, movimentos, contas, parcelas })}::jsonb)
    `);
    await tx.execute(sql`DELETE FROM nota_compra WHERE id = ${p.fotoId}::uuid`);

    return { fotoId: p.fotoId, nfeId: p.nfeId, itensPareados, movimentos, contas, parcelas, fotoVazia };
  });
}

/** Das notas da lista, quais têm a outra metade (foto × NF-e) — pro selo "em dobro". */
export async function idsComGemea(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const r = rows<{ id: string }>(
    await db.execute(sql`
      SELECT DISTINCT n.id
        FROM nota_compra n
        JOIN nota_compra o
          ON o.filial_id = n.filial_id
         AND o.id <> n.id
         AND ltrim(o.numero::text, '0') = ltrim(n.numero::text, '0')
         AND regexp_replace(coalesce(o.emit_cnpj, ''), '\\D', '', 'g') = regexp_replace(coalesce(n.emit_cnpj, ''), '\\D', '', 'g')
         AND regexp_replace(coalesce(n.emit_cnpj, ''), '\\D', '', 'g') <> ''
         AND abs(coalesce(o.valor_total, 0) - coalesce(n.valor_total, 0)) <= greatest(abs(coalesce(n.valor_total, 0)) * ${TOLERANCIA_VALOR}, 0.05)
         AND coalesce(upper(o.situacao), '') NOT LIKE 'CANCEL%'
         AND (o.origem_importacao = 'PEDIDO_FOTO') <> (n.origem_importacao = 'PEDIDO_FOTO')
       WHERE n.id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
         AND coalesce(n.numero::text, '') <> ''
         AND coalesce(upper(n.situacao), '') NOT LIKE 'CANCEL%'
    `),
  );
  return new Set(r.map((x) => x.id));
}
