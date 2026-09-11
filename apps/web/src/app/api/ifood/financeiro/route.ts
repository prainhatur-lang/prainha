// Faturamento do iFood de UMA casa, com a conferência contra o Concilia.
//
//   GET  ?filialId=&de=&ate=&visao=vendas|repasses|eventos
//   POST { filialId, de, ate }   → grava o líquido esperado nos lançamentos
//
// A visão `vendas` é a que importa no dia a dia: cada pedido do iFood ao lado
// do lançamento que nasceu dele no Concilia. Duas coisas aparecem aí e em
// nenhum outro lugar do sistema:
//
//   1. pedido do iFood SEM lançamento — o repasse vai cair no banco sem
//      contrapartida e o dinheiro sai do controle (era o buraco da integração
//      própria, ver api/loja/receber-canal);
//   2. lançamento com bruto diferente do bruto do iFood — em geral pedido
//      alterado depois de fechado.
//
// O casamento é SÓ por `pedido_ref` (= orderId do iFood). Tentar casar pelo
// número curto seria errado: nos lançamentos que vieram pelo Consumer o
// `pedido_numero` é o número do PEDIDOS do Consumer, não o displayId do iFood.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { configIfood } from '@/lib/ifood-credenciais';
import { vendasIfood, repassesIfood, eventosIfood, resumoVendas } from '@/lib/ifood-financeiro';
import { hojeBr, diasAtrasBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function periodo(sp: URLSearchParams): { de: string; ate: string } {
  const de = sp.get('de') ?? '';
  const ate = sp.get('ate') ?? '';
  return {
    de: YMD.test(de) ? de : diasAtrasBr(14),
    ate: YMD.test(ate) ? ate : hojeBr(),
  };
}

/** Credencial da casa + conferência de acesso do usuário. */
async function casa(userId: string, filialId: string) {
  const minhas = await filiaisDoUsuario(userId);
  const filial = minhas.find((f) => f.id === filialId);
  if (!filial) return { erro: NextResponse.json({ error: 'filial' }, { status: 400 }) };
  const c = await configIfood(filialId);
  if (!c.configurada || !c.clientId || !c.clientSecret) {
    return { erro: NextResponse.json({ error: 'esta casa não tem credencial do iFood' }, { status: 400 }) };
  }
  if (!c.merchantId) {
    return { erro: NextResponse.json({ error: 'esta casa não tem merchant_id' }, { status: 400 }) };
  }
  return { filial, c };
}

/** 403 do iFood aqui quer dizer módulo não liberado, não credencial errada. */
function falha(e: unknown) {
  const msg = (e as Error).message ?? String(e);
  const semModulo = /→ 40[31]/.test(msg);
  return NextResponse.json({
    error: semModulo
      ? 'este app ainda não tem o módulo Financeiro liberado no Portal do Desenvolvedor'
      : msg.slice(0, 300),
    semModulo,
  }, { status: semModulo ? 409 : 502 });
}

export async function GET(request: Request) {
  const { user, error } = await exigirPermApi('conta_receber.read');
  if (error) return error;

  const sp = new URL(request.url).searchParams;
  const filialId = sp.get('filialId') ?? '';
  const { erro, filial, c } = await casa(user.id, filialId);
  if (erro) return erro;

  const { de, ate } = periodo(sp);
  const visao = sp.get('visao') ?? 'vendas';
  const base = { filial: { id: filial.id, nome: filial.nome }, de, ate, visao };

  try {
    if (visao === 'repasses') {
      return NextResponse.json({ ...base, ...(await repassesIfood(c, c.merchantId, de, ate)) });
    }
    if (visao === 'eventos') {
      return NextResponse.json({ ...base, ...(await eventosIfood(c, c.merchantId, de, ate)) });
    }

    const vendas = await vendasIfood(c, c.merchantId, de, ate);

    // Lançamentos desta casa que correspondem a estes pedidos.
    const refs = vendas.map((v) => v.orderId).filter(Boolean);
    const lancs = refs.length
      ? await db
          .select({
            id: schema.contaReceberCanal.id,
            pedidoRef: schema.contaReceberCanal.pedidoRef,
            status: schema.contaReceberCanal.status,
            valorBruto: schema.contaReceberCanal.valorBruto,
            valorLiquidoEsperado: schema.contaReceberCanal.valorLiquidoEsperado,
          })
          .from(schema.contaReceberCanal)
          .where(and(
            eq(schema.contaReceberCanal.filialId, filialId),
            inArray(schema.contaReceberCanal.pedidoRef, refs),
          ))
      : [];
    const porRef = new Map(lancs.map((l) => [String(l.pedidoRef), l]));

    const linhas = vendas.map((v) => {
      const l = porRef.get(v.orderId);
      // Pagamento na entrega não gera conta a receber de canal (o dinheiro
      // entrou no caixa da casa), então ausência ali não é problema.
      const naEntrega = v.tipoPagamento === 'OFFLINE';
      const bruto = l ? Number(l.valorBruto) : 0;
      const difere = !!l && Math.abs(bruto - v.bruto) > 0.01;
      return {
        ...v,
        lancamento: l ? l.status : naEntrega ? 'na entrega' : 'sem lançamento',
        lancamentoId: l?.id ?? null,
        brutoConcilia: l ? bruto : null,
        liquidoGravado: l?.valorLiquidoEsperado == null ? null : Number(l.valorLiquidoEsperado),
        problema: !l && !naEntrega && v.status !== 'CANCELLED'
          ? 'pedido do iFood sem conta a receber no Concilia'
          : difere
            ? 'bruto do Concilia difere do bruto do iFood'
            : '',
      };
    });

    return NextResponse.json({
      ...base,
      resumo: resumoVendas(vendas),
      comProblema: linhas.filter((l) => l.problema).length,
      semLiquidoGravado: linhas.filter((l) => l.lancamentoId && l.liquidoGravado == null).length,
      vendas: linhas,
    });
  } catch (e) {
    return falha(e);
  }
}

/** Grava nos lançamentos abertos o líquido que o iFood diz que vai repassar.
 *  Só mexe em `aberto`: baixado/cancelado é trabalho de gente e não se
 *  sobrescreve (mesma regra do /api/loja/receber-canal). */
export async function POST(request: Request) {
  const { user, error } = await exigirPermApi('conta_receber.update');
  if (error) return error;

  const corpo = (await request.json().catch(() => ({}))) as { filialId?: string; de?: string; ate?: string };
  const filialId = String(corpo.filialId ?? '');
  const { erro, c } = await casa(user.id, filialId);
  if (erro) return erro;

  const sp = new URLSearchParams({ de: String(corpo.de ?? ''), ate: String(corpo.ate ?? '') });
  const { de, ate } = periodo(sp);

  try {
    const vendas = await vendasIfood(c, c.merchantId, de, ate);
    let gravados = 0;
    for (const v of vendas) {
      if (!v.orderId || v.tipoPagamento === 'OFFLINE' || v.status === 'CANCELLED') continue;
      const r = await db
        .update(schema.contaReceberCanal)
        .set({ valorLiquidoEsperado: v.liquido.toFixed(2), atualizadoEm: new Date() })
        .where(and(
          eq(schema.contaReceberCanal.filialId, filialId),
          eq(schema.contaReceberCanal.pedidoRef, v.orderId),
          eq(schema.contaReceberCanal.status, 'aberto'),
        ))
        .returning({ id: schema.contaReceberCanal.id });
      gravados += r.length;
    }
    return NextResponse.json({ ok: true, gravados, pedidos: vendas.length });
  } catch (e) {
    return falha(e);
  }
}
