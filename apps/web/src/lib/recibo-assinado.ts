// Recibo assinado (16/11/2026, pedido do dono): depois de imprimir e a pessoa
// assinar, a foto/PDF do papel sobe e fica guardada junto da conta.
// Sem tabela: os arquivos moram no balde producao-fotos, pasta
// recibos-assinados/<filialId>/<contaId>/ — a lista é a própria pasta.

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
