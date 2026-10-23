// POST /api/nota-compra/[id]/fornecedor-cnpj — pedido escaneado sem fornecedor:
// a pessoa digita o CNPJ e o sistema cadastra (cópia de outra casa ou dados da
// Receita) e já vincula na nota. Regra do dono 23/10/2026: "pergunta o CNPJ".
// Body: { cnpj: string }

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNull } from 'drizzle-orm';
import { garantirFornecedorDoPedido } from '@/lib/pedido-sem-nota';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({ cnpj: z.string().min(11).max(20) });

function docValido(d: string): boolean {
  if (/^(\d)\1+$/.test(d)) return false;
  const n = d.split('').map(Number);
  if (d.length === 14) {
    const dv = (len: number) => {
      const pesos = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const s = pesos.reduce((acc, p, i) => acc + p * n[i], 0) % 11;
      return s < 2 ? 0 : 11 - s;
    };
    return dv(12) === n[12] && dv(13) === n[13];
  }
  if (d.length === 11) {
    const dv = (len: number) => {
      let s = 0;
      for (let i = 0; i < len; i++) s += n[i] * (len + 1 - i);
      const r = (s * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return dv(9) === n[9] && dv(10) === n[10];
  }
  return false;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'informe o CNPJ' }, { status: 400 });
  const doc = parsed.data.cnpj.replace(/\D/g, '');
  if (!docValido(doc)) return NextResponse.json({ error: 'CNPJ inválido — confira os números' }, { status: 400 });

  const [nota] = await db
    .select({
      id: schema.notaCompra.id,
      filialId: schema.notaCompra.filialId,
      fornecedorId: schema.notaCompra.fornecedorId,
      emitNome: schema.notaCompra.emitNome,
      emitCnpj: schema.notaCompra.emitCnpj,
    })
    .from(schema.notaCompra)
    .where(eq(schema.notaCompra.id, id))
    .limit(1);
  if (!nota) return NextResponse.json({ error: 'nota nao encontrada' }, { status: 404 });

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, nota.filialId)))
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  // Mesma trava da troca de fornecedor: conta a pagar já criada guarda o dela.
  if (nota.fornecedorId) {
    const [conta] = await db
      .select({ id: schema.contaPagar.id })
      .from(schema.contaPagar)
      .where(and(eq(schema.contaPagar.notaCompraId, id), isNull(schema.contaPagar.dataDelete)))
      .limit(1);
    if (conta) {
      return NextResponse.json(
        { error: 'Esta nota já tem conta a pagar. Exclua as parcelas antes de trocar o fornecedor.' },
        { status: 409 },
      );
    }
  }

  const g = await garantirFornecedorDoPedido(nota.filialId, { fornecedorCnpj: doc, fornecedorNome: nota.emitNome });
  if (!g) {
    return NextResponse.json(
      { error: 'A Receita não achou esse CNPJ e o papel não tem nome legível — cadastre em Cadastros → Fornecedores' },
      { status: 422 },
    );
  }

  await db
    .update(schema.notaCompra)
    .set({ fornecedorId: g.id, ...(nota.emitCnpj ? {} : { emitCnpj: doc }) })
    .where(eq(schema.notaCompra.id, id));

  const msg =
    g.origem === 'outra_casa'
      ? `fornecedor "${g.nome}" copiado do cadastro de outra casa e ligado ao pedido`
      : g.origem === 'mesmo_nome'
        ? `fornecedor "${g.nome}" já estava no cadastro — ligado ao pedido`
        : g.origem === 'receita'
          ? `fornecedor "${g.nome}" cadastrado com os dados da Receita e ligado ao pedido`
          : `fornecedor "${g.nome}" cadastrado (a Receita não respondeu — complete o endereço depois) e ligado ao pedido`;
  return NextResponse.json({ ok: true, fornecedorId: g.id, nome: g.nome, origem: g.origem, mensagem: msg });
}
