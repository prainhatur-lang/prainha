// Conferência de Caixa: o web (central) fala com o vendas-local da loja pela URL
// pública (Tailscale Funnel, filial.caixa_url), assinando com o mesmo segredo do
// canal da NFC-e (PAGAR_MESA_SECRET, escopo 'caixa'). A loja verifica em
// centralAssinou() e serve /api/central/caixa/* (relatorio/detalhe/fechar).
import { createHmac } from 'node:crypto';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';

export async function caixaUrlDaFilial(filialId: string): Promise<string | null> {
  const [f] = await db
    .select({ url: schema.filial.caixaUrl })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  const u = f?.url?.trim();
  return u ? u.replace(/\/+$/, '') : null;
}

function assinar(filialId: string, e: number): string {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) throw new Error('PAGAR_MESA_SECRET não configurado no servidor');
  return createHmac('sha256', seg).update([filialId, 'caixa', String(e)].join('|')).digest('hex');
}

type Resp = { ok: boolean; erro?: string; [k: string]: unknown };

/** Chama /api/central/caixa{path} da loja, assinado. `path` já com querystring
 *  do endpoint (ex.: '/relatorio?data=2026-08-19'). Nunca lança — devolve
 *  {ok:false,erro} em falha de rede/config. */
export async function chamarLojaCaixa(
  filialId: string,
  path: string,
  opts: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<Resp> {
  const base = await caixaUrlDaFilial(filialId);
  if (!base) {
    return { ok: false, erro: 'Esta filial não tem a Conferência de Caixa configurada (URL da loja).' };
  }
  const e = Math.floor(Date.now() / 1000) + 120;
  let s: string;
  try {
    s = assinar(filialId, e);
  } catch (err) {
    return { ok: false, erro: err instanceof Error ? err.message : 'erro ao assinar' };
  }
  const sep = path.includes('?') ? '&' : '?';
  const url = `${base}/api/central/caixa${path}${sep}e=${e}&s=${s}`;
  try {
    const r = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: opts.body ? { 'content-type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const j = (await r.json().catch(() => null)) as Resp | null;
    if (!j) return { ok: false, erro: `loja respondeu ${r.status} sem JSON` };
    return j;
  } catch (err) {
    return { ok: false, erro: 'Loja fora do ar — ' + (err instanceof Error ? err.message : 'sem resposta') };
  }
}
