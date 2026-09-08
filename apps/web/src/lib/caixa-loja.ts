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
  const method = opts.method ?? 'GET';
  // Uma tentativa a mais SÓ pra GET (leitura) e só quando a 1ª morreu rápido
  // em erro de rede (DNS/TLS/reset no caminho Vercel → Funnel — o "fetch
  // failed" que a Conferência mostrou em 07/09/2026 com a loja no ar e
  // respondendo em 1 s). Timeout de 20 s não repete: a rota tem maxDuration
  // 30 e a 2ª tentativa estouraria o teto.
  const t0 = Date.now();
  for (let tentativa = 1; ; tentativa++) {
    try {
      const r = await fetch(url, {
        method,
        headers: opts.body ? { 'content-type': 'application/json' } : undefined,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(Math.min(20000, 27000 - (Date.now() - t0))),
      });
      const j = (await r.json().catch(() => null)) as Resp | null;
      if (!j) return { ok: false, erro: `loja respondeu ${r.status} sem JSON` };
      return j;
    } catch (err) {
      const causa = descreverFalha(err);
      console.warn(`[caixa-loja] ${filialId.slice(0, 8)} ${method} ${path.split('?')[0]} tentativa ${tentativa}: ${causa}`);
      const rapido = Date.now() - t0 < 6000;
      const timeout = err instanceof Error && err.name === 'TimeoutError';
      if (tentativa === 1 && method === 'GET' && rapido && !timeout) {
        await new Promise((res) => setTimeout(res, 1500));
        continue;
      }
      return { ok: false, erro: 'Loja fora do ar — ' + causa };
    }
  }
}

/** "fetch failed" sozinho não diz nada; o motivo real (ENOTFOUND, ECONNRESET,
 *  certificado…) vem em err.cause. */
function descreverFalha(err: unknown): string {
  if (!(err instanceof Error)) return 'sem resposta';
  if (err.name === 'TimeoutError') return 'a loja não respondeu em 20 s';
  const c = (err as Error & { cause?: { code?: string; message?: string } }).cause;
  const detalhe = c?.code || c?.message;
  return detalhe ? `${err.message} (${detalhe})` : err.message;
}
