// FILA DE ALTERAÇÃO DE PRODUTO: a nuvem enfileira, a LOJA aplica.
//
// Mesmo desenho do /api/loja/fiado-fila (que já roda em produção): o Firebird
// é da loja e a nuvem não alcança. O vendas-local pergunta o que mudou (GET),
// aplica em PRODUTOS/PRODUTODETALHE e devolve o resultado (POST).
//
// Auth: assinatura HMAC com PAGAR_MESA_SECRET, partes [f, 'produto', e].
//
// No POST, quando dá certo, o ESPELHO da nuvem é atualizado na hora — senão a
// tela mostraria o valor velho até o CDC passar, e o usuário acharia que não
// funcionou (foi o que aconteceu no fiado antes do aviso de "aguardando").
import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { CAMPOS_PRODUTO } from '@/lib/produto-campos';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function confere(partes: string[], sig: string): boolean {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return false;
  const esperada = createHmac('sha256', seg).update(partes.join('|')).digest('hex');
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(sig || ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function autoriza(f: string, e: number, s: string) {
  return /^[0-9a-f-]{36}$/i.test(f) && e * 1000 >= Date.now() && confere([f, 'produto', String(e)], s);
}

/** GET ?f=&e=&s= — alterações pendentes desta filial (no máximo 30). */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const f = sp.get('f') || '';
  if (!autoriza(f, Number(sp.get('e') || 0), sp.get('s') || '')) {
    return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });
  }
  const { db, schema } = await import('@concilia/db');
  const { and, eq, asc } = await import('drizzle-orm');
  const linhas = await db
    .select({
      id: schema.produtoAlteracao.id,
      produto: schema.produtoAlteracao.produtoCodigoExterno,
      variante: schema.produtoAlteracao.varianteCodigoExterno,
      campo: schema.produtoAlteracao.campo,
      valor: schema.produtoAlteracao.valor,
      alvo_codigo: schema.produtoAlteracao.alvoCodigo,
    })
    .from(schema.produtoAlteracao)
    .where(and(eq(schema.produtoAlteracao.filialId, f), eq(schema.produtoAlteracao.status, 'pendente')))
    .orderBy(asc(schema.produtoAlteracao.criadoEm))
    .limit(30);
  return NextResponse.json({ ok: true, alteracoes: linhas });
}

/** POST — a loja devolve o resultado de uma alteração. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { f?: string; e?: number; s?: string; id?: string; ok?: boolean; erro?: string }
    | null;
  if (!body || !autoriza(String(body.f || ''), Number(body.e || 0), String(body.s || ''))) {
    return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(String(body.id || ''))) {
    return NextResponse.json({ ok: false, erro: 'id inválido' }, { status: 400 });
  }
  const { db, schema } = await import('@concilia/db');
  const { and, eq } = await import('drizzle-orm');
  const filialId = String(body.f);
  const [linha] = await db
    .select()
    .from(schema.produtoAlteracao)
    .where(and(eq(schema.produtoAlteracao.id, String(body.id)), eq(schema.produtoAlteracao.filialId, filialId)))
    .limit(1);
  if (!linha) return NextResponse.json({ ok: false, erro: 'alteração não encontrada' }, { status: 404 });

  await db
    .update(schema.produtoAlteracao)
    .set({
      status: body.ok ? 'aplicado' : 'erro',
      erro: body.ok ? null : String(body.erro || 'falhou na loja').slice(0, 400),
      aplicadoEm: new Date(),
    })
    .where(eq(schema.produtoAlteracao.id, linha.id));

  // Espelho: só quando a loja confirmou. Antes disso o valor da tela é o do
  // Firebird — mentir aqui seria pior que esperar.
  if (body.ok) {
    const def = CAMPOS_PRODUTO[linha.campo];
    const v = linha.valor;
    const bool = v === '1' ? true : v === '0' ? false : null;
    if (def?.alvo === 'produto' && linha.produtoCodigoExterno != null) {
      const set: Record<string, unknown> = {};
      if (linha.campo === 'nome') set.nome = v;
      else if (linha.campo === 'descricao') set.descricao = v;
      else if (linha.campo === 'preco_custo') set.precoCusto = v;
      else if (linha.campo === 'estoque_minimo') set.estoqueMinimo = v;
      else if (linha.campo === 'estoque_controlado') set.estoqueControlado = bool;
      else if (linha.campo === 'descontinuado') set.descontinuado = bool;
      else if (linha.campo === 'categoria') set.codigoEtiqueta = v;
      else if (linha.campo === 'cozinha') set.codigoCozinha = v == null ? null : Number(v);
      if (Object.keys(set).length > 0) {
        await db
          .update(schema.produto)
          .set(set)
          .where(and(
            eq(schema.produto.filialId, filialId),
            eq(schema.produto.codigoExterno, linha.produtoCodigoExterno),
          ));
      }
    } else if ((def?.alvo === 'pergunta' || def?.alvo === 'opcao') && linha.alvoCodigo != null) {
      // O espelho do wizard é substituído inteiro pelo envio da loja logo em
      // seguida; aqui só adianta o campo alterado pra tela não piscar velho.
      if (linha.campo === 'pergunta_texto' || linha.campo === 'pergunta_min' || linha.campo === 'pergunta_max') {
        const set: Record<string, unknown> = {};
        if (linha.campo === 'pergunta_texto') set.texto = v;
        else if (linha.campo === 'pergunta_min') set.respostasMin = Number(v ?? 0);
        else set.respostasMax = Number(v ?? 0);
        await db
          .update(schema.wizardPergunta)
          .set(set)
          .where(and(
            eq(schema.wizardPergunta.filialId, filialId),
            eq(schema.wizardPergunta.codigoExterno, linha.alvoCodigo),
          ));
      } else {
        await db
          .update(schema.wizardOpcao)
          .set(linha.campo === 'opcao_nome' ? { nome: v } : { precoPromo: v ?? '0' })
          .where(and(
            eq(schema.wizardOpcao.filialId, filialId),
            eq(schema.wizardOpcao.codigoExterno, linha.alvoCodigo),
          ));
      }
    } else if (def?.alvo === 'variante' && linha.varianteCodigoExterno != null) {
      const set: Record<string, unknown> = {};
      if (linha.campo === 'preco_venda') set.precoVenda = v;
      else if (linha.campo === 'pausado') set.dataPausado = bool ? new Date() : null;
      else if (linha.campo === 'comanda_mobile') set.comandaMobile = bool;
      else if (linha.campo === 'cardapio_digital') set.cardapioDigital = bool;
      if (Object.keys(set).length > 0) {
        await db
          .update(schema.produtoVariante)
          .set(set)
          .where(and(
            eq(schema.produtoVariante.filialId, filialId),
            eq(schema.produtoVariante.codigoExterno, linha.varianteCodigoExterno),
          ));
      }
    }
  }
  return NextResponse.json({ ok: true });
}
