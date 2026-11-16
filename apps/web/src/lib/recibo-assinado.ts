// Recibo assinado (16/11/2026, pedido do dono): depois de imprimir e a pessoa
// assinar, a foto/PDF do papel sobe e fica guardada junto da conta.
// Sem tabela: os arquivos moram no balde producao-fotos, pasta
// recibos-assinados/<filialId>/<contaId>/ — a lista é a própria pasta.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/server';

export const BUCKET_RECIBO = 'producao-fotos';

export function pastaReciboAssinado(filialId: string, contaId: string): string {
  return `recibos-assinados/${filialId}/${contaId}`;
}

export interface ReciboAssinado {
  nome: string;
  url: string;
  /** ISO de quando subiu. */
  em: string | null;
}

export async function listarRecibosAssinados(filialId: string, contaId: string): Promise<ReciboAssinado[]> {
  try {
    const supa = await createAdminClient();
    const pasta = pastaReciboAssinado(filialId, contaId);
    const { data } = await supa.storage.from(BUCKET_RECIBO).list(pasta, { limit: 50 });
    return (data ?? [])
      .filter((f) => f.name && !f.name.startsWith('.'))
      .sort((a, b) => (a.name < b.name ? 1 : -1)) // nome começa pelo horário: mais novo primeiro
      .map((f) => ({
        nome: f.name,
        url: supa.storage.from(BUCKET_RECIBO).getPublicUrl(`${pasta}/${f.name}`).data.publicUrl,
        em: f.created_at ?? null,
      }));
  } catch {
    return [];
  }
}

// ---- Guardar o arquivo (usado pelo envio da tela e pelo do celular) ----

const MAX_RECIBO = 10 * 1024 * 1024;
const EXT_RECIBO: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heic',
};

/** Guarda a foto/PDF na pasta da conta. Devolve o erro (com status) ou null. */
export async function guardarReciboAssinado(
  filialId: string,
  contaId: string,
  arquivo: unknown,
): Promise<{ erro: string; status: number } | null> {
  if (!(arquivo instanceof File) || arquivo.size === 0) return { erro: 'arquivo ausente', status: 400 };
  if (arquivo.size > MAX_RECIBO) return { erro: 'arquivo maior que 10 MB', status: 413 };
  const tipo = arquivo.type.toLowerCase();
  const ext = EXT_RECIBO[tipo];
  if (!ext) return { erro: 'envie foto (JPG, PNG) ou PDF', status: 400 };
  const caminho = `${pastaReciboAssinado(filialId, contaId)}/${Date.now()}-${randomBytes(8).toString('hex')}.${ext}`;
  const supa = await createAdminClient();
  const up = await supa.storage.from(BUCKET_RECIBO).upload(caminho, Buffer.from(await arquivo.arrayBuffer()), {
    contentType: tipo === 'image/jpg' ? 'image/jpeg' : tipo === 'image/heif' ? 'image/heic' : tipo,
    upsert: false,
  });
  return up.error ? { erro: `não consegui guardar: ${up.error.message}`, status: 500 } : null;
}

// ---- Link do celular (QR na tela do recibo) ----
// /recibo/foto/<contaId>.<vence>.<assinatura> — sem login, só serve pra SUBIR
// a foto do recibo assinado daquela conta, e vence em 24 h. É outro link, com
// outra assinatura, que o /recibo/<token> que vai pra quem recebeu.

const VALE_MS = 24 * 60 * 60 * 1000;

function assinar(contaId: string, vence: number): string | null {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return null;
  return createHmac('sha256', seg).update(`recibo-assinado-foto|${contaId}|${vence}`).digest('hex').slice(0, 32);
}

export function tokenFotoRecibo(contaId: string): string | null {
  const vence = Date.now() + VALE_MS;
  const s = assinar(contaId, vence);
  return s ? `${contaId}.${vence}.${s}` : null;
}

/** Id da conta, ou null se o link é falso ou venceu. */
export function contaDoTokenFoto(token: string): string | null {
  const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(\d{13})\.([0-9a-f]{32})$/i.exec(
    decodeURIComponent(token ?? ''),
  );
  if (!m) return null;
  const vence = Number(m[2]);
  if (vence < Date.now()) return null;
  const esperada = assinar(m[1]!, vence);
  if (!esperada) return null;
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(m[3]!.toLowerCase(), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b) ? m[1]! : null;
}
