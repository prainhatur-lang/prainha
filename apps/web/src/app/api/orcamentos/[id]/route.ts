// PATCH  /api/orcamentos/[id] — atualiza um orçamento de evento.
// DELETE /api/orcamentos/[id] — exclui.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq, sql } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { sanitizarPratos } from '@/lib/orcamentos';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STATUS = new Set(['aberto', 'enviado', 'aceito', 'recusado']);

const txt = (v: unknown, max: number) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

const dinheiro = (v: unknown): string | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v.toFixed(2) : null;

/** Carrega o orçamento e valida acesso do usuário à filial dele. */
async function carregarComAcesso(userId: string, id: string) {
  const [orc] = await db
    .select({ id: schema.orcamentoEvento.id, filialId: schema.orcamentoEvento.filialId })
    .from(schema.orcamentoEvento)
    .where(eq(schema.orcamentoEvento.id, id))
    .limit(1);
  if (!orc) return { erro: NextResponse.json({ error: 'não encontrado' }, { status: 404 }) };
  const filiais = await filiaisDoUsuario(userId);
  if (!filiais.some((f) => f.id === orc.filialId)) {
    return { erro: NextResponse.json({ error: 'filial não acessível' }, { status: 403 }) };
  }
  return { orc };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('orcamento.update');
  if (error) return error;

  const { id } = await params;
  const { erro } = await carregarComAcesso(user.id, id);
  if (erro) return erro;

  const b = await request.json().catch(() => null);
  const set: Record<string, unknown> = { atualizadoEm: sql`now()` };

  if (typeof b?.status === 'string') {
    if (!STATUS.has(b.status)) {
      return NextResponse.json({ error: 'status inválido' }, { status: 400 });
    }
    set.status = b.status;
  }
  if (b?.clienteNome !== undefined) {
    const nome = txt(b.clienteNome, 200);
    if (!nome) return NextResponse.json({ error: 'nome do cliente é obrigatório' }, { status: 400 });
    set.clienteNome = nome;
  }
  if (b?.clienteTelefone !== undefined) set.clienteTelefone = txt(b.clienteTelefone, 30);
  if (b?.local !== undefined) set.local = txt(b.local, 100);
  if (b?.filialId !== undefined) {
    // Trocar de filial exige acesso à filial nova também.
    if (typeof b.filialId !== 'string') {
      return NextResponse.json({ error: 'filial inválida' }, { status: 400 });
    }
    const filiais = await filiaisDoUsuario(user.id);
    if (!filiais.some((f) => f.id === b.filialId)) {
      return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
    }
    set.filialId = b.filialId;
  }
  if (b?.dataEvento !== undefined) {
    if (typeof b.dataEvento !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.dataEvento)) {
      return NextResponse.json({ error: 'data do evento inválida' }, { status: 400 });
    }
    set.dataEvento = b.dataEvento;
  }
  if (b?.hora !== undefined) {
    set.hora = typeof b.hora === 'string' && /^\d{2}:\d{2}$/.test(b.hora) ? b.hora : null;
  }
  if (b?.pessoas !== undefined) {
    if (!Number.isInteger(b.pessoas) || b.pessoas < 1 || b.pessoas > 5000) {
      return NextResponse.json({ error: 'pessoas inválido' }, { status: 400 });
    }
    set.pessoas = b.pessoas;
  }
  if (b?.valorPessoa !== undefined) set.valorPessoa = dinheiro(b.valorPessoa);
  if (b?.pratos !== undefined) set.pratos = sanitizarPratos(b.pratos);
  if (b?.sobremesaIncluida !== undefined) set.sobremesaIncluida = b.sobremesaIncluida === true;
  if (b?.sobremesaDescricao !== undefined) set.sobremesaDescricao = txt(b.sobremesaDescricao, 500);
  if (b?.taxaEspaco !== undefined) set.taxaEspaco = dinheiro(b.taxaEspaco);
  if (b?.taxaExclusividade !== undefined) set.taxaExclusividade = dinheiro(b.taxaExclusividade);
  if (b?.entradaValor !== undefined) set.entradaValor = dinheiro(b.entradaValor);
  if (b?.observacoes !== undefined) set.observacoes = txt(b.observacoes, 4000);
  if (b?.condicoes !== undefined) set.condicoes = txt(b.condicoes, 4000);
  if (b?.validoAte !== undefined) {
    set.validoAte =
      typeof b.validoAte === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.validoAte)
        ? b.validoAte
        : null;
  }

  if (Object.keys(set).length === 1) {
    return NextResponse.json({ error: 'nada para atualizar' }, { status: 400 });
  }

  await db.update(schema.orcamentoEvento).set(set).where(eq(schema.orcamentoEvento.id, id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('orcamento.delete');
  if (error) return error;

  const { id } = await params;
  const { erro } = await carregarComAcesso(user.id, id);
  if (erro) return erro;

  await db.delete(schema.orcamentoEvento).where(eq(schema.orcamentoEvento.id, id));
  return NextResponse.json({ ok: true });
}
