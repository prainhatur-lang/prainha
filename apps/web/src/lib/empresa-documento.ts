// Documentos da empresa por casa (26/10/2026) — tabela empresa_documento.
// Pedido do dono: "da opcao para subir documentos como alvara etc. vendo as
// validades e avisando quando estiver proximo de expirar".
//
// O dono sobe o PDF/foto, a IA lê tipo, número, órgão, emissão e validade
// (mesmo padrão de lib/rh/rescisao.ts) e descobre a casa pelo CNPJ. O dono
// confere e salva. Aviso em faixas de 30, 15 e 7 dias e vencido — na tela
// /empresa/documentos e no relatório diário (que vai pelo WhatsApp).

import { hojeBr } from '@/lib/datas';

export const BUCKET_DOC_EMPRESA = 'extratos-fechamento';
export const DOC_EMPRESA_TAMANHO_MAX = 25 * 1024 * 1024;
export const DOC_EMPRESA_EXTENSOES = ['jpg', 'jpeg', 'png', 'webp', 'pdf'];
export const pastaDocEmpresa = (organizacaoId: string) => `empresa-documentos/${organizacaoId}`;

export interface TipoDocEmpresa {
  tipo: string;
  rotulo: string;
  /** Costuma não ter validade (cartão CNPJ, inscrição). */
  semVencimento?: boolean;
}

export const TIPOS_DOC_EMPRESA: TipoDocEmpresa[] = [
  { tipo: 'alvara_funcionamento', rotulo: 'Alvará de funcionamento' },
  { tipo: 'alvara_sanitario', rotulo: 'Alvará sanitário (Vigilância)' },
  { tipo: 'avcb', rotulo: 'AVCB / Bombeiros' },
  { tipo: 'licenca_ambiental', rotulo: 'Licença ambiental' },
  { tipo: 'cadastur', rotulo: 'Cadastur (Ministério do Turismo)' },
  { tipo: 'certidao_federal', rotulo: 'Certidão negativa federal (Receita/PGFN)' },
  { tipo: 'certidao_estadual', rotulo: 'Certidão negativa estadual' },
  { tipo: 'certidao_municipal', rotulo: 'Certidão negativa municipal' },
  { tipo: 'certidao_fgts', rotulo: 'Certificado de regularidade do FGTS (CRF)' },
  { tipo: 'certidao_trabalhista', rotulo: 'Certidão negativa trabalhista (CNDT)' },
  { tipo: 'inscricao_municipal', rotulo: 'Inscrição municipal', semVencimento: true },
  { tipo: 'inscricao_estadual', rotulo: 'Inscrição estadual', semVencimento: true },
  { tipo: 'cartao_cnpj', rotulo: 'Cartão CNPJ', semVencimento: true },
  { tipo: 'contrato_social', rotulo: 'Contrato social / alteração', semVencimento: true },
  { tipo: 'outro', rotulo: 'Outro documento' },
];

export const rotuloTipoDoc = (tipo: string) => TIPOS_DOC_EMPRESA.find((t) => t.tipo === tipo)?.rotulo ?? tipo;
export const tipoDocValido = (tipo: string) => TIPOS_DOC_EMPRESA.some((t) => t.tipo === tipo);

// ---------------------------------------------------------------------------
// Situação pela validade
// ---------------------------------------------------------------------------

export type SituacaoDoc = 'vencido' | 'vence7' | 'vence15' | 'vence30' | 'valido' | 'sem_vencimento' | 'sem_data';

/** Dias de `de` até `ate` (YYYY-MM-DD), pelo calendário. */
export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);
}

export function situacaoDoc(
  d: { validade: string | null; semVencimento: boolean },
  hoje: string = hojeBr(),
): { situacao: SituacaoDoc; dias: number | null } {
  if (d.semVencimento) return { situacao: 'sem_vencimento', dias: null };
  if (!d.validade) return { situacao: 'sem_data', dias: null };
  const dias = diasEntre(hoje, d.validade);
  if (dias < 0) return { situacao: 'vencido', dias };
  if (dias <= 7) return { situacao: 'vence7', dias };
  if (dias <= 15) return { situacao: 'vence15', dias };
  if (dias <= 30) return { situacao: 'vence30', dias };
  return { situacao: 'valido', dias };
}

/** Texto curto da situação ("vence em 5 dias", "venceu há 78 dias"). */
export function fraseSituacao(s: { situacao: SituacaoDoc; dias: number | null }): string {
  const d = s.dias ?? 0;
  switch (s.situacao) {
    case 'vencido':
      return d === -1 ? 'venceu ontem' : `venceu há ${-d} dias`;
    case 'vence7':
    case 'vence15':
    case 'vence30':
      return d === 0 ? 'vence hoje' : d === 1 ? 'vence amanhã' : `vence em ${d} dias`;
    case 'valido':
      return `válido (${d} dias)`;
    case 'sem_vencimento':
      return 'sem vencimento';
    case 'sem_data':
      return 'validade não informada';
  }
}

/** Entra no aviso (tela e relatório diário): vencido ou vence em até 30 dias. */
export const situacaoDeAviso = (s: SituacaoDoc) => s === 'vencido' || s === 'vence7' || s === 'vence15' || s === 'vence30';

// ---------------------------------------------------------------------------
// Leitura por IA
// ---------------------------------------------------------------------------

export interface DocEmpresaLido {
  tipo: string | null;
  titulo: string | null;
  numero: string | null;
  orgao: string | null;
  cnpj: string | null;
  razaoSocial: string | null;
  emissao: string | null;
  validade: string | null;
  semVencimento: boolean;
  /** Como chegou na validade ("impresso", "1 ano da expedição"…). */
  comoValidade: string | null;
  aviso: string | null;
}

const INSTRUCAO = `Você lê documentos de empresa brasileiros: alvarás, licenças, certidões negativas, inscrições, cartão CNPJ, AVCB, licença ambiental.
Devolva SÓ um JSON, sem texto em volta:
{"tipo": string, "titulo": string|null, "numero": string|null, "orgao": string|null, "cnpj": "só dígitos"|null, "razaoSocial": string|null,
 "emissao": "AAAA-MM-DD"|null, "validade": "AAAA-MM-DD"|null, "semVencimento": boolean, "comoValidade": string|null, "aviso": string|null}
- "tipo" é UMA destas chaves: ${TIPOS_DOC_EMPRESA.map((t) => t.tipo).join(', ')}.
  Alvará de licença/localização e funcionamento = alvara_funcionamento; licença/alvará da Vigilância Sanitária = alvara_sanitario;
  Corpo de Bombeiros = avcb; certificado do Cadastur (Ministério do Turismo) = cadastur — validade é a data final do período "dd/mm/aaaa a dd/mm/aaaa"; comprovante de inscrição e situação cadastral do CNPJ = cartao_cnpj;
  certidão de débitos da prefeitura = certidao_municipal; da Receita Federal/PGFN = certidao_federal; da SEFAZ = certidao_estadual;
  CRF da Caixa = certidao_fgts; CNDT da Justiça do Trabalho = certidao_trabalhista.
- "titulo": nome curto pra lista, com o número quando houver (ex.: "Alvará sanitário nº 15102", "Alvará de funcionamento 2026").
- "numero": número do documento/alvará/inscrição/certidão (ex.: inscrição mercantil, sequencial da certidão, nº do alvará).
- "orgao": quem emitiu (ex.: "Prefeitura de Aracaju — Vigilância Sanitária", "Receita Federal").
- "cnpj": o CNPJ DA EMPRESA titular do documento (não o CNPJ do órgão emissor).
- "emissao": data de emissão/expedição.
- "validade": a data em que o documento VENCE. Se vier impressa ("Válido até", "Validade:"), use ela.
  Se o texto disser um prazo a partir da emissão (ex.: "validade de 01 (um) ano, a partir da data de sua expedição"),
  CALCULE: emissão + prazo (1 ano a partir de 09/10/2026 = 2027-10-09). Explique em "comoValidade".
- "semVencimento": true quando o documento não tem prazo de validade (cartão CNPJ, inscrição municipal/estadual, contrato social). Aí "validade" = null.
- Não invente: o que não ler, null.
- "aviso": uma frase curta se estiver ilegível, se não for documento de empresa, ou se já estiver vencido; senão null.`;

type Bloco =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };

export function mimeDocEmpresa(nome: string): string | null {
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

const txt = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const ymd = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Pede pra IA ler o documento (bytes já baixados). */
export async function lerDocEmpresa(bytes: Uint8Array, nome: string): Promise<DocEmpresaLido> {
  const mime = mimeDocEmpresa(nome);
  if (!mime) throw new Error('não consigo ler esse formato (HEIC?). Suba em PDF, JPG ou PNG.');
  const b64 = Buffer.from(bytes).toString('base64');
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
  if (!m) throw new Error('a IA não devolveu os dados do documento');
  const j = JSON.parse(m[0]) as Record<string, unknown>;
  const cnpj = txt(j.cnpj)?.replace(/\D/g, '') || null;
  const tipo = txt(j.tipo);
  const semVencimento = j.semVencimento === true;
  return {
    tipo: tipo && tipoDocValido(tipo) ? tipo : tipo ? 'outro' : null,
    titulo: txt(j.titulo),
    numero: txt(j.numero),
    orgao: txt(j.orgao),
    cnpj: cnpj && cnpj.length === 14 ? cnpj : null,
    razaoSocial: txt(j.razaoSocial),
    emissao: ymd(j.emissao),
    validade: semVencimento ? null : ymd(j.validade),
    semVencimento,
    comoValidade: txt(j.comoValidade),
    aviso: txt(j.aviso),
  };
}
