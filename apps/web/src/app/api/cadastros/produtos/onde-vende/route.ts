// /api/cadastros/produtos/onde-vende — quadro "Onde vende" da aba PDV do
// cadastro do produto (02/11/2026). Por TAMANHO (código do PDV):
//   POST { produtoId, codigo, ticket?: boolean, totem?: 'cerveja'|'drinks'|'sem_alcool'|null }
// Grava direto na nuvem (não passa pela fila do Consumer); a loja puxa a lista
// em até 5 min junto com o cardápio do totem.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { GRUPO_IDS, marcarTicket, marcarTotem } from '@/lib/cardapio-totem';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Entrada = z.object({
  produtoId: z.string().uuid(),
  codigo: z.number().int().positive(),
  ticket: z.boolean().optional(),
  totem: z.enum(GRUPO_IDS).nullable().optional(),
});

export async function POST(request: Request) {
  const auth = await exigirPermApi('produto.update');
  if (auth.error) return auth.error;
  const parsed = Entrada.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, erro: 'dados inválidos' }, { status: 400 });
  const b = parsed.data;

  const [prod] = await db
    .select({ filialId: schema.produto.filialId, codigoExterno: schema.produto.codigoExterno })
    .from(schema.produto)
    .where(eq(schema.produto.id, b.produtoId))
    .limit(1);
  if (!prod || prod.codigoExterno == null) {
    return NextResponse.json({ ok: false, erro: 'produto não está no PDV' }, { status: 404 });
  }
  const codigoProduto = prod.codigoExterno;
  const filiais = await filiaisDoUsuario(auth.user.id);
  if (!filiais.some((f) => f.id === prod.filialId)) {
    return NextResponse.json({ ok: false, erro: 'sem acesso a essa filial' }, { status: 403 });
  }
  // o tamanho tem que ser DESTE produto, nesta casa
  const [v] = await db
    .select({ codigo: schema.produtoVariante.codigoExterno })
    .from(schema.produtoVariante)
    .where(
      and(
        eq(schema.produtoVariante.filialId, prod.filialId),
        eq(schema.produtoVariante.codigoExterno, b.codigo),
        eq(schema.produtoVariante.codigoProdutoExterno, codigoProduto),
        isNull(schema.produtoVariante.dataDelete),
      ),
    )
    .limit(1);
  if (!v) return NextResponse.json({ ok: false, erro: 'tamanho não é deste produto' }, { status: 400 });

  const quem = auth.user.email ?? null;
  if (b.ticket !== undefined) await marcarTicket(prod.filialId, b.codigo, b.ticket, quem);
  if (b.totem !== undefined) await marcarTotem(prod.filialId, b.codigo, b.totem, quem);
  return NextResponse.json({ ok: true });
}
