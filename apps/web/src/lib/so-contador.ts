// Contador de fora (grupo "Contador"): dono, 19/10/2026 — "retirar acesso a
// conferencia de caixa do contador e da opcao para baixar os dados em excel".
// O grupo dele tem relatorio.read, que é a mesma permissão do Fechamento do
// mês que ele usa e da Conferência de caixa. Tirar a permissão derrubaria o
// Fechamento, então a trava é por grupo: quem está SÓ no grupo Contador não
// entra na conferência e baixa os extratos em CSV (não em Excel).
// Quem tem outro grupo junto (Admin, Gerente, Financeiro...) segue igual.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';

export const GRUPO_CONTADOR = 'Contador';

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { valor: boolean; expiresAt: number }>();

/** true quando todos os grupos do usuário (em qualquer casa) são "Contador". */
export async function ehSoContador(userId: string): Promise<boolean> {
  const c = cache.get(userId);
  if (c && c.expiresAt > Date.now()) return c.valor;
  const grupos = await db
    .select({ nome: schema.grupoUsuario.nome })
    .from(schema.usuarioGrupo)
    .innerJoin(schema.grupoUsuario, eq(schema.grupoUsuario.id, schema.usuarioGrupo.grupoId))
    .where(eq(schema.usuarioGrupo.usuarioId, userId));
  const valor = grupos.length > 0 && grupos.every((g) => g.nome === GRUPO_CONTADOR);
  cache.set(userId, { valor, expiresAt: Date.now() + CACHE_TTL_MS });
  return valor;
}

/** Pra APIs da Conferência de caixa: 403 pro contador, null pros demais. */
export async function barrarContador(userId: string): Promise<NextResponse | null> {
  if (!(await ehSoContador(userId))) return null;
  return NextResponse.json({ error: 'a conferência de caixa não é liberada pro contador' }, { status: 403 });
}
