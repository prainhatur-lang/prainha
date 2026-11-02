// Setores de estoque da casa (lib/estoque-local.ts explica a regra).
// POST { acao: 'criar', filialId, nome }
// POST { acao: 'renomear', id, nome }
// POST { acao: 'ativar' | 'desativar', id }
// POST { acao: 'principal', id }           — vira o setor onde cai a compra
// POST { acao: 'mover', id, direcao: 'cima' | 'baixo' }
// Só desativa (nunca apaga): o histórico das transferências aponta pro setor.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { locaisDaFilial } from '@/lib/estoque-local';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Nome = z.string().trim().min(2).max(60);
const Body = z.discriminatedUnion('acao', [
  z.object({ acao: z.literal('criar'), filialId: z.string().uuid(), nome: Nome }),
  z.object({ acao: z.literal('renomear'), id: z.string().uuid(), nome: Nome }),
  z.object({ acao: z.literal('ativar'), id: z.string().uuid() }),
  z.object({ acao: z.literal('desativar'), id: z.string().uuid() }),
  z.object({ acao: z.literal('principal'), id: z.string().uuid() }),
  z.object({ acao: z.literal('mover'), id: z.string().uuid(), direcao: z.enum(['cima', 'baixo']) }),
]);

export async function POST(req: Request) {
  const g = await exigirPermApi('produto.update');
  if (g.error) return g.error;
  const user = g.user;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  const b = parsed.data;
  const filiais = new Set((await filiaisDoUsuario(user.id)).map((f) => f.id));

  if (b.acao === 'criar') {
    if (!filiais.has(b.filialId)) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });
    const atuais = await locaisDaFilial(b.filialId);
    if (atuais.some((l) => l.nome.toLowerCase() === b.nome.toLowerCase())) {
      return NextResponse.json({ error: 'Já existe um setor com esse nome' }, { status: 400 });
    }
    const ordem = Math.max(0, ...atuais.map((l) => l.ordem)) + 1;
    await db.insert(schema.estoqueLocal).values({ filialId: b.filialId, nome: b.nome, ordem });
    return NextResponse.json({ ok: true });
  }

  const [loc] = await db.select().from(schema.estoqueLocal).where(eq(schema.estoqueLocal.id, b.id)).limit(1);
  if (!loc || !filiais.has(loc.filialId)) return NextResponse.json({ error: 'setor não encontrado' }, { status: 404 });

  if (b.acao === 'renomear') {
    const atuais = await locaisDaFilial(loc.filialId);
    if (atuais.some((l) => l.id !== loc.id && l.nome.toLowerCase() === b.nome.toLowerCase())) {
      return NextResponse.json({ error: 'Já existe um setor com esse nome' }, { status: 400 });
    }
    await db.update(schema.estoqueLocal).set({ nome: b.nome }).where(eq(schema.estoqueLocal.id, loc.id));
  } else if (b.acao === 'ativar' || b.acao === 'desativar') {
    if (b.acao === 'desativar' && loc.principal) {
      return NextResponse.json({ error: 'O setor principal não pode ser desativado. Escolha outro como principal antes.' }, { status: 400 });
    }
    await db
      .update(schema.estoqueLocal)
      .set({ ativo: b.acao === 'ativar' })
      .where(eq(schema.estoqueLocal.id, loc.id));
  } else if (b.acao === 'principal') {
    if (!loc.ativo) return NextResponse.json({ error: 'Ative o setor antes' }, { status: 400 });
    await db.transaction(async (tx) => {
      await tx
        .update(schema.estoqueLocal)
        .set({ principal: false })
        .where(and(eq(schema.estoqueLocal.filialId, loc.filialId), eq(schema.estoqueLocal.principal, true)));
      await tx.update(schema.estoqueLocal).set({ principal: true }).where(eq(schema.estoqueLocal.id, loc.id));
    });
  } else if (b.acao === 'mover') {
    const lista = await locaisDaFilial(loc.filialId);
    const i = lista.findIndex((l) => l.id === loc.id);
    const j = b.direcao === 'cima' ? i - 1 : i + 1;
    if (i >= 0 && j >= 0 && j < lista.length) {
      const nova = [...lista];
      [nova[i], nova[j]] = [nova[j]!, nova[i]!];
      await db.transaction(async (tx) => {
        for (let k = 0; k < nova.length; k++) {
          await tx.update(schema.estoqueLocal).set({ ordem: k + 1 }).where(eq(schema.estoqueLocal.id, nova[k]!.id));
        }
      });
    }
  }
  return NextResponse.json({ ok: true });
}
