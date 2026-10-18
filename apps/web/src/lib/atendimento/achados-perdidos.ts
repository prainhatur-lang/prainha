// ACHADOS E PERDIDOS (18/10/2026, pedido do dono): no Prainha Bar quem cuida
// é o Matheus (caixa). Cliente esqueceu/perdeu algo → a Nina anota o objeto,
// avisa o Matheus no WhatsApp (template de aviso) e passa a conversa pra
// equipe, que aparece destacada no /atendimento.
//
// O telefone vem do cadastro do funcionário no RH (funcionario.telefone) —
// sem telefone lá, o aviso não sai pra ele, mas a conversa continua no painel.

import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';

const RESPONSAVEL_POR_FILIAL: Record<string, { nome: string; funcionarioId: string }> = {
  // 01 Prainha Bar — MATHEUS DANTAS DE JESUS
  '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9': { nome: 'Matheus', funcionarioId: 'ef9bf90e-531b-42e7-957c-d1097b068148' },
};

export function responsavelAchadosPerdidos(filialId: string): { nome: string; funcionarioId: string } | null {
  return RESPONSAVEL_POR_FILIAL[filialId] ?? null;
}

/** Telefone do responsável no formato do WhatsApp (55 + DDD + número), ou null. */
export async function telefoneResponsavel(funcionarioId: string): Promise<string | null> {
  try {
    const [f] = await db
      .select({ telefone: schema.funcionario.telefone })
      .from(schema.funcionario)
      .where(eq(schema.funcionario.id, funcionarioId))
      .limit(1);
    const dig = (f?.telefone ?? '').replace(/\D/g, '');
    if (dig.length === 10 || dig.length === 11) return `55${dig}`;
    if ((dig.length === 12 || dig.length === 13) && dig.startsWith('55')) return dig;
    return null;
  } catch {
    return null;
  }
}
