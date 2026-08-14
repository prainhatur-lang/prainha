// Modo FORNECEDOR da Nina: o mesmo número dispara cotações e pedidos de
// compra — quando um fornecedor cadastrado responde com dúvida, a Nina lê as
// cotações pendentes dele e explica (itens, unidades, embalagem, link de
// resposta). Negociação (preço/prazo/quantidade/condição) → equipe.

import { db, schema } from '@concilia/db';
import { desc, eq, inArray, sql } from 'drizzle-orm';

/** Cotações pendentes + pedidos recentes do fornecedor dono deste telefone.
 *  Texto pro modelo — links e itens oficiais, nada de inventar. */
export async function consultarCotacoesFornecedor(telefone: string): Promise<string> {
  const suf = telefone.replace(/\D/g, '').slice(-8);
  if (suf.length < 8) return 'Telefone inválido — transfira pra equipe.';

  const fornecedores = (await db.execute(sql`
    SELECT f.id, f.nome, fil.nome AS filial
    FROM fornecedor f
    JOIN filial fil ON fil.id = f.filial_id
    WHERE right(regexp_replace(coalesce(f.fone_principal, ''), '\\D', '', 'g'), 8) = ${suf}
       OR right(regexp_replace(coalesce(f.fone_secundario, ''), '\\D', '', 'g'), 8) = ${suf}
  `)) as unknown as Array<{ id: string; nome: string; filial: string }>;
  if (fornecedores.length === 0) {
    return 'Nenhum fornecedor cadastrado com este telefone — transfira pra equipe de compras.';
  }
  const ids = fornecedores.map((f) => f.id);
  const nomeForn = fornecedores[0].nome;

  // Cotações que ele ainda não respondeu (cotação aberta)
  const pendentes = await db
    .select({
      cotacaoId: schema.cotacaoFornecedor.cotacaoId,
      token: schema.cotacaoFornecedor.tokenPublico,
      statusResposta: schema.cotacaoFornecedor.status,
      numero: schema.cotacao.numero,
      statusCotacao: schema.cotacao.status,
    })
    .from(schema.cotacaoFornecedor)
    .innerJoin(schema.cotacao, eq(schema.cotacao.id, schema.cotacaoFornecedor.cotacaoId))
    .where(
      sql`${inArray(schema.cotacaoFornecedor.fornecedorId, ids)}
          AND ${schema.cotacaoFornecedor.status} = 'PENDENTE'
          AND ${schema.cotacao.status} = 'ABERTA'`,
    )
    .orderBy(desc(schema.cotacao.numero))
    .limit(3);

  const blocos: string[] = [`Fornecedor identificado: ${nomeForn}.`];

  if (pendentes.length === 0) {
    blocos.push('Nenhuma cotação pendente de resposta agora.');
  }
  for (const c of pendentes) {
    const itens = (await db.execute(sql`
      SELECT COALESCE(p.nome, 'item') AS nome, ci.quantidade::float AS qtd, ci.unidade,
             ci.embalagem_esperada, ci.marcas_aceitas, ci.observacao
      FROM cotacao_item ci
      LEFT JOIN produto p ON p.id = ci.produto_id
      WHERE ci.cotacao_id = ${c.cotacaoId}
      ORDER BY p.nome
      LIMIT 25
    `)) as unknown as Array<{
      nome: string;
      qtd: number;
      unidade: string;
      embalagem_esperada: string | null;
      marcas_aceitas: string | null;
      observacao: string | null;
    }>;
    const linhas = itens
      .map((i) => {
        const extras = [
          i.embalagem_esperada ? `embalagem: ${i.embalagem_esperada}` : null,
          i.marcas_aceitas ? `marcas aceitas: ${i.marcas_aceitas.split('|').join(', ')}` : null,
          i.observacao ? `obs: ${i.observacao}` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return `  - ${i.nome}: ${i.qtd} ${i.unidade}${extras ? ` (${extras})` : ''}`;
      })
      .join('\n');
    blocos.push(
      `COTAÇÃO Nº ${c.numero} (aguardando a resposta dele):\n${linhas}\n  Link pra responder com os preços: https://app.prainhabar.com/cotacao/preencher/${c.token}\n  Como funciona: abre o link, preenche o preço de cada item que tiver (pode deixar em branco o que não trabalha) e envia.`,
    );
  }

  // Pedidos de compra recentes (contexto de "e o pedido?")
  const pedidos = await db
    .select({
      numero: schema.pedidoCompra.numero,
      status: schema.pedidoCompra.status,
    })
    .from(schema.pedidoCompra)
    .where(inArray(schema.pedidoCompra.fornecedorId, ids))
    .orderBy(desc(schema.pedidoCompra.criadoEm))
    .limit(3);
  if (pedidos.length > 0) {
    blocos.push(
      `Pedidos de compra recentes: ${pedidos.map((p) => `nº ${p.numero} (${p.status})`).join('; ')}.`,
    );
  }

  return blocos.join('\n\n');
}
