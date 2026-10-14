// POST /api/notas/ler-chave-foto
// Body: multipart/form-data com 'foto' (JPG reduzido pela tela) + 'filialId'
//       ou, da câmera do celular (/nota-chave, sem login), 'f' 'e' 's' do link assinado
//
// Reserva da câmera da Entrada de notas: quando o código de barras do DANFE
// não sai na foto (borrado, amassado, cortado), a IA lê os 44 números impressos
// embaixo dele. Só devolve a chave se o dígito verificador conferir — quem
// busca na SEFAZ continua sendo /api/notas/buscar-xml (chaveNova).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { chaveNfeValida } from '@/lib/nfe-distribuicao';
import { validarLinkNotaChave } from '@/lib/nota-chave-link';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_SIZE = 4 * 1024 * 1024;
const MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const INSTRUCAO = `Você lê a CHAVE DE ACESSO de um DANFE (nota fiscal eletrônica brasileira) numa foto.
A chave tem 44 números e costuma estar impressa logo abaixo do código de barras, em 11 grupos de 4 ("CHAVE DE ACESSO").
Responda SÓ com os 44 números, sem espaços nem pontos. Não invente número: se algum não estiver legível, responda apenas ILEGIVEL.`;

export async function POST(req: Request) {
  if (!(req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
    return NextResponse.json({ error: 'use multipart/form-data' }, { status: 400 });
  }
  const form = await req.formData();
  // celular pelo link assinado: a filial vem do próprio link
  const peloLink = form.has('s')
    ? validarLinkNotaChave(form.get('f'), form.get('e'), form.get('s'))
    : null;
  if (form.has('s') && !peloLink) {
    return NextResponse.json({ error: 'link vencido — gere outro QR na Entrada de notas' }, { status: 401 });
  }
  const filialId = peloLink ?? (form.get('filialId') as string | null) ?? '';
  const foto = form.get('foto');
  if (!/^[0-9a-f-]{36}$/i.test(filialId)) {
    return NextResponse.json({ error: 'filialId invalido' }, { status: 400 });
  }
  if (!(foto instanceof File)) return NextResponse.json({ error: 'foto ausente' }, { status: 400 });
  const mime = foto.type.toLowerCase() === 'image/jpg' ? 'image/jpeg' : foto.type.toLowerCase();
  if (!MIMES.has(mime)) return NextResponse.json({ error: 'envie uma foto JPG ou PNG' }, { status: 400 });
  if (foto.size > MAX_SIZE) return NextResponse.json({ error: 'foto acima de 4 MB' }, { status: 413 });

  // mesmo acesso de quem traz a nota da SEFAZ (o link assinado só o DONO gera)
  if (!peloLink) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const [link] = await db
      .select({ role: schema.usuarioFilial.role })
      .from(schema.usuarioFilial)
      .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, filialId)))
      .limit(1);
    if (!link || link.role !== 'DONO') {
      return NextResponse.json({ error: 'so DONO pode buscar XML na SEFAZ' }, { status: 403 });
    }
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: 'ANTHROPIC_API_KEY não configurada' }, { status: 500 });

  const data = Buffer.from(await foto.arrayBuffer()).toString('base64');
  let texto = '';
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.CHAVE_FOTO_MODELO || 'claude-opus-5-5',
        max_tokens: 300,
        system: INSTRUCAO,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mime, data } },
              { type: 'text', text: 'Qual é a chave de acesso desta nota?' },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(50_000),
    });
    if (!resp.ok) {
      const errTxt = await resp.text().catch(() => '');
      throw new Error(`Claude HTTP ${resp.status}: ${errTxt.slice(0, 200)}`);
    }
    const r = (await resp.json()) as { content?: Array<{ type: string; text?: string }> };
    texto = (r.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n');
  } catch (e) {
    return NextResponse.json({ error: `a IA não conseguiu ler a foto: ${(e as Error).message}` }, { status: 502 });
  }

  const digitos = texto.replace(/\D/g, '');
  if (/ILEGIVEL/i.test(texto) || digitos.length !== 44) {
    return NextResponse.json({
      error: 'não deu pra ler a chave nessa foto — chegue mais perto do código de barras, com luz e sem tremer',
    });
  }
  if (!chaveNfeValida(digitos)) {
    return NextResponse.json({
      error: 'li os 44 números mas o dígito verificador não confere — tire outra foto mais perto da chave',
      lida: digitos,
    });
  }
  return NextResponse.json({ ok: true, chave: digitos });
}
