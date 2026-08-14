// POST /api/cotacao/[id]/interpretar-resposta
// Leitor de cotação por IA: o fornecedor manda os preços por WhatsApp do jeito
// dele ("panko 17,49 / merluza cx 13kg 26,89 o kg..."), o gestor cola o texto
// aqui e o Claude casa cada linha com os itens da cotação — preço, embalagem
// ("esse preço é de quê?"), quantidade por embalagem e marca. NADA é gravado:
// devolve uma proposta que o gestor confere/edita e confirma em
// /api/cotacao/[id]/registrar-resposta.
//
// Body: { cotacaoFornecedorId, texto }
//
// IA: usa ANTHROPIC_API_KEY (Claude, preferido — créditos do dono) quando
// existir; senão cai pra OPENAI_API_KEY (gpt-4o, a mesma chave da Nina, que
// JÁ está na Vercel). Assim o botão funciona hoje sem configurar nada.
//
// Nota: Claude via fetch direto (sem @anthropic-ai/sdk) de propósito — este
// deploy sai de um clone sem node_modules e adicionar dependência sem atualizar
// o pnpm-lock quebraria o build da Vercel. O pacote openai já é dependência.

import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { lerExclusoesPorCotacao } from '@/lib/cotacao-exclusao';

// Opus pensando + 35 itens pode passar de 10s — segura a função até 60s.
export const maxDuration = 60;

const SCHEMA_SAIDA = {
  type: 'object',
  additionalProperties: false,
  required: ['respostas', 'naoIdentificados'],
  properties: {
    respostas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'cotacaoItemId',
          'precoEmbalagem',
          'embalagem',
          'qtdPorEmbalagem',
          'marca',
          'observacao',
          'confianca',
        ],
        properties: {
          cotacaoItemId: { type: 'string' },
          precoEmbalagem: { type: 'number' },
          embalagem: { type: 'string' },
          qtdPorEmbalagem: { type: 'number' },
          marca: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          observacao: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          confianca: { type: 'string', enum: ['alta', 'media', 'baixa'] },
        },
      },
    },
    naoIdentificados: { type: 'array', items: { type: 'string' } },
  },
} as const;

const SYSTEM = `Você interpreta respostas de cotação de fornecedores de um restaurante brasileiro.
Recebe a lista de itens da cotação (JSON) e o texto livre que o fornecedor mandou (WhatsApp).
Sua tarefa: casar cada preço do texto com o item certo da lista.

Regras:
- Preços em reais, vírgula decimal ("17,49" = 17.49). "1749" sem vírgula em contexto de preço quase sempre é 17,49 — use o bom senso pelo valor dos outros itens.
- precoEmbalagem = o preço EXATAMENTE como o fornecedor deu (da embalagem que ele vende).
- embalagem = do que é esse preço, em texto curto: "kg", "un", "garrafa 750 ml", "caixa 12x1L", "fardo 30 kg", "balde 14,5 kg". Se o texto não diz, use a unidade do item.
- qtdPorEmbalagem = quantas unidades DA UNIDADE DO ITEM vêm nessa embalagem. Preço por kg em item de kg → 1. Caixa 12x1L em item de L → 12. Fardo 30 kg em item de kg → 30. Caixa c/ 20 un em item de un → 20. Garrafa avulsa em item de un → 1.
- marca: se o texto indicar (ou se o próprio produto é um rótulo, ex: "Beefeater"), case com uma das marcasAceitas do item quando bater (ignorando acento/caixa). Senão, a marca que o fornecedor escreveu. Se não der pra saber, null.
- Só inclua itens que estão na lista E têm preço no texto. Não invente preço.
- Linhas do texto com preço que não casam com nenhum item da lista vão em naoIdentificados (copie o trecho).
- confianca: "alta" quando nome e preço são inequívocos; "media" quando o casamento é provável; "baixa" quando é chute razoável.`;

interface ItemCtx {
  id: string;
  produto: string;
  quantidade: string;
  unidade: string;
  marcasAceitas: string[];
  embalagemEsperada: string | null;
  classificacao: string | null;
}

/** Chama a IA disponível e devolve o JSON (string) da interpretação.
 *  Claude quando ANTHROPIC_API_KEY existe; senão gpt-4o via OPENAI_API_KEY. */
async function chamarIA(userMsg: string): Promise<string> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 8000,
        // Tarefa mecânica de extração: esforço baixo = resposta em segundos.
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: SCHEMA_SAIDA },
        },
        system: SYSTEM,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
    if (!resp.ok) {
      const errTxt = await resp.text().catch(() => '');
      throw new Error(`Claude HTTP ${resp.status}: ${errTxt.slice(0, 300)}`);
    }
    const data = (await resp.json()) as {
      stop_reason?: string;
      content?: Array<{ type: string; text?: string }>;
    };
    if (data.stop_reason === 'refusal') throw new Error('Claude recusou o texto');
    const texto = data.content?.find((b) => b.type === 'text')?.text;
    if (!texto) throw new Error('Claude nao devolveu texto');
    return texto;
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    const client = new OpenAI({ apiKey: openaiKey });
    const resp = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 8000,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userMsg },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'cotacao_interpretada',
          strict: true,
          schema: SCHEMA_SAIDA as unknown as Record<string, unknown>,
        },
      },
    });
    const msg = resp.choices[0]?.message;
    if (msg?.refusal) throw new Error('gpt-4o recusou o texto');
    if (!msg?.content) throw new Error('gpt-4o nao devolveu texto');
    return msg.content;
  }

  throw new Error(
    'Nenhuma chave de IA configurada (ANTHROPIC_API_KEY ou OPENAI_API_KEY) na Vercel.',
  );
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id: cotacaoId } = await params;
  let body: { cotacaoFornecedorId?: string; texto?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }
  const texto = (body.texto ?? '').trim();
  if (!body.cotacaoFornecedorId || !texto) {
    return NextResponse.json({ error: 'cotacaoFornecedorId e texto obrigatorios' }, { status: 400 });
  }
  if (texto.length > 20000) {
    return NextResponse.json({ error: 'texto grande demais (limite 20 mil caracteres)' }, { status: 400 });
  }

  const [cf] = await db
    .select({ id: schema.cotacaoFornecedor.id })
    .from(schema.cotacaoFornecedor)
    .where(
      and(
        eq(schema.cotacaoFornecedor.id, body.cotacaoFornecedorId),
        eq(schema.cotacaoFornecedor.cotacaoId, cotacaoId),
      ),
    )
    .limit(1);
  if (!cf) return NextResponse.json({ error: 'fornecedor nao convocado nesta cotacao' }, { status: 404 });

  const excluidos = (await lerExclusoesPorCotacao(cotacaoId)).get(cf.id) ?? new Set<string>();
  const itensDb = await db
    .select({
      id: schema.cotacaoItem.id,
      quantidade: schema.cotacaoItem.quantidade,
      unidade: schema.cotacaoItem.unidade,
      marcasAceitas: schema.cotacaoItem.marcasAceitas,
      embalagemEsperada: schema.cotacaoItem.embalagemEsperada,
      classificacao: schema.cotacaoItem.classificacao,
      produtoNome: schema.produto.nome,
    })
    .from(schema.cotacaoItem)
    .innerJoin(schema.produto, eq(schema.produto.id, schema.cotacaoItem.produtoId))
    .where(eq(schema.cotacaoItem.cotacaoId, cotacaoId));

  const itens: ItemCtx[] = itensDb
    .filter((i) => !excluidos.has(i.id))
    .map((i) => ({
      id: i.id,
      produto: i.produtoNome ?? '',
      quantidade: String(Number(i.quantidade)),
      unidade: i.unidade,
      marcasAceitas: (i.marcasAceitas ?? '').split('|').filter(Boolean),
      embalagemEsperada: i.embalagemEsperada,
      classificacao: i.classificacao,
    }));
  if (itens.length === 0) {
    return NextResponse.json({ error: 'cotacao sem itens pra este fornecedor' }, { status: 400 });
  }

  const userMsg =
    `Itens da cotação:\n${JSON.stringify(itens)}\n\n` +
    `Texto do fornecedor:\n"""\n${texto}\n"""`;

  let textoSaida: string;
  try {
    textoSaida = await chamarIA(userMsg);
  } catch (e) {
    console.error('interpretar-resposta: IA falhou', e);
    return NextResponse.json(
      { error: `IA indisponível agora (${e instanceof Error ? e.message : e}). Tente de novo em instantes.` },
      { status: 502 },
    );
  }

  let parsed: {
    respostas: Array<{
      cotacaoItemId: string;
      precoEmbalagem: number;
      embalagem: string;
      qtdPorEmbalagem: number;
      marca: string | null;
      observacao: string | null;
      confianca: 'alta' | 'media' | 'baixa';
    }>;
    naoIdentificados: string[];
  };
  try {
    parsed = JSON.parse(textoSaida);
  } catch {
    return NextResponse.json({ error: 'resposta da IA veio malformada. Tente de novo.' }, { status: 502 });
  }

  // Cinto de segurança: só itens que existem mesmo nesta cotação
  const idsValidos = new Set(itens.map((i) => i.id));
  parsed.respostas = (parsed.respostas ?? []).filter(
    (r) => idsValidos.has(r.cotacaoItemId) && Number(r.precoEmbalagem) > 0,
  );
  parsed.naoIdentificados = parsed.naoIdentificados ?? [];

  return NextResponse.json(parsed);
}
