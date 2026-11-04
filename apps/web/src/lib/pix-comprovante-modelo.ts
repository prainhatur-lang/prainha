// Modelo (template) do comprovante do Pix na Meta — 03/11/2026.
//
// Sem conversa aberta nas últimas 24 h o WhatsApp só deixa mandar por modelo
// aprovado. Até aqui ele dependia da env WHATSAPP_COMPROVANTE_TEMPLATE, que
// nunca foi criada; agora o próprio sistema cria o `comprovante_pix`
// (UTILIDADE) pelo botão da tela, igual ao `relatorio_diario`.
//
// Tenta criar com o PDF no cabeçalho (DOCUMENTO, precisa subir um PDF de
// exemplo pela API de upload da Meta). Se a subida falhar, cria só com texto
// e um botão "Ver comprovante" que abre o PDF. O envio lê como o modelo ficou
// e monta a mensagem de acordo.
//
// Corpo: {{1}} recebedor, {{2}} casa, {{3}} valor, {{4}} data — mesma ordem
// do envio antigo pela env.

import { wabaDoRemetente } from '@/lib/relatorio-diario-envio';

export const NOME_MODELO_COMPROVANTE = 'comprovante_pix';

const versao = () => process.env.WHATSAPP_API_VERSION || 'v21.0';
const token = () => process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_META || '';
const appUrl = () => {
  const v = (process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\\n/g, '').replace(/\/+$/, '');
  return /^https:\/\//.test(v) ? v : 'https://app.prainhabar.com';
};
/** Parte fixa do link do botão; o resto (id, validade, assinatura) vai na variável. */
export const prefixoLinkBotao = () => `${appUrl()}/api/financeiro/pedidos-pix/comprovante?`;

const CORPO_DOC =
  'Olá, {{1}}! A {{2}} pagou um Pix de {{3}} em {{4}}. O comprovante está anexo. Qualquer dúvida, é só responder esta mensagem.';
const CORPO_BOTAO =
  'Olá, {{1}}! A {{2}} pagou um Pix de {{3}} em {{4}}. Toque em "Ver comprovante" para abrir o PDF. Qualquer dúvida, é só responder esta mensagem.';
const EXEMPLO_CORPO = [['Sobral Empreendimentos', 'Prainha Mar', 'R$ 1.494,00', '03/11/2026']];

export type SituacaoModeloComprovante = 'aprovado' | 'em_analise' | 'recusado' | 'nao_existe' | 'indisponivel';
export interface EstadoModeloComprovante {
  nome: string;
  situacao: SituacaoModeloComprovante;
  detalhe: string | null;
  idioma?: string;
  /** Cabeçalho é DOCUMENTO (o PDF vai junto). */
  comDocumento?: boolean;
  /** Índice do botão de URL dinâmica, quando existe. */
  botaoUrl?: number | null;
}

type Componente = {
  type?: string;
  format?: string;
  buttons?: Array<{ type?: string; url?: string }>;
};

let lembrado: { quando: number; valor: EstadoModeloComprovante } | null = null;

export async function estadoModeloComprovante(forcar = false): Promise<EstadoModeloComprovante> {
  if (!forcar && lembrado && Date.now() - lembrado.quando < 60_000) return lembrado.valor;
  const nome = NOME_MODELO_COMPROVANTE;
  if (!token()) return { nome, situacao: 'indisponivel', detalhe: 'WhatsApp não configurado neste ambiente' };
  try {
    const waba = await wabaDoRemetente();
    const resp = await fetch(
      `https://graph.facebook.com/${versao()}/${waba}/message_templates?name=${nome}&fields=id,name,status,language,rejected_reason,components&limit=50`,
      { headers: { Authorization: `Bearer ${token()}` }, cache: 'no-store', signal: AbortSignal.timeout(8000) },
    );
    const json = (await resp.json().catch(() => null)) as
      | {
          data?: Array<{ name?: string; status?: string; language?: string; rejected_reason?: string; components?: Componente[] }>;
          error?: { message?: string };
        }
      | null;
    if (!resp.ok) return { nome, situacao: 'indisponivel', detalhe: json?.error?.message ?? `HTTP ${resp.status}` };
    const iguais = (json?.data ?? []).filter((t) => t.name === nome);
    const t = iguais.find((x) => x.language === 'pt_BR') ?? iguais[0];
    let valor: EstadoModeloComprovante;
    if (!t) valor = { nome, situacao: 'nao_existe', detalhe: null };
    else {
      const comps = t.components ?? [];
      const comDocumento = comps.some((c) => c.type?.toUpperCase() === 'HEADER' && c.format?.toUpperCase() === 'DOCUMENT');
      const botoes = comps.find((c) => c.type?.toUpperCase() === 'BUTTONS')?.buttons ?? [];
      const iUrl = botoes.findIndex((b) => b.type?.toUpperCase() === 'URL' && /\{\{1\}\}/.test(b.url ?? ''));
      const como = { idioma: t.language, comDocumento, botaoUrl: iUrl >= 0 ? iUrl : null };
      const st = (t.status ?? '').toUpperCase();
      if (st === 'APPROVED') valor = { nome, situacao: 'aprovado', detalhe: null, ...como };
      else if (st === 'PENDING' || st === 'IN_APPEAL') valor = { nome, situacao: 'em_analise', detalhe: null, ...como };
      else {
        const motivo = t.rejected_reason && t.rejected_reason !== 'NONE' ? ` (${t.rejected_reason})` : '';
        valor = { nome, situacao: 'recusado', detalhe: `${st}${motivo}`, ...como };
      }
    }
    lembrado = { quando: Date.now(), valor };
    return valor;
  } catch (e) {
    return { nome, situacao: 'indisponivel', detalhe: e instanceof Error ? e.message : String(e) };
  }
}

/** PDF mínimo de exemplo (a Meta exige um arquivo de amostra pro cabeçalho). */
function pdfExemplo(): Buffer {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 300] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const texto = 'BT /F1 16 Tf 40 240 Td (Comprovante de Pix) Tj 0 -30 Td /F1 11 Tf (Exemplo) Tj ET';
  objs[3] = `<< /Length ${texto.length} >>\nstream\n${texto}\nendstream`;
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offs) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Sobe o PDF de exemplo pela API de upload retomável e devolve o handle. */
async function subirExemplo(): Promise<string> {
  const app = (await fetch(`https://graph.facebook.com/${versao()}/app`, {
    headers: { Authorization: `Bearer ${token()}` },
    signal: AbortSignal.timeout(8000),
  }).then((r) => r.json())) as { id?: string; error?: { message?: string } };
  if (!app.id) throw new Error(`app da Meta não encontrado: ${app.error?.message ?? 'sem id'}`);
  const pdf = pdfExemplo();
  const sessao = (await fetch(
    `https://graph.facebook.com/${versao()}/${app.id}/uploads?file_name=comprovante-exemplo.pdf&file_length=${pdf.length}&file_type=application/pdf`,
    { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(8000) },
  ).then((r) => r.json())) as { id?: string; error?: { message?: string } };
  if (!sessao.id) throw new Error(`upload não abriu: ${sessao.error?.message ?? 'sem id'}`);
  const up = (await fetch(`https://graph.facebook.com/${versao()}/${sessao.id}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${token()}`, file_offset: '0' },
    body: new Uint8Array(pdf),
    signal: AbortSignal.timeout(15000),
  }).then((r) => r.json())) as { h?: string; error?: { message?: string } };
  if (!up.h) throw new Error(`upload falhou: ${up.error?.message ?? 'sem handle'}`);
  return up.h;
}

async function postarModelo(components: unknown[]): Promise<{ ok: boolean; status?: string; erro?: string }> {
  const waba = await wabaDoRemetente();
  const resp = await fetch(`https://graph.facebook.com/${versao()}/${waba}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NOME_MODELO_COMPROVANTE, language: 'pt_BR', category: 'UTILITY', components }),
    signal: AbortSignal.timeout(15000),
  });
  const json = (await resp.json().catch(() => null)) as
    | { status?: string; error?: { message?: string; error_user_msg?: string } }
    | null;
  if (!resp.ok) return { ok: false, erro: json?.error?.error_user_msg ?? json?.error?.message ?? `HTTP ${resp.status}` };
  return { ok: true, status: json?.status };
}

/** Cria o `comprovante_pix` na Meta (botão na tela). Depois é esperar a aprovação. */
export async function criarModeloComprovante(): Promise<EstadoModeloComprovante> {
  const atual = await estadoModeloComprovante(true);
  if (atual.situacao !== 'nao_existe') return atual;
  let erroDoc: string | null = null;
  try {
    const handle = await subirExemplo();
    const r = await postarModelo([
      { type: 'HEADER', format: 'DOCUMENT', example: { header_handle: [handle] } },
      { type: 'BODY', text: CORPO_DOC, example: { body_text: EXEMPLO_CORPO } },
    ]);
    if (!r.ok) erroDoc = r.erro ?? 'recusado';
  } catch (e) {
    erroDoc = e instanceof Error ? e.message : String(e);
  }
  if (erroDoc) {
    // Sem PDF no cabeçalho: texto + botão que abre o PDF.
    const r = await postarModelo([
      { type: 'BODY', text: CORPO_BOTAO, example: { body_text: EXEMPLO_CORPO } },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'Ver comprovante',
            url: `${prefixoLinkBotao()}{{1}}`,
            example: [`${prefixoLinkBotao()}id=exemplo`],
          },
        ],
      },
    ]);
    if (!r.ok) {
      return { nome: NOME_MODELO_COMPROVANTE, situacao: 'indisponivel', detalhe: `${r.erro} (com PDF: ${erroDoc})` };
    }
  }
  lembrado = null;
  const depois = await estadoModeloComprovante(true);
  return depois.situacao === 'nao_existe' || depois.situacao === 'indisponivel'
    ? { nome: NOME_MODELO_COMPROVANTE, situacao: 'em_analise', detalhe: null }
    : depois;
}
