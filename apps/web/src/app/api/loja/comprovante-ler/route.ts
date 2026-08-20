// A LOJA manda a foto do comprovante, a nuvem LÊ e devolve os dados.
//
// A leitura mora aqui porque a chave da OpenAI é da nuvem — a loja não tem (e
// não deve ter) credencial de IA no start.bat. Se a internet estiver caída, o
// caixa recebe do mesmo jeito: a foto já é a prova, o OCR só enriquece.
//
// Auth: HMAC PAGAR_MESA_SECRET, partes [f, 'ocr', e].
import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { lerComprovante } from '@/lib/ocr-comprovante';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

function autoriza(f: string, e: number, s: string) {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return false;
  if (!/^[0-9a-f-]{36}$/i.test(f) || e * 1000 < Date.now()) return false;
  const esperada = createHmac('sha256', seg).update([f, 'ocr', String(e)].join('|')).digest('hex');
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(s || ''), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { f?: string; e?: number; s?: string; foto?: string }
    | null;
  if (!body || !autoriza(String(body.f || ''), Number(body.e || 0), String(body.s || ''))) {
    return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });
  }
  const foto = String(body.foto || '');
  // 8 MB de base64 ≈ 6 MB de imagem: o celular já reduz pra ~1280px antes de
  // subir, então isto é só o teto de sanidade.
  if (foto.length > 8_000_000) {
    return NextResponse.json({ ok: false, erro: 'imagem grande demais' }, { status: 413 });
  }
  const dados = await lerComprovante(foto);
  return NextResponse.json({ ok: true, dados });
}
