// POST /api/orcamentos — cria um orçamento de evento.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { sanitizarPratos } from '@/lib/orcamentos';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const txt = (v: unknown, max: number) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

/** Valor monetário vindo do JSON (number >= 0) → string pro numeric do Drizzle. */
const dinheiro = (v: unknown): string | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v.toFixed(2) : null;

export async function POST(request: Request) {
  const { user, error } = await exigirPermApi('orcamento.create');
  if (error) return error;

  const b = await request.json().catch(() => null);
  const filialId = typeof b?.filialId === 'string' ? b.filialId : null;
  const clienteNome = txt(b?.clienteNome, 200);
  const dataEvento =
    typeof b?.dataEvento === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.dataEvento)
      ? b.dataEvento
      : null;

  if (!filialId || !clienteNome || !dataEvento) {
    return NextResponse.json(
      { error: 'filial, nome do cliente e data do evento são obrigatórios' },
      { status: 400 },
    );
  }

  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  const pessoas =
    Number.isInteger(b?.pessoas) && b.pessoas > 0 ? Math.min(b.pessoas, 5000) : 1;
  const hora =
    typeof b?.hora === 'string' && /^\d{2}:\d{2}$/.test(b.hora) ? b.hora : null;
  const validoAte =
    typeof b?.validoAte === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.validoAte)
      ? b.validoAte
      : null;

  const [novo] = await db
    .insert(schema.orcamentoEvento)
    .values({
      filialId,
      clienteNome,
      clienteTelefone: txt(b?.clienteTelefone, 30),
      dataEvento,
      hora,
      pessoas,
      valorPessoa: dinheiro(b?.valorPessoa),
      pratos: sanitizarPratos(b?.pratos),
      sobremesaIncluida: b?.sobremesaIncluida === true,
      sobremesaDescricao: txt(b?.sobremesaDescricao, 500),
      taxaEspaco: dinheiro(b?.taxaEspaco),
      taxaExclusividade: dinheiro(b?.taxaExclusividade),
      observacoes: txt(b?.observacoes, 4000),
      condicoes: txt(b?.condicoes, 4000),
      validoAte,
      criadoPor: user.email ?? null,
    })
    .returning({ id: schema.orcamentoEvento.id });

  return NextResponse.json({ ok: true, id: novo.id });
}
