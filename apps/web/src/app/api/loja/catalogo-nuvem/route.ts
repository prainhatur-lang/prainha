// CATÁLOGO QUE NASCEU NA NUVEM → a loja puxa e mistura no cardápio dela.
//
// O catálogo da loja (produto_local) é reconstruído do Firebird a cada 5 min
// com TRUNCATE. Produto criado aqui não existe lá, então sumiria a cada ciclo:
// a loja guarda o que vem daqui numa tabela própria e reinsere junto. É esse
// mesmo caminho que continua valendo quando o Firebird sair do ar — muda só
// quem é a base, não o mecanismo.
//
// Auth: HMAC PAGAR_MESA_SECRET, partes [f, 'catalogo', e].
import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function autoriza(f: string, e: number, s: string) {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return false;
  if (!/^[0-9a-f-]{36}$/i.test(f) || e * 1000 < Date.now()) return false;
  const esperada = createHmac('sha256', seg).update([f, 'catalogo', String(e)].join('|')).digest('hex');
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(s || ''), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const f = sp.get('f') || '';
  if (!autoriza(f, Number(sp.get('e') || 0), sp.get('s') || '')) {
    return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });
  }
  // tudo=1 → o catálogo INTEIRO (modo banco próprio: a loja não tem mais o
  // Firebird pra montar cardápio). Sem o parâmetro, só o que nasceu aqui.
  const tudo = sp.get('tudo') === '1';
  const { db, schema } = await import('@concilia/db');
  const { and, eq, isNull, gt, sql } = await import('drizzle-orm');

  const linhas = await db
    .select({
      codigo_pdv: schema.produtoVariante.codigoExterno,
      produto_codigo: schema.produtoVariante.codigoProdutoExterno,
      nome: schema.produto.nome,
      tamanho: schema.produtoTamanho.descricao,
      preco: schema.produtoVariante.precoVenda,
      area_codigo: schema.produto.codigoCozinha,
      comanda_mobile: schema.produtoVariante.comandaMobile,
      cardapio_digital: schema.produtoVariante.cardapioDigital,
      categoria: schema.produtoEtiqueta.nome,
      descricao: schema.produto.descricao,
      pausado: schema.produtoVariante.dataPausado,
      // saldo é do PRODUTO (o insumo/revenda), não do tamanho — é assim que o
      // motor de baixa trata, e é o que o garçom precisa ver como "esgotou"
      saldo: schema.produto.estoqueAtual,
      controla: schema.produto.controlaEstoque,
    })
    .from(schema.produtoVariante)
    .innerJoin(schema.produto, eq(schema.produto.id, schema.produtoVariante.produtoId))
    .leftJoin(schema.produtoTamanho, eq(schema.produtoTamanho.id, schema.produtoVariante.produtoTamanhoId))
    .leftJoin(
      schema.produtoEtiqueta,
      and(
        eq(schema.produtoEtiqueta.filialId, schema.produto.filialId),
        eq(sql`${schema.produtoEtiqueta.codigoExterno}::text`, schema.produto.codigoEtiqueta),
      ),
    )
    .where(
      and(
        eq(schema.produtoVariante.filialId, f),
        ...(tudo ? [] : [eq(schema.produto.criadoNaNuvem, true)]),
        eq(schema.produto.descontinuado, false),
        isNull(schema.produtoVariante.dataDelete),
        isNull(schema.produtoVariante.dataPausado),
        gt(schema.produtoVariante.precoVenda, '0'),
      ),
    )
    .limit(tudo ? 8000 : 2000);

  // No modo próprio a loja perde TODO o resto do cardápio junto com o
  // Firebird: as praças (COZINHAS), as observações prontas e o wizard. Vão no
  // mesmo pacote — uma volta de rede em vez de quatro.
  const [areas, observacoes, perguntas, opcoes, ligacoes] = tudo
    ? await Promise.all([
        db.select({ codigo: schema.areaProducao.codigoExterno, nome: schema.areaProducao.nome })
          .from(schema.areaProducao).where(eq(schema.areaProducao.filialId, f)),
        db.select({ categoria: schema.observacaoPdv.categoria, texto: schema.observacaoPdv.texto })
          .from(schema.observacaoPdv).where(eq(schema.observacaoPdv.filialId, f)),
        db.select({ codigo: schema.wizardPergunta.codigoExterno, texto: schema.wizardPergunta.texto,
            min: schema.wizardPergunta.respostasMin, max: schema.wizardPergunta.respostasMax })
          .from(schema.wizardPergunta).where(eq(schema.wizardPergunta.filialId, f)),
        db.select({ codigo: schema.wizardOpcao.codigoExterno, pergunta: schema.wizardOpcao.codigoPergunta,
            nome: schema.wizardOpcao.nome, preco: schema.wizardOpcao.precoPromo,
            produto_pdv: schema.wizardOpcao.codigoVarianteExterno })
          .from(schema.wizardOpcao).where(eq(schema.wizardOpcao.filialId, f)),
        db.select({ codigo_pdv: schema.wizardProduto.codigoVarianteExterno,
            pergunta: schema.wizardProduto.codigoPergunta, ordem: schema.wizardProduto.ordem })
          .from(schema.wizardProduto).where(eq(schema.wizardProduto.filialId, f)),
      ])
    : [[], [], [], [], []];

  return NextResponse.json({
    ok: true,
    tudo,
    areas,
    observacoes,
    wizard: { perguntas, opcoes, ligacoes },
    produtos: linhas.map((l) => ({
      codigo_pdv: l.codigo_pdv,
      produto_codigo: l.produto_codigo,
      nome: l.nome,
      tamanho: l.tamanho,
      preco: Number(l.preco),
      area_codigo: l.area_codigo,
      comanda_mobile: l.comanda_mobile !== false,
      cardapio_digital: !!l.cardapio_digital,
      categoria: l.categoria,
      descricao: l.descricao,
      // sem_estoque só faz sentido em produto que controla estoque; no resto
      // fica null e a tela não mostra número nenhum (mesma regra do Firebird)
      saldo: l.controla ? Number(l.saldo ?? 0) : null,
    })),
  });
}
