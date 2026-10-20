// Registro de exclusão: quem apagou, quando, motivo e a foto do que sumiu.
// Pedido do dono em 20/10/2026 ("exclusão é algo sério, tem que ter
// registro"). Chamar ANTES de apagar: se der erro aqui, a rota devolve 500 e
// nada é apagado. Tela: /financeiro/excluidas.

import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';

export type TabelaExclusao = 'conta_pagar' | 'conta_pagar_baixa' | 'nota_compra';

/** Lê o motivo do corpo JSON do DELETE (opcional — chamadas antigas sem corpo continuam valendo). */
export async function lerMotivo(req: Request): Promise<string | null> {
  try {
    const txt = await req.text();
    if (!txt) return null;
    const j = JSON.parse(txt) as { motivo?: unknown };
    const m = typeof j.motivo === 'string' ? j.motivo.trim().slice(0, 500) : '';
    return m || null;
  } catch {
    return null;
  }
}

export async function registrarExclusao(p: {
  tabela: TabelaExclusao;
  registroId: string;
  filialId: string | null;
  usuarioId: string;
  resumo?: string | null;
  motivo?: string | null;
  dados?: unknown;
}) {
  let email: string | null = null;
  try {
    const [u] = await db
      .select({ email: schema.usuario.email })
      .from(schema.usuario)
      .where(eq(schema.usuario.id, p.usuarioId))
      .limit(1);
    email = u?.email ?? null;
  } catch {
    // o e-mail é só conveniência; o id basta
  }
  await db.insert(schema.registroExclusao).values({
    tabela: p.tabela,
    registroId: p.registroId,
    filialId: p.filialId,
    usuarioId: p.usuarioId,
    usuarioEmail: email,
    resumo: p.resumo ?? null,
    motivo: p.motivo ?? null,
    dados: (p.dados ?? null) as never,
  });
}

/** "Fornecedor · venc 08/10/2026 · R$ 667,00" */
export function resumoConta(quem: string | null | undefined, venc: string | null | undefined, valor: string | number | null | undefined) {
  const v = Number(valor ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const d = venc ? venc.split('-').reverse().join('/') : '?';
  return `${quem ?? 'conta'} · venc ${d} · R$ ${v}`;
}
