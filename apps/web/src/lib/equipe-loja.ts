// Equipe do Consumer (usuários/permissões do PDV): o web (central) fala com o
// vendas-local da loja pela URL pública (Tailscale Funnel, filial.caixaUrl),
// assinando com o mesmo segredo do canal da NFC-e/caixa (PAGAR_MESA_SECRET),
// só que com escopo 'equipe' — separado do 'caixa' (uma assinatura não abre a
// outra). A loja verifica em centralAssinou(u, 'equipe') e serve
// /api/central/equipe/* (usuarios/criar/permissao/ativo).
//
// Reusa a MESMA URL da Conferência de Caixa (filial.caixaUrl) — é o mesmo
// canal "o Concilia fala com o vendas-local desta filial", só troca o escopo.
import { createHmac } from 'node:crypto';
import { caixaUrlDaFilial } from '@/lib/caixa-loja';

function assinar(filialId: string, e: number): string {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) throw new Error('PAGAR_MESA_SECRET não configurado no servidor');
  return createHmac('sha256', seg).update([filialId, 'equipe', String(e)].join('|')).digest('hex');
}

export interface EquipeUsuario {
  codigo: number;
  login: string;
  nome: string | null;
  tipo: string | null;
  ativo: boolean;
  permissoes: number[];
}

export interface EquipePermissao {
  codigo: number;
  recurso: string;
  descricao: string | null;
}

type Resp = { ok: boolean; erro?: string; [k: string]: unknown };

/** Chama /api/central/equipe{path} da loja, assinado. Nunca lança — devolve
 *  {ok:false,erro} em falha de rede/config/filial sem URL cadastrada. */
export async function chamarLojaEquipe(
  filialId: string,
  path: string,
  opts: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<Resp> {
  const base = await caixaUrlDaFilial(filialId);
  if (!base) {
    return { ok: false, erro: 'Esta filial não tem a URL da loja configurada (a mesma da Conferência de Caixa).' };
  }
  const e = Math.floor(Date.now() / 1000) + 120;
  let s: string;
  try {
    s = assinar(filialId, e);
  } catch (err) {
    return { ok: false, erro: err instanceof Error ? err.message : 'erro ao assinar' };
  }
  const sep = path.includes('?') ? '&' : '?';
  const url = `${base}/api/central/equipe${path}${sep}e=${e}&s=${s}`;
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
