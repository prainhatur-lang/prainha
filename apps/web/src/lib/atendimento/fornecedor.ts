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
      // fecha_em no futuro: cotação com janela VENCIDA que ficou 'ABERTA' no
      // banco é zumbi — a Nina mandou o link da nº 3 (fechada em 03/08) pro
      // Jackson em 01/09 e a página recusou a resposta dele.
      sql`${inArray(schema.cotacaoFornecedor.fornecedorId, ids)}
          AND ${schema.cotacaoFornecedor.status} = 'PENDENTE'
          AND ${schema.cotacao.status} = 'ABERTA'
          AND (${schema.cotacao.fechaEm} IS NULL OR ${schema.cotacao.fechaEm} > now())`,
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

/** Cadastro de fornecedor PROSPECT feito pela Nina (pedido do Elison 01/09):
 *  vendedor que chega oferecendo produto/serviço vira cadastro real na
 *  tabela fornecedor (ativo pra compras) e pode ser incluído nas cotações.
 *  Dedupe pelo telefone: se já existe cadastro vivo com esse fone, não
 *  duplica — devolve o nome pro modelo confirmar. */
export async function cadastrarFornecedorProspect(p: {
  filialId: string;
  /** Telefone da conversa (vira fone_principal se o vendedor não der outro). */
  telefoneConversa: string;
  empresa: string;
  produtos: string; // o que vende — vira categoria_compras (texto curto)
  vendedor?: string | null;
  cnpj?: string | null;
  email?: string | null;
  cidade?: string | null;
  telefoneContato?: string | null;
}): Promise<string> {
  const empresa = (p.empresa ?? '').trim().slice(0, 180);
  const produtos = (p.produtos ?? '').trim().slice(0, 90);
  if (empresa.length < 2 || produtos.length < 3) {
    return 'Faltou o nome da EMPRESA ou O QUE ela vende — pergunte ao vendedor e chame de novo com os dois.';
  }
  const fone = (p.telefoneContato ?? '').replace(/\D/g, '') || p.telefoneConversa.replace(/\D/g, '');
  const suf = fone.slice(-8);

  const existentes = (await db.execute(sql`
    SELECT nome FROM fornecedor
    WHERE data_delete IS NULL AND coalesce(nome, '') NOT ILIKE '%exclu%'
      AND (right(regexp_replace(coalesce(fone_principal, ''), '\\D', '', 'g'), 8) = ${suf}
           OR right(regexp_replace(coalesce(fone_secundario, ''), '\\D', '', 'g'), 8) = ${suf})
    LIMIT 1
  `)) as unknown as Array<{ nome: string }>;
  if (existentes.length > 0) {
    return `Este telefone já está cadastrado como fornecedor: ${existentes[0].nome}. Não cadastrei de novo — diga que a empresa já está no nosso sistema de compras e que aparece nas cotações da categoria dela.`;
  }

  const cnpj = (p.cnpj ?? '').replace(/\D/g, '').slice(0, 14) || null;
  await db.insert(schema.fornecedor).values({
    filialId: p.filialId,
    nome: empresa,
    razaoSocial: empresa,
    cnpjOuCpf: cnpj,
    email: (p.email ?? '').trim().slice(0, 200) || null,
    fonePrincipal: fone.slice(0, 20),
    foneWhatsapp: p.telefoneConversa.replace(/\D/g, '').slice(0, 20),
    cidade: (p.cidade ?? '').trim().slice(0, 100) || null,
    categoriaCompras: produtos,
    ativoCompras: true,
  });

  return (
    `FORNECEDOR CADASTRADO: ${empresa} (${produtos})${p.vendedor ? `, vendedor ${p.vendedor}` : ''}${cnpj ? ', com CNPJ' : ', SEM CNPJ (se conseguir, peça e avise a equipe)'}. ` +
    'Confirme ao vendedor que o cadastro foi feito e que a equipe de compras vai incluir a empresa nas próximas cotações da categoria — SEM prometer compra nem valores. Se ele quiser mandar catálogo/tabela, pode enviar aqui mesmo que fica registrado.'
  );
}
