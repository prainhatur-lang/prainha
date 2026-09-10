// A fila do iFood que a LOJA puxa quando quem fala com o iFood é a nuvem.
//
//   GET  ?f=<filial>&e=<expira>&s=<assinatura>  → eventos ainda não entregues
//                                                  + o pedido já baixado
//   POST ?f=&e=&s=  { feitos: [eventoId] }      → a loja processou estes
//   POST ?f=&e=&s=  { orderId, acao, extra }    → repassa a ação pro iFood
//
// Mesma assinatura HMAC do /pagar-mesa, /ifood-config e /delivery-fila, que o
// vendas-local já tem configurada. A filial vai ASSINADA: uma casa não lê nem
// mexe no pedido da vizinha, nem trocando o id na mão.
//
// A loja nunca fala com a API do iFood neste modo — nem pra ler nem pra
// confirmar. Credencial só na nuvem, fila só de um dono.

import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, schema } from '@concilia/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { configIfood } from '@/lib/ifood-credenciais';
import { ifoodApi, IFOOD_ACOES } from '@/lib/ifood-api';
import { marcarEntregues } from '@/lib/ifood-puxador';

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

function autorizar(request: Request): { filialId: string } | { erro: NextResponse } {
  const sp = new URL(request.url).searchParams;
  const f = sp.get('f') || '';
  const e = Number(sp.get('e') || 0);
  const s = sp.get('s') || '';
  if (!f || !Number.isFinite(e)) return { erro: NextResponse.json({ error: 'parâmetros' }, { status: 400 }) };
  if (e * 1000 < Date.now()) return { erro: NextResponse.json({ error: 'expirado' }, { status: 403 }) };
  if (!confere([f, String(e)], s)) return { erro: NextResponse.json({ error: 'assinatura' }, { status: 403 }) };
  return { filialId: f };
}

export async function GET(request: Request) {
  const auth = autorizar(request);
  if ('erro' in auth) return auth.erro;

  const eventos = await db
    .select({
      id: schema.ifoodNuvemEvento.id,
      orderId: schema.ifoodNuvemEvento.orderId,
      codigo: schema.ifoodNuvemEvento.codigo,
      fullCode: schema.ifoodNuvemEvento.fullCode,
      ocorridoEm: schema.ifoodNuvemEvento.ocorridoEm,
    })
    .from(schema.ifoodNuvemEvento)
    .where(and(
      eq(schema.ifoodNuvemEvento.filialId, auth.filialId),
      isNull(schema.ifoodNuvemEvento.entregueEm),
    ))
    .orderBy(asc(schema.ifoodNuvemEvento.criadoEm))
    .limit(50);

  if (!eventos.length) return NextResponse.json({ ok: true, eventos: [], pedidos: {} });

  // O payload vai junto: a loja projeta a comanda daqui sem chamar o iFood.
  const ids = [...new Set(eventos.map((e) => e.orderId))];
  const peds = await db
    .select({ orderId: schema.ifoodNuvemPedido.orderId, payload: schema.ifoodNuvemPedido.payload })
    .from(schema.ifoodNuvemPedido)
    .where(and(
      eq(schema.ifoodNuvemPedido.filialId, auth.filialId),
      inArray(schema.ifoodNuvemPedido.orderId, ids),
    ));

  const pedidos: Record<string, unknown> = {};
  for (const p of peds) pedidos[p.orderId] = p.payload;

  return NextResponse.json({ ok: true, eventos, pedidos });
}

export async function POST(request: Request) {
  const auth = autorizar(request);
  if ('erro' in auth) return auth.erro;

  const b = await request.json().catch(() => null);

  // 1) "processei estes eventos" — só depois disso eles saem da fila.
  //    O aviso vem DEPOIS de gravar na loja: se a loja cair no meio, o evento
  //    volta no próximo ciclo (o PK de lá impede duplicar).
  if (Array.isArray(b?.feitos)) {
    const ids = (b.feitos as unknown[]).filter((x): x is string => typeof x === 'string');
    await marcarEntregues(auth.filialId, ids);
    return NextResponse.json({ ok: true, feitos: ids.length });
  }

  // 2) ação do caixa (aceitar, despachar, cancelar…) — quem fala com o iFood
  //    é a nuvem, porque a credencial mora só aqui.
  const orderId = typeof b?.orderId === 'string' ? b.orderId : '';
  const acao = typeof b?.acao === 'string' ? b.acao : '';
  if (!orderId || !acao) return NextResponse.json({ error: 'orderId e acao' }, { status: 400 });

  // O pedido tem que ser DESTA filial: id na mão não vira comando na casa
  // vizinha.
  const [ped] = await db
    .select({ orderId: schema.ifoodNuvemPedido.orderId })
    .from(schema.ifoodNuvemPedido)
    .where(and(
      eq(schema.ifoodNuvemPedido.orderId, orderId),
      eq(schema.ifoodNuvemPedido.filialId, auth.filialId),
    ))
    .limit(1);
  if (!ped) return NextResponse.json({ error: 'pedido não é desta filial' }, { status: 404 });

  const c = await configIfood(auth.filialId);
  if (!c.clientId || !c.clientSecret) return NextResponse.json({ error: 'filial sem credencial' }, { status: 400 });
  const cred = { clientId: c.clientId, clientSecret: c.clientSecret };
  const url = '/order/v1.0/orders/' + encodeURIComponent(orderId);

  // Motivos de cancelamento: a lista tem que sair do iFood pra AQUELE pedido
  // (critério de homologação — o PDV não inventa código).
  if (acao === 'motivos_cancel') {
    const r = (await ifoodApi(cred, url + '/cancellationReasons')) as unknown;
    const lista = (Array.isArray(r) ? r : ((r as { reasons?: unknown[] })?.reasons ?? [])) as Array<Record<string, string>>;
    return NextResponse.json({
      ok: true,
      motivos: lista.map((m) => ({
        codigo: m.cancelCodeId || m.code || m.cancellationCode,
        descricao: m.description || m.reason,
      })),
    });
  }

  const caminho = IFOOD_ACOES[acao];
  if (!caminho) return NextResponse.json({ error: 'ação desconhecida' }, { status: 400 });

  const extra = (b?.extra ?? null) as Record<string, string> | null;
  try {
    if (acao === 'cancelar') {
      const cod = String(extra?.codigo || '').trim();
      if (!cod) return NextResponse.json({ error: 'escolha o motivo do cancelamento' }, { status: 400 });
      // A doc do iFood aparece nas DUAS formas ({reason, cancellationCode} e
      // {reason: "<código>"}). Manda a primeira e repete na segunda se cair —
      // cancelamento é raro e não pode falhar por nome de campo.
      try {
        await ifoodApi(cred, url + '/' + caminho, {
          metodo: 'POST',
          corpo: { reason: extra?.descricao || 'cancelamento pela loja', cancellationCode: cod },
        });
      } catch (e) {
        if (!/ 4\d\d/.test(String((e as Error).message))) throw e;
        await ifoodApi(cred, url + '/' + caminho, { metodo: 'POST', corpo: { reason: cod } });
      }
      return NextResponse.json({ ok: true });
    }
    await ifoodApi(cred, url + '/' + caminho, { metodo: 'POST', corpo: extra });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message).slice(0, 300) }, { status: 502 });
  }
  // O iFood responde 202: o status só vale de verdade quando o evento
  // correspondente voltar no polling.
  return NextResponse.json({ ok: true });
}
