// Descoberta dos números de WhatsApp da Meta (phone_number_id) — o token
// permanente só existe em produção, então listar da máquina não dá: esta rota
// pergunta pra Graph API quais números o token enxerga e devolve o id de cada
// um, pra cadastrar em whatsapp_numero (ex.: o número próprio da Tabuará).
//
// GET  /api/atendimento/numeros-meta            → lista { id, numero, nome, waba }
// POST /api/atendimento/numeros-meta            → vincula { phoneNumberId, filialId, atendenteAtivo? }
// Auth: sessão com a permissão atendimento.config (dá pra abrir o GET no
// navegador logado) ou Authorization: Bearer <CRON_SECRET>.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const token = () => process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_META || '';
const versao = () => process.env.WHATSAPP_API_VERSION || 'v21.0';

async function autorizado(req: Request): Promise<boolean> {
  const esperado = `Bearer ${process.env.CRON_SECRET}`;
  if (process.env.CRON_SECRET && req.headers.get('authorization') === esperado) return true;
  const { error } = await exigirPermApi('atendimento.config');
  return !error;
}

async function graph<T>(caminho: string): Promise<T | { erro: string }> {
  const r = await fetch(`https://graph.facebook.com/${versao()}/${caminho}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  const j = (await r.json().catch(() => null)) as T & { error?: { message?: string } };
  if (!r.ok || !j) return { erro: j?.error?.message ?? `HTTP ${r.status}` };
  return j;
}

export async function GET(req: Request) {
  if (!(await autorizado(req))) return NextResponse.json({ erro: 'nao autorizado' }, { status: 401 });
  if (!token()) return NextResponse.json({ erro: 'WHATSAPP_TOKEN/META ausente' }, { status: 500 });

  // As WABAs que o token alcança vêm do debug_token (granular_scopes do
  // System User); sem elas, dá pra ao menos confirmar o número já cadastrado.
  const dbg = await graph<{
    data?: { granular_scopes?: Array<{ scope?: string; target_ids?: string[] }> };
  }>(`debug_token?input_token=${encodeURIComponent(token())}`);
  const wabas = new Set<string>();
  if (!('erro' in dbg)) {
    for (const g of dbg.data?.granular_scopes ?? []) {
      if (/whatsapp_business/.test(g.scope ?? '')) for (const id of g.target_ids ?? []) wabas.add(id);
    }
  }

  const numeros: Array<{ id: string; numero: string; nome: string; waba: string }> = [];
  for (const waba of wabas) {
    const r = await graph<{
      data?: Array<{ id?: string; display_phone_number?: string; verified_name?: string }>;
    }>(`${waba}/phone_numbers?fields=id,display_phone_number,verified_name&limit=50`);
    if ('erro' in r) continue;
    for (const n of r.data ?? []) {
      if (!n.id) continue;
      numeros.push({
        id: n.id,
        numero: n.display_phone_number ?? '',
        nome: n.verified_name ?? '',
        waba,
      });
    }
  }

  const cadastrados = await db.select().from(schema.whatsappNumero);
  return NextResponse.json({
    wabas: [...wabas],
    numeros,
    cadastrados,
    ...(numeros.length === 0 ? { aviso: 'debug_token nao devolveu WABA', debug: dbg } : {}),
  });
}

export async function POST(req: Request) {
  if (!(await autorizado(req))) return NextResponse.json({ erro: 'nao autorizado' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as {
    phoneNumberId?: string;
    filialId?: string;
    atendenteAtivo?: boolean;
  };
  if (!b.phoneNumberId || !b.filialId) {
    return NextResponse.json({ erro: 'phoneNumberId e filialId obrigatorios' }, { status: 400 });
  }
  const [fil] = await db
    .select({ id: schema.filial.id, nome: schema.filial.nome })
    .from(schema.filial)
    .where(eq(schema.filial.id, b.filialId))
    .limit(1);
  if (!fil) return NextResponse.json({ erro: 'filial nao encontrada' }, { status: 404 });

  const exibicao = await graph<{ display_phone_number?: string }>(
    `${b.phoneNumberId}?fields=display_phone_number`,
  );
  const numero = 'erro' in exibicao ? null : (exibicao.display_phone_number ?? null);

  const valores = {
    phoneNumberId: b.phoneNumberId,
    filialId: b.filialId,
    numeroExibicao: numero ? numero.replace(/\D/g, '').slice(0, 20) : null,
    atendenteAtivo: b.atendenteAtivo === true,
  };
  const [linha] = await db
    .insert(schema.whatsappNumero)
    .values(valores)
    .onConflictDoUpdate({ target: schema.whatsappNumero.phoneNumberId, set: valores })
    .returning();
  return NextResponse.json({ ok: true, filial: fil.nome, numero: linha });
}
