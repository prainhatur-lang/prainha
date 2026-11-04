// Leitura por IA do contrato de permuta/parceria (04/11/2026).
// Pedido do dono: "tirar foto do arquivo ou as fotos dos arquivos, subir, faz a
// leitura e gera o contas a pagar, o contas a receber ou crédito", podendo
// dividir entre as casas. A IA lê TODAS as páginas juntas (várias fotos = um
// contrato só), preenche o formulário e sugere o tipo e a divisão; o dono
// confere e salva. Mesmo padrão de lib/empresa-documento.ts.

import { hojeBr } from '@/lib/datas';

export type TipoPermuta = 'credito' | 'receber' | 'pagar';

export interface PermutaLida {
  parceiroNome: string | null;
  documento: string | null;
  contato: string | null;
  telefone: string | null;
  email: string | null;
  valorTotal: number | null;
  contrapartida: string | null;
  dataInicio: string | null;
  dataFim: string | null;
  tipo: TipoPermuta | null;
  /** Por que a IA achou esse tipo (frase curta). */
  tipoMotivo: string | null;
  vencimentos: Array<{ data: string; valor: number }>;
  /** Divisão que o contrato diz, por casa (id da filial). Vazio = não diz. */
  divisao: Array<{ filialId: string; valor: number }>;
  observacao: string | null;
  aviso: string | null;
}

export interface CasaParaLeitura {
  id: string;
  nome: string;
  cnpj: string | null;
}

type Bloco =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };

export function mimePermuta(nome: string): string | null {
  const ext = nome.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return null;
}

function instrucao(casas: CasaParaLeitura[]): string {
  const lista = casas
    .map((c, i) => `  ${i}: ${c.nome}${c.cnpj ? ` (CNPJ ${c.cnpj})` : ''}`)
    .join('\n');
  return `Você lê contratos de PERMUTA ou PARCERIA comercial de um grupo de restaurantes/bares de praia em Aracaju (Prainha).
As páginas podem vir em várias fotos ou PDFs: são UM contrato só, leia tudo junto.
As casas do grupo (o "nosso" lado do contrato) são:
${lista}
O PARCEIRO é a outra parte (quem não é uma dessas casas nem a empresa delas).

Devolva SÓ um JSON, sem texto em volta:
{"parceiroNome": string|null, "documento": "só dígitos"|null, "contato": string|null, "telefone": "só dígitos"|null, "email": string|null,
 "valorTotal": number|null, "contrapartida": string|null, "dataInicio": "AAAA-MM-DD"|null, "dataFim": "AAAA-MM-DD"|null,
 "tipo": "credito"|"receber"|"pagar"|null, "tipoMotivo": string|null,
 "vencimentos": [["AAAA-MM-DD", number], ...], "divisao": [[índiceDaCasa, number], ...],
 "observacao": string|null, "aviso": string|null}
- "parceiroNome": razão social (ou nome fantasia) do parceiro. "documento": CNPJ ou CPF DO PARCEIRO (nunca o de uma casa).
- "contato": pessoa responsável/representante do parceiro. "telefone"/"email": do parceiro.
- "valorTotal": valor total do contrato em reais (número, ponto decimal).
- "contrapartida": o que o parceiro entrega (serviço, produto, divulgação, posts, shows…), em 1–2 frases.
- "tipo":
  "credito" = PERMUTA: o parceiro entrega algo e recebe em troca CONSUMO/crédito nas casas (sem dinheiro). É o mais comum.
  "receber" = o parceiro PAGA dinheiro às casas (patrocínio, cota, aluguel de espaço, evento fechado, cachê que ele nos paga).
  "pagar" = as casas PAGAM dinheiro ao parceiro (serviço contratado, cachê de artista, influenciador pago, fornecedor).
  "tipoMotivo": a frase do contrato que mostra isso, curta.
- "vencimentos": as parcelas com data e valor quando o contrato disser (pagar/receber). Valor único com data = uma parcela. Sem data = [].
- "divisao": só se o contrato disser quanto vai pra cada casa (ex.: "R$ 1.250 no Prainha Bar e R$ 1.250 na Prainha Mar"). Use o índice da lista acima. Não diz = [].
- "dataInicio"/"dataFim": vigência. Se disser prazo ("6 meses a partir da assinatura"), calcule e diga em "observacao".
- "observacao": condições importantes em poucas palavras (multa, exclusividade, renovação, o que pode ou não consumir).
- Não invente: o que não ler, null.
- "aviso": uma frase curta se estiver ilegível, faltando página, sem assinatura, ou se não parecer contrato; senão null.
Hoje é ${hojeBr()}.`;
}

async function chamar(modelo: string, system: string, blocos: Bloco[]): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY não configurada');
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: modelo, max_tokens: 1500, system, messages: [{ role: 'user', content: blocos }] }),
    signal: AbortSignal.timeout(240_000),
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
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

/** Lê todas as páginas do contrato numa chamada só. */
export async function lerContratoPermuta(
  arquivos: Array<{ bytes: Uint8Array; nome: string }>,
  casas: CasaParaLeitura[],
): Promise<PermutaLida> {
  const blocos: Bloco[] = [];
  const pulados: string[] = [];
  for (const a of arquivos) {
    const mime = mimePermuta(a.nome);
    if (!mime) {
      pulados.push(a.nome);
      continue;
    }
    const b64 = Buffer.from(a.bytes).toString('base64');
    blocos.push(
      mime === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
        : { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
    );
  }
  if (blocos.length === 0) throw new Error('não consigo ler Word nem HEIC — suba em PDF ou foto (JPG, PNG)');
  blocos.push({ type: 'text', text: `São ${blocos.length} arquivo(s) do mesmo contrato. Devolva o JSON.` });

  const system = instrucao(casas);
  const principal = process.env.PERMUTA_LER_MODELO || 'claude-opus-5-5';
  let texto: string;
  try {
    texto = await chamar(principal, system, blocos);
  } catch (e) {
    const msg = (e as Error).message;
    if (principal === 'claude-sonnet-5-5' || !/HTTP (400|404)/.test(msg) || !/model/i.test(msg)) throw e;
    texto = await chamar('claude-sonnet-5-5', system, blocos);
  }
  const m = texto.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('a IA não devolveu os dados do contrato');
  const j = JSON.parse(m[0]) as Record<string, unknown>;

  const docDig = txt(j.documento)?.replace(/\D/g, '') || null;
  const cnpjsCasas = new Set(casas.map((c) => (c.cnpj ?? '').replace(/\D/g, '')).filter(Boolean));
  const documento = docDig && (docDig.length === 11 || docDig.length === 14) && !cnpjsCasas.has(docDig) ? docDig : null;
  const tipo = txt(j.tipo);

  const vencimentos: PermutaLida['vencimentos'] = [];
  for (const v of Array.isArray(j.vencimentos) ? j.vencimentos : []) {
    const data = Array.isArray(v) ? ymd(v[0]) : ymd((v as Record<string, unknown>)?.data);
    const valor = Array.isArray(v) ? num(v[1]) : num((v as Record<string, unknown>)?.valor);
    if (data && valor) vencimentos.push({ data, valor });
  }
  const divisao: PermutaLida['divisao'] = [];
  for (const v of Array.isArray(j.divisao) ? j.divisao : []) {
    if (!Array.isArray(v)) continue;
    const casa = casas[Number(v[0])];
    const valor = num(v[1]);
    if (casa && valor && !divisao.some((d) => d.filialId === casa.id)) divisao.push({ filialId: casa.id, valor });
  }
  const avisos = [txt(j.aviso), pulados.length ? `não li ${pulados.join(', ')} (Word/HEIC) — suba em PDF ou foto` : null].filter(Boolean);

  return {
    parceiroNome: txt(j.parceiroNome),
    documento,
    contato: txt(j.contato),
    telefone: txt(j.telefone)?.replace(/\D/g, '') || null,
    email: txt(j.email),
    valorTotal: num(j.valorTotal),
    contrapartida: txt(j.contrapartida),
    dataInicio: ymd(j.dataInicio),
    dataFim: ymd(j.dataFim),
    tipo: tipo === 'credito' || tipo === 'receber' || tipo === 'pagar' ? tipo : null,
    tipoMotivo: txt(j.tipoMotivo),
    vencimentos,
    divisao,
    observacao: txt(j.observacao),
    aviso: avisos.length ? avisos.join(' · ') : null,
  };
}
