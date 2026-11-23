// /api/nota-compra/[id]/forma-pagamento — dono 23/11/2026:
// "a informação de onde vai ser pago não é na hora do pagamento. É na hora que
// a pessoa está dando entrada na nota." Nota com boleto = boleto; recibo com
// boleto = boleto; recibo no Pix = Pix, e quem dá entrada CONFIRMA a chave.
//
// GET  → { forma, pixChaveConfirmada, fornecedor: { id, nome, chavePix, pixFavorecido, doc, foneWhatsapp } | null }
// PATCH body:
//   { forma: 'boleto' }                         → nota se paga por boleto
//   { forma: 'pix', chaveConfirmada: '<chave>' } → só aceita a chave que está
//      no cadastro do fornecedor agora (Pix só na chave autorizada) e exige
//      o WhatsApp de quem recebe (comprovante) — dono 23/11/2026
//   { forma: null }                             → volta a "não informado"
// As contas a pagar desta nota herdam: forma da conta > da nota > do fornecedor.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  forma: z.enum(['boleto', 'pix']).nullable(),
  chaveConfirmada: z.string().max(140).optional(),
  zapConfirmado: z.string().max(30).optional(),
});

async function carregar(id: string, userId: string) {
  const n = schema.notaCompra;
  const [nota] = await db
    .select({
      id: n.id,
      filialId: n.filialId,
      fornecedorId: n.fornecedorId,
      forma: n.formaPagamento,
      pixChaveConfirmada: n.pixChaveConfirmada,
    })
    .from(n)
    .where(eq(n.id, id))
    .limit(1);
  if (!nota) return { erro: NextResponse.json({ error: 'nota não encontrada' }, { status: 404 }) } as const;
  const [link] = await db
    .select({ id: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, userId), eq(schema.usuarioFilial.filialId, nota.filialId)))
    .limit(1);
  if (!link) return { erro: NextResponse.json({ error: 'sem acesso à casa' }, { status: 403 }) } as const;
  const f = schema.fornecedor;
  const [forn] = nota.fornecedorId
    ? await db
        .select({ id: f.id, nome: f.nome, chavePix: f.chavePix, pixFavorecido: f.pixFavorecido, doc: f.cnpjOuCpf, foneWhatsapp: f.foneWhatsapp })
        .from(f)
        .where(eq(f.id, nota.fornecedorId))
        .limit(1)
    : [];
  return { nota, forn: forn ?? null } as const;
}

async function usuario() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await usuario();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });
  const r = await carregar(id, user.id);
  if ('erro' in r) return r.erro;
  return NextResponse.json({
    forma: r.nota.forma ?? null,
    pixChaveConfirmada: r.nota.pixChaveConfirmada ?? null,
    fornecedor: r.forn,
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await usuario();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  const { forma, chaveConfirmada, zapConfirmado } = parsed.data;

  const r = await carregar(id, user.id);
  if ('erro' in r) return r.erro;

  let pixChave: string | null = null;
  if (forma === 'pix') {
    // Pix só na chave autorizada no cadastro (regra do dono 10/11/2026).
    if (!r.forn) {
      return NextResponse.json({ error: 'Vincule o fornecedor antes de marcar Pix.' }, { status: 400 });
    }
    const chaveCad = r.forn.chavePix?.trim() || null;
    if (!chaveCad) {
      return NextResponse.json(
        { error: 'O fornecedor não tem chave Pix no cadastro. Cadastre a chave que ele informou e confirme aqui.' },
        { status: 400 },
      );
    }
    if ((chaveConfirmada ?? '').trim() !== chaveCad) {
      return NextResponse.json(
        { error: 'A chave confirmada não é a do cadastro (mudou agora?). Recarregue e confirme de novo.' },
        { status: 409 },
      );
    }
    // E o WhatsApp de quem recebe é obrigatório: é pra onde vai o comprovante
    // do Pix (dono 23/11/2026).
    if ((r.forn.foneWhatsapp ?? '').replace(/\D/g, '').length < 10) {
      return NextResponse.json(
        { error: 'Pix exige o WhatsApp de quem recebe (pra mandar o comprovante). Cadastre o WhatsApp com DDD e confirme.' },
        { status: 400 },
      );
    }
    // Confirmação explícita do WhatsApp também (mesmo já cadastrado).
    const dig = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
    if (dig(zapConfirmado) !== dig(r.forn.foneWhatsapp)) {
      return NextResponse.json(
        { error: 'Confirme o WhatsApp de quem recebe (o do cadastro mudou ou não foi confirmado). Recarregue e confirme de novo.' },
        { status: 409 },
      );
    }
    pixChave = chaveCad;
  }

  await db
    .update(schema.notaCompra)
    .set({
      formaPagamento: forma,
      pixChaveConfirmada: pixChave,
      formaInformadaEm: forma ? new Date() : null,
      formaInformadaPor: forma ? user.id : null,
    })
    .where(eq(schema.notaCompra.id, id));
  return NextResponse.json({ ok: true });
}
