// Pix do BANCO (Sicredi/Inter) gerado pela nuvem pra loja — maquininha e QR da
// mesa (configurador "Pix por", 10/11/2026). A loja não precisa do certificado
// da API Pix: pede aqui e mostra o QR.
//
//   GET ?f&e&acao=criar&valor=<centavos>&ref=<texto>&s   → { ok, txid, copiaECola, qrBase64, status }
//   GET ?f&e&acao=status&txid=<txid>&s                   → { ok, status, e2e, valorCentavos }
//
// Assinatura HMAC PAGAR_MESA_SECRET sobre [f, e, acao, valor|txid, ref?].
// Só funciona pra casa com Pix por Sicredi/Inter.
import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { provedorPixDaFilial } from '@/lib/pagamento-online';
import { bancoDoTxid, createBancoPixPayment, queryBancoPixPayment } from '@/lib/pix-cob';

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
  const acao = sp.get('acao') || '';
  if (!/^[0-9a-f-]{36}$/i.test(f) || !Number.isFinite(e)) {
    return NextResponse.json({ ok: false, erro: 'parâmetros' }, { status: 400 });
  }
  if (e * 1000 < Date.now()) return NextResponse.json({ ok: false, erro: 'expirado' }, { status: 403 });

  try {
    if (acao === 'criar') {
      const valor = Number(sp.get('valor') || 0);
      const ref = (sp.get('ref') || '').slice(0, 60);
      if (!confere([f, String(e), acao, String(sp.get('valor') || ''), ref], s)) {
        return NextResponse.json({ ok: false, erro: 'assinatura' }, { status: 403 });
      }
      if (!Number.isInteger(valor) || valor < 1 || valor > 10_000_000) {
        return NextResponse.json({ ok: false, erro: 'valor' }, { status: 400 });
      }
      const prov = await provedorPixDaFilial(f);
      if (prov !== 'sicredi' && prov !== 'inter') {
        return NextResponse.json({ ok: false, erro: `Pix desta casa é pela ${prov}` }, { status: 409 });
      }
      const r = await createBancoPixPayment(prov, {
        orderId: ref || 'mesa',
        amount: valor,
        customerName: '',
        filialId: f,
        expiraMinutos: 30,
      });
      return NextResponse.json({
        ok: true,
        provedor: prov,
        txid: r.paymentId,
        copiaECola: r.qrCodeString,
        qrBase64: r.qrCodeBase64,
        status: r.status,
      });
    }

    if (acao === 'status') {
      const txid = sp.get('txid') || '';
      if (!confere([f, String(e), acao, txid], s)) {
        return NextResponse.json({ ok: false, erro: 'assinatura' }, { status: 403 });
      }
      const banco = bancoDoTxid(txid);
      if (!banco) return NextResponse.json({ ok: false, erro: 'txid' }, { status: 400 });
      const q = await queryBancoPixPayment(banco, txid, f);
      return NextResponse.json({ ok: true, status: q.status, e2e: q.e2e, valorCentavos: q.valorCentavos, detalhe: q.statusDetail });
    }

    return NextResponse.json({ ok: false, erro: 'acao' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, erro: (err as Error).message.slice(0, 200) }, { status: 502 });
  }
}
