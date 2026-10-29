// Assinatura eletrônica de documento pelo funcionário (29/10/2026).
// Pedido do dono: "a empresa manda assinado pra ele, ele vai lá, dá o aceite
// eletronicamente, tira a foto dele e faz o aceite".
//
// Como funciona:
//  - o documento (contrato, ASO, termo…) já está na ficha (funcionario_documento),
//    subido pela empresa ou pela contabilidade, já assinado pela empresa;
//  - "✍️ Pedir assinatura" gera um link /op/assinar/<token> (vale 15 dias) e
//    guarda o SHA-256 do arquivo naquele momento;
//  - a pessoa abre no celular, confirma o CPF, lê o documento, marca "li e
//    concordo", tira uma selfie e toca em Assinar;
//  - no aceite o servidor baixa o arquivo de novo e confere o SHA-256 (se o
//    arquivo mudou, recusa), guarda data/hora, IP, aparelho, CPF digitado,
//    a selfie e — se a pessoa tem rosto cadastrado no ponto — a distância do
//    rosto (só registro, não trava).
// É assinatura eletrônica simples (Lei 14.063/2020, art. 4º, I; MP 2.200-2,
// art. 10, §2º). O comprovante fica em /rh/assinatura/<id>.

import crypto from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/server';
import { BUCKET_DOC_RH, pastaDocRh } from '@/lib/rh/documento-vinculo';

export const ASSINATURA_VALIDADE_DIAS = 15;

export function novoTokenAssinatura(): string {
  return crypto.randomBytes(24).toString('base64url');
}

/** SHA-256 (hex) do arquivo guardado no bucket do RH. */
export async function hashArquivoRh(path: string): Promise<string> {
  const admin = await createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET_DOC_RH).download(path);
  if (error || !data) throw new Error(`não consegui ler o arquivo (${error?.message ?? 'sem resposta'})`);
  const buf = Buffer.from(await data.arrayBuffer());
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function caminhoSelfieAssinatura(filialId: string, funcionarioId: string, assinaturaId: string): string {
  return `${pastaDocRh(filialId)}/${funcionarioId}/assinaturas/${assinaturaId}-selfie.jpg`;
}

/** Texto que a pessoa aceita (fica gravado junto da assinatura). */
export function textoAceite(nome: string, documento: string): string {
  return (
    `Eu, ${nome}, declaro que li o documento "${documento}" por inteiro, que concordo com o seu conteúdo ` +
    `e que o assino eletronicamente por este aceite, confirmado com o meu CPF e com a minha foto (selfie) ` +
    `tirada neste momento. Reconheço esta assinatura eletrônica como válida (Lei 14.063/2020 e MP 2.200-2/2001, art. 10, §2º).`
  );
}

/** Descritor de rosto (128 números) ou null. */
export function descritorRosto(x: unknown): number[] | null {
  if (!Array.isArray(x) || x.length !== 128) return null;
  const v = x.map(Number);
  return v.every((n) => Number.isFinite(n)) ? v : null;
}

/** Selfie do aceite → JPEG/PNG/WebP de até 400 KB; qualquer coisa estranha vira null. */
export function selfieDoAceite(raw: unknown): { buf: Buffer; mime: string } | null {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) return null;
  try {
    const buf = Buffer.from(m[2]!, 'base64');
    if (buf.length < 1000 || buf.length > 400_000) return null;
    return { buf, mime: m[1]! };
  } catch {
    return null;
  }
}

export function ipDoPedido(req: Request): string | null {
  const xf = req.headers.get('x-forwarded-for');
  const ip = (xf ? xf.split(',')[0] : req.headers.get('x-real-ip'))?.trim();
  return ip ? ip.slice(0, 80) : null;
}

export const ROTULO_STATUS_ASSINATURA: Record<string, string> = {
  pendente: 'aguardando assinatura',
  assinado: 'assinado',
  cancelado: 'cancelado',
};
