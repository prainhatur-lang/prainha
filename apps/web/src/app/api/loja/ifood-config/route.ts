// A config do iFood que a LOJA puxa do Concilia.
//
//   GET ?f=<filial>&e=<expira>&s=<assinatura>
//
// O vendas-local não tem sessão aqui: a autorização é a mesma assinatura HMAC
// do /pagar-mesa e do /cliente-documento, que a loja já tem configurada.
//
// ⚠️ Esta rota devolve o client_secret do iFood EM CLARO — é o único jeito da
// loja se autenticar na API do iFood. Por isso: HTTPS, assinatura com prazo, e
// a filial vem assinada (a loja não pode pedir a credencial da casa vizinha).
// Quem tem o PAGAR_MESA_SECRET já lê a base de clientes do grupo, então o
// nível de confiança do canal é o mesmo — mas vale saber o que trafega.

import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { configIfood } from '@/lib/ifood-credenciais';

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

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const f = sp.get('f') || '';
  const e = Number(sp.get('e') || 0);
  const s = sp.get('s') || '';

  if (!f || !Number.isFinite(e)) return NextResponse.json({ error: 'parâmetros' }, { status: 400 });
  // Assinatura com prazo: link vazado não vira acesso permanente.
  if (e * 1000 < Date.now()) return NextResponse.json({ error: 'expirado' }, { status: 403 });
  if (!confere([f, String(e)], s)) return NextResponse.json({ error: 'assinatura' }, { status: 403 });

  const c = await configIfood(f);
  // Filial sem cadastro volta configurada=false e a loja NÃO mexe no que tem
  // gravado — assim ligar o configurador não apaga a config de quem já estava
  // rodando com ajuste local.
  return NextResponse.json({
    configurada: c.configurada,
    ativo: c.ativo,
    modo: c.modo,
    codigo_pdv: c.codigoPdv,
    auto_confirmar: c.autoConfirmar,
    client_id: c.clientId,
    client_secret: c.clientSecret,
    merchant_id: c.merchantId,
  });
}
