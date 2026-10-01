// Espaço Kids — a loja pede o acesso ao UniFi Protect dela pra mostrar a câmera
// do kids aos pais (link que só funciona enquanto a criança está dentro; quem
// serve a imagem é o servidor da loja, que está na mesma rede do Protect).
//
// GET ?f&e&s -> { ok, host, chave, url_publica }
//
// Host e chave são os mesmos do alarme (alarme_gatilho; a chave fica cifrada
// aqui e só sai pra loja, com a assinatura dela). `url_publica` é o endereço
// https da loja (filial.caixa_url) — é ele que vai no link do WhatsApp.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { validaLojaKids } from '@/lib/kids';
import { caixaUrlDaFilial } from '@/lib/caixa-loja';
import { decifrar } from '@/lib/segredo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const filial = await validaLojaKids(sp);
  if (!filial) return NextResponse.json({ ok: false, erro: 'assinatura inválida ou expirada' }, { status: 403 });

  const gatilhos = await db
    .select({ host: schema.alarmeGatilho.protectHost, chave: schema.alarmeGatilho.protectApiKey })
    .from(schema.alarmeGatilho)
    .where(eq(schema.alarmeGatilho.filialId, filial.id));
  const g = gatilhos.find((x) => x.host && x.chave);
  if (!g) {
    return NextResponse.json({
      ok: false,
      erro: 'esta casa não tem o UniFi Protect cadastrado (Energia → alarme: IP do Protect + chave da API)',
    });
  }
  let chave: string;
  try {
    chave = decifrar(g.chave!);
  } catch {
    return NextResponse.json({ ok: false, erro: 'não consegui abrir a chave do Protect — salve a chave de novo no alarme' });
  }
  return NextResponse.json(
    { ok: true, host: g.host, chave, url_publica: await caixaUrlDaFilial(filial.id) },
    { headers: { 'cache-control': 'no-store' } },
  );
}
