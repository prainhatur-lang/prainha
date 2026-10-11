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

  // AS WABAs QUE O TOKEN ALCANÇA (08/09): o debug_token deste System User
  // devolve os escopos SEM target_ids — permissão ampla, não restrita a uma
  // conta —, então dali não sai WABA nenhuma. O caminho que responde é pelo
  // negócio: /me/businesses → owned/client_whatsapp_business_accounts.
  const diag: Record<string, unknown> = {};
  const wabas = new Map<string, string>(); // id → nome

  const negocios = await graph<{ data?: Array<{ id?: string; name?: string }> }>(
    'me/businesses?fields=id,name&limit=50',
  );
  if ('erro' in negocios) diag.me_businesses = negocios.erro;
  for (const n of 'erro' in negocios ? [] : (negocios.data ?? [])) {
    if (!n.id) continue;
    for (const borda of ['owned_whatsapp_business_accounts', 'client_whatsapp_business_accounts']) {
      const r = await graph<{ data?: Array<{ id?: string; name?: string }> }>(
        `${n.id}/${borda}?fields=id,name&limit=50`,
      );
      if ('erro' in r) {
        diag[`${n.name ?? n.id}/${borda}`] = r.erro;
        continue;
      }
      for (const w of r.data ?? []) if (w.id) wabas.set(w.id, w.name ?? '');
    }
  }

  // Rede de segurança: a WABA do número que já está cadastrado (a Nina).
  if (wabas.size === 0) {
    const atual = await db.select().from(schema.whatsappNumero).limit(1);
    for (const n of atual) {
      const r = await graph<{ id?: string; name?: string }>(
        `${n.phoneNumberId}?fields=whatsapp_business_account{id,name}`,
      );
      if ('erro' in r) diag.pelo_numero_atual = r.erro;
      else if (r.id) wabas.set(r.id, r.name ?? '');
    }
  }

  const numeros: Array<{ id: string; numero: string; nome: string; waba: string }> = [];
  for (const waba of wabas.keys()) {
    const r = await graph<{ data?: Array<{ id?: string; display_phone_number?: string; verified_name?: string }> }>(
      `${waba}/phone_numbers?fields=id,display_phone_number,verified_name&limit=50`,
    );
    if ('erro' in r) {
      diag[`${waba}/phone_numbers`] = r.erro;
      continue;
    }
    for (const n of r.data ?? []) {
      if (n.id) numeros.push({ id: n.id, numero: n.display_phone_number ?? '', nome: n.verified_name ?? '', waba });
    }
  }

  const cadastrados = await db.select().from(schema.whatsappNumero);

  // ESTADO NA META (11/10): o número da Tabuará ficou mais de um mês em
  // "Pendente" no Gerenciador e o prainha Zap caiu pra qualidade "Média", e a
  // lista acima não dizia por quê. Só com ?detalhe=1, pra chamada de sempre
  // continuar igual. Um campo por chamada: campo que a conta não enxerga
  // (name_status é beta) devolve erro só nele, sem derrubar os outros.
  let detalhe: Record<string, unknown> | undefined;
  if (new URL(req.url).searchParams.get('detalhe') === '1') {
    const ids = new Set<string>([...numeros.map((n) => n.id), ...cadastrados.map((c) => c.phoneNumberId)]);
    const porNumero: Record<string, unknown> = {};
    for (const id of ids) porNumero[id] = await campos(id, CAMPOS_NUMERO);
    // A descoberta pelo negócio volta vazia em produção (o token não lista
    // /me/businesses e o número não expõe whatsapp_business_account). A saúde
    // de cada número traz a conta dele — é dali que sai a WABA pra ler os
    // modelos e a nota de cada um.
    for (const d of Object.values(porNumero)) {
      const saude = (d as { health_status?: { entities?: Array<{ entity_type?: string; id?: string }> } })
        .health_status;
      for (const e of saude?.entities ?? []) {
        if (e.entity_type === 'WABA' && e.id && !wabas.has(e.id)) wabas.set(e.id, '');
      }
    }
    const porWaba: Record<string, unknown> = {};
    for (const waba of wabas.keys()) {
      const modelos = await graph<{ data?: unknown[] }>(
        `${waba}/message_templates?fields=name,status,category,language,quality_score&limit=200`,
      );
      porWaba[waba] = {
        ...(await campos(waba, CAMPOS_WABA)),
        modelos: 'erro' in modelos ? { erro: modelos.erro } : (modelos.data ?? []),
      };
    }
    detalhe = { numeros: porNumero, wabas: porWaba };
  }

  return NextResponse.json({
    wabas: [...wabas].map(([id, nome]) => ({ id, nome })),
    numeros,
    cadastrados,
    ...(numeros.length === 0 ? { aviso: 'nenhum numero encontrado', diag } : {}),
    ...(detalhe ? { detalhe } : {}),
  });
}

const CAMPOS_NUMERO = [
  'display_phone_number',
  'verified_name',
  'status',
  'code_verification_status',
  'name_status',
  'new_name_status',
  'platform_type',
  'account_mode',
  'quality_rating',
  'messaging_limit_tier',
  'throughput',
  'is_pin_enabled',
  'health_status',
];
const CAMPOS_WABA = ['name', 'account_review_status', 'business_verification_status', 'health_status'];

async function campos(id: string, lista: string[]): Promise<Record<string, unknown>> {
  const saida: Record<string, unknown> = {};
  await Promise.all(
    lista.map(async (campo) => {
      const r = (await graph<Record<string, unknown>>(`${id}?fields=${campo}`)) as Record<string, unknown>;
      saida[campo] = typeof r.erro === 'string' ? { erro: r.erro } : (r[campo] ?? null);
    }),
  );
  return saida;
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
