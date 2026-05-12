// Permissoes de UI baseadas no role do usuario em suas filiais.
//
// Modelo: usuario_filial.role = 'DONO' | 'GERENTE' | 'COMPRAS'
//   - DONO: acesso total (todos os grupos do menu + admin)
//   - GERENTE: acesso operacional (sem certificados, sem usuarios admin)
//   - COMPRAS: so o grupo Compras (cotacao, pedidos, NF entrada, categorizar produtos)
//
// Helper retorna o role mais alto que o user tem em qualquer filial. Se ele tem
// roles diferentes em filiais diferentes (raro), pega o maior poder.

import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';

export type Role = 'DONO' | 'GERENTE' | 'COMPRAS' | 'FINANCEIRO';

/** Hierarquia de poder. Maior > menor. */
const HIERARQUIA: Record<Role, number> = {
  COMPRAS: 1,
  FINANCEIRO: 1,
  GERENTE: 2,
  DONO: 3,
};

export async function roleEfetivoUsuario(usuarioId: string): Promise<Role | null> {
  const rows = await db
    .select({ role: schema.usuarioFilial.role })
    .from(schema.usuarioFilial)
    .where(eq(schema.usuarioFilial.usuarioId, usuarioId));
  if (rows.length === 0) return null;
  return rows.reduce<Role | null>((max, r) => {
    const cur = r.role as Role;
    if (!max) return cur;
    return HIERARQUIA[cur] > HIERARQUIA[max] ? cur : max;
  }, null);
}

/** Lista de "grupos do menu" acessiveis pra esse role. */
export function gruposAcessiveis(role: Role | null): Set<string> {
  if (!role) return new Set();
  switch (role) {
    case 'DONO':
      return new Set([
        'Cadastros',
        'Movimentação',
        'Folha da equipe',
        'Compras',
        'Conciliação',
        'Relatórios',
        'Configurações',
      ]);
    case 'GERENTE':
      return new Set([
        'Cadastros',
        'Movimentação',
        'Folha da equipe',
        'Compras',
        'Conciliação',
        'Relatórios',
      ]);
    case 'COMPRAS':
      return new Set(['Compras']);
    case 'FINANCEIRO':
      return new Set(['Movimentação', 'Conciliação', 'Relatórios']);
  }
}

/** True se o caminho (pathname) e acessivel pra esse role. */
export function podeAcessarPath(role: Role | null, pathname: string): boolean {
  if (!role) return false;
  if (role === 'DONO') return true;

  // Sempre permitidos: inicio, login, logout
  if (pathname === '/' || pathname === '/login' || pathname === '/signup') return true;

  if (role === 'COMPRAS') {
    // So Compras + algumas paginas auxiliares (cadastros/produtos pra cadastro
    // de insumo + cadastros/fornecedores pra ver fornecedor)
    return (
      pathname.startsWith('/compras') ||
      pathname.startsWith('/cotacao') ||
      pathname.startsWith('/cadastros/produtos') ||
      pathname.startsWith('/cadastros/fornecedores') ||
      pathname.startsWith('/movimento/entrada-notas')
    );
  }

  if (role === 'FINANCEIRO') {
    return (
      pathname.startsWith('/financeiro') ||
      pathname.startsWith('/movimento') ||
      pathname.startsWith('/conciliacao') ||
      pathname.startsWith('/excecoes') ||
      pathname.startsWith('/fechamento') ||
      pathname.startsWith('/relatorio') ||
      pathname.startsWith('/upload') ||
      pathname.startsWith('/cadastros/fornecedores') ||
      pathname.startsWith('/cadastros/plano-contas')
    );
  }

  // GERENTE: tudo exceto Configurações
  if (role === 'GERENTE') {
    return !pathname.startsWith('/configuracoes');
  }
  return false;
}
