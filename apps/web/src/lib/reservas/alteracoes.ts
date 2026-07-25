// Auditoria de alteracoes de reserva: compara antes/depois e grava uma linha
// por campo alterado em reserva_alteracao. Best-effort — falha de log nunca
// derruba a operacao principal.

import { db, schema } from '@concilia/db';

export interface AutorAlteracao {
  tipo: 'equipe' | 'cliente' | 'sistema';
  nome?: string | null;
  id?: string | null;
}

/** Campos auditados e o rotulo curto gravado em `campo`. */
const CAMPOS: Array<{ chave: string; campo: string }> = [
  { chave: 'pessoas', campo: 'pessoas' },
  { chave: 'mesa', campo: 'mesa' },
  { chave: 'mesaJuntada', campo: 'mesa_juntada' },
  { chave: 'area', campo: 'area' },
  { chave: 'status', campo: 'status' },
  { chave: 'observacao', campo: 'observacao' },
  { chave: 'data', campo: 'data' },
  { chave: 'hora', campo: 'hora' },
];

const norm = (v: unknown): string | null =>
  v === undefined || v === null || v === '' ? null : String(v);

/**
 * Grava as diferencas entre `antes` e `depois` (somente chaves presentes em
 * `depois` sao consideradas — campo ausente = nao mexeu).
 */
export async function registrarAlteracoesReserva(
  reservaId: string,
  antes: Record<string, unknown>,
  depois: Record<string, unknown>,
  autor: AutorAlteracao,
): Promise<void> {
  const linhas: Array<typeof schema.reservaAlteracao.$inferInsert> = [];
  for (const { chave, campo } of CAMPOS) {
    if (!(chave in depois)) continue;
    const de = norm(antes[chave]);
    const para = norm(depois[chave]);
    if (de === para) continue;
    linhas.push({
      reservaId,
      campo,
      valorAnterior: de,
      valorNovo: para,
      autorTipo: autor.tipo,
      autorNome: autor.nome ?? null,
      autorId: autor.id ?? null,
    });
  }
  if (linhas.length === 0) return;
  try {
    await db.insert(schema.reservaAlteracao).values(linhas);
  } catch (e) {
    console.error('Erro registrando alteracao de reserva:', (e as Error).message);
  }
}
