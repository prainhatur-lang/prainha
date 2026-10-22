// PATCH /api/fornecedores/[id]
// Atualiza campos editaveis do fornecedor.
// Body: { valorPedidoMinimo?, ativoCompras?, categoriaCompras? }
// Cadastro único: o que é da EMPRESA (contato, categoria, mínimo, nome) vale
// também nas linhas da mesma empresa nas outras casas.

import { NextResponse } from 'next/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { propagarParaIrmaos } from '@/lib/fornecedor-unico';
import { conferirChavePix } from '@/lib/pix-titular';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const _semPerm = await negarSemPerm(user.id, 'fornecedor.update');
  if (_semPerm) return _semPerm;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  let body: {
    valorPedidoMinimo?: number | string | null;
    ativoCompras?: boolean;
    categoriaCompras?: string | null;
    fonePrincipal?: string | null;
    foneWhatsapp?: string | null;
    email?: string | null;
    nome?: string;
    chavePix?: string | null;
    pixFavorecido?: string | null;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }

  const updates: Partial<typeof schema.fornecedor.$inferInsert> = {};
  if ('valorPedidoMinimo' in body) {
    if (body.valorPedidoMinimo == null || body.valorPedidoMinimo === '') {
      updates.valorPedidoMinimo = null;
    } else {
      const v = Number(String(body.valorPedidoMinimo).replace(',', '.'));
      if (!Number.isFinite(v) || v < 0) {
        return NextResponse.json({ error: 'valorPedidoMinimo invalido' }, { status: 400 });
      }
      updates.valorPedidoMinimo = v.toFixed(2);
    }
  }
  if (typeof body.ativoCompras === 'boolean') updates.ativoCompras = body.ativoCompras;
  if ('categoriaCompras' in body) updates.categoriaCompras = body.categoriaCompras ?? null;
  if ('foneWhatsapp' in body) {
    const w = body.foneWhatsapp?.trim().slice(0, 30) || null;
    updates.foneWhatsapp = w;
  }
  if ('fonePrincipal' in body) {
    const f = body.fonePrincipal?.trim().slice(0, 30) || null;
    if (f && f.replace(/\D/g, '').length < 10) {
      return NextResponse.json({ error: 'fonePrincipal invalido' }, { status: 400 });
    }
    updates.fonePrincipal = f;
    // O WhatsApp da casa vai TAMBÉM pro campo que o sync não sobrescreve.
    // Sem isso, o número volta a ser o fixo do Consumer na próxima rodada e a
    // mensagem some (foi o que aconteceu com o pedido 24 da Megga).
    updates.foneWhatsapp = f;
  }
  if ('email' in body) updates.email = body.email?.trim().slice(0, 200) || null;
  if (typeof body.nome === 'string' && body.nome.trim()) {
    updates.nome = body.nome.trim().slice(0, 200);
  }

  // Como o fornecedor recebe: chave Pix e quem recebe (quando o Pix cai no nome de outra pessoa)
  if ('chavePix' in body) updates.chavePix = body.chavePix?.trim().slice(0, 100) || null;
  if ('pixFavorecido' in body) updates.pixFavorecido = body.pixFavorecido?.trim().slice(0, 200) || null;

  // Anti-fraude (22/10/2026): chave CPF/CNPJ de OUTRA pessoa/empresa só entra
  // dizendo em nome de quem o Pix cai. Telefone/e-mail/aleatória seguem livres.
  if (updates.chavePix) {
    const [atual] = await db
      .select({ doc: schema.fornecedor.cnpjOuCpf, favorecido: schema.fornecedor.pixFavorecido })
      .from(schema.fornecedor)
      .where(eq(schema.fornecedor.id, id))
      .limit(1);
    const favorecido = 'pixFavorecido' in updates ? updates.pixFavorecido : atual?.favorecido;
    const c = conferirChavePix({ chave: updates.chavePix, docFornecedor: atual?.doc, favorecido });
    if (c?.nivel === 'diverge') {
      return NextResponse.json(
        {
          error: `${c.msg} Se o Pix cai mesmo nessa pessoa, preencha "quem recebe" com o nome dela; senão, corrija a chave.`,
        },
        { status: 400 },
      );
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'nenhum campo pra atualizar' }, { status: 400 });
  }

  const result = await db
    .update(schema.fornecedor)
    .set(updates)
    .where(eq(schema.fornecedor.id, id))
    .returning({
      id: schema.fornecedor.id,
      valorPedidoMinimo: schema.fornecedor.valorPedidoMinimo,
      ativoCompras: schema.fornecedor.ativoCompras,
      categoriaCompras: schema.fornecedor.categoriaCompras,
    });

  if (result.length === 0) {
    return NextResponse.json({ error: 'fornecedor nao encontrado' }, { status: 404 });
  }
  const outrasCasas = await propagarParaIrmaos(id, updates);
  return NextResponse.json({ ok: true, fornecedor: result[0], outrasCasas });
}
