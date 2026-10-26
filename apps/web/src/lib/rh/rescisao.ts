// Rescisão → conta a pagar (26/10/2026).
// O TRCT (ou recibo de acerto) subido na ficha do funcionário é lido pela IA:
// líquido a receber, data de afastamento e data limite do pagamento. O dono
// confere e lança: vira conta a pagar na casa da lotação, no fornecedor ligado
// ao funcionário, categoria "Rescisão Contratual" da casa. Sem data limite no
// termo, vence em afastamento + 10 dias (CLT art. 477 §6).

import { createAdminClient } from '@/lib/supabase/server';
import { BUCKET_DOC_RH, TIPOS_DOC_RESCISAO } from '@/lib/rh/documento-vinculo';
import { hojeBr } from '@/lib/datas';

export { TIPOS_DOC_RESCISAO };

export interface RescisaoLida {
  nome: string | null;
  cpf: string | null;
  dataAfastamento: string | null;
  dataLimite: string | null;
  causa: string | null;
  bruto: number | null;
  descontos: number | null;
  liquido: number | null;
  /** O que a IA achou que não bate ou não leu. */
  aviso: string | null;
}

const INSTRUCAO = `Você lê termos de rescisão de contrato de trabalho brasileiros (TRCT, termo de quitação, recibo de acerto de diarista).
Devolva SÓ um JSON, sem texto em volta:
{"nome": string|null, "cpf": "só dígitos"|null, "dataAfastamento": "AAAA-MM-DD"|null, "dataLimite": "AAAA-MM-DD"|null,
 "causa": string|null, "bruto": number|null, "descontos": number|null, "liquido": number|null, "aviso": string|null}
- "liquido" é o VALOR LÍQUIDO a pagar ao trabalhador (campo "Valor líquido" / "Total líquido"), não o bruto.
- "dataLimite" só se o termo trouxer a data de pagamento/limite; senão null.
- "causa" = causa do afastamento como escrita (ex.: "Dispensa sem justa causa", "Pedido de demissão").
- Números em reais com ponto decimal (1234.56). Não invente: o que não ler, null.
- "aviso": uma frase curta se o arquivo não for rescisão, estiver ilegível ou os totais não fecharem; senão null.
Se não for um documento de rescisão, devolva todos null e explique em "aviso".`;

type Bloco =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };

function mimeDe(nome: string): string | null {
  const ext = nome.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return null;
}

async function chamar(modelo: string, blocos: Bloco[]): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY não configurada');
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: modelo, max_tokens: 800, system: INSTRUCAO, messages: [{ role: 'user', content: blocos }] }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`Claude HTTP ${resp.status}: ${t.slice(0, 300)}`);
  }
  const data = (await resp.json()) as { content?: Array<{ type: string; text?: string }> };
  const texto = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim();
  if (!texto) throw new Error('a IA não devolveu texto');
  return texto;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const s = v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v;
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
const txt = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const ymd = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Baixa o arquivo do bucket e pede pra IA ler o termo. */
export async function lerRescisao(arquivoPath: string, arquivoNome: string | null): Promise<RescisaoLida> {
  const nome = arquivoNome || arquivoPath.split('/').pop() || 'arquivo';
  const mime = mimeDe(nome) ?? mimeDe(arquivoPath);
  if (!mime) throw new Error('não consigo ler esse formato (HEIC?). Suba o termo em PDF, JPG ou PNG.');
  const admin = await createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET_DOC_RH).download(arquivoPath);
  if (error || !data) throw new Error(`não achei o arquivo: ${error?.message ?? 'vazio'}`);
  const b64 = Buffer.from(await data.arrayBuffer()).toString('base64');
  const arquivo: Bloco =
    mime === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
      : { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } };
  const blocos: Bloco[] = [arquivo, { type: 'text', text: `Arquivo: ${nome}. Hoje é ${hojeBr()}. Devolva o JSON.` }];
  const principal = process.env.IMPOSTO_GUIA_MODELO || 'claude-opus-5-5';
  let texto: string;
  try {
    texto = await chamar(principal, blocos);
  } catch (e) {
    const msg = (e as Error).message;
    if (principal === 'claude-sonnet-5' || !/HTTP (400|404)/.test(msg) || !/model/i.test(msg)) throw e;
    texto = await chamar('claude-sonnet-5', blocos);
  }
  const m = texto.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('a IA não devolveu os dados do termo');
  const j = JSON.parse(m[0]) as Record<string, unknown>;
  const cpf = txt(j.cpf)?.replace(/\D/g, '') || null;
  return {
    nome: txt(j.nome),
    cpf: cpf && cpf.length === 11 ? cpf : null,
    dataAfastamento: ymd(j.dataAfastamento),
    dataLimite: ymd(j.dataLimite),
    causa: txt(j.causa),
    bruto: num(j.bruto),
    descontos: num(j.descontos),
    liquido: num(j.liquido),
    aviso: txt(j.aviso),
  };
}

/** Vencimento: data limite do termo; senão afastamento + 10 dias; senão hoje. */
export function vencimentoRescisao(l: Pick<RescisaoLida, 'dataLimite' | 'dataAfastamento'>, desligamento: string | null): string {
  if (l.dataLimite) return l.dataLimite;
  const base = l.dataAfastamento ?? desligamento;
  if (!base) return hojeBr();
  const d = new Date(`${base}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 10);
  return d.toISOString().slice(0, 10);
}
