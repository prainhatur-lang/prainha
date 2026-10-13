// POST /api/cotacao/[id]/incluir-fornecedor
// Convoca mais fornecedores numa cotação que já está ABERTA. Antes só dava pra
// escolher fornecedor na criação: quem ficava de fora (a Fasouto na #5 da
// Prainha Mar, 13/10/2026 — fornecedor geral, sem produto vinculado, então o
// "selecionar recomendados" não marcou) só entrava abrindo outra cotação.
// Body: { fornecedorIds: string[] }
// Cria o link de cada um e, se o WhatsApp de cotação estiver configurado, já
// dispara o convite só pros recém-incluídos.

import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { negarSemPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { foneParaWhatsapp } from '@/lib/vendedor-fone';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { conviteCotacaoConfigurado, enviarConviteCotacao } from '@/lib/whatsapp-otp';

export const runtime = 'nodejs';

function normTelefone(v: string | null): string | null {
  if (!v) return null;
  let d = v.replace(/\D/g, '');
  if (d.length < 10) return null;
  if (d.length <= 11) d = '55' + d;
  return d;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'cotacao.update');
  if (semPerm) return semPerm;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const pedidos: string[] = Array.isArray(body?.fornecedorIds)
    ? body.fornecedorIds.filter((x: unknown): x is string => typeof x === 'string' && !!x)
    : [];
  if (pedidos.length === 0) {
    return NextResponse.json({ error: 'fornecedorIds obrigatorio' }, { status: 400 });
  }

  const [c] = await db
    .select({
      id: schema.cotacao.id,
      filialId: schema.cotacao.filialId,
      status: schema.cotacao.status,
      fechaEm: schema.cotacao.fechaEm,
    })
    .from(schema.cotacao)
    .where(eq(schema.cotacao.id, id))
    .limit(1);
  if (!c) return NextResponse.json({ error: 'cotacao nao encontrada' }, { status: 404 });
  // Depois de aprovada os pedidos já saíram — convocar mais gente não muda nada.
  if (c.status !== 'ABERTA' && c.status !== 'AGUARDANDO_APROVACAO') {
    return NextResponse.json(
      { error: 'Esta cotação já foi aprovada ou cancelada — não dá mais pra incluir fornecedor.' },
      { status: 409 },
    );
  }

  // Só fornecedor da mesma casa da cotação.
  const validos = await db
    .select({ id: schema.fornecedor.id })
    .from(schema.fornecedor)
    .where(
      and(
        eq(schema.fornecedor.filialId, c.filialId),
        inArray(schema.fornecedor.id, pedidos),
        isNull(schema.fornecedor.dataDelete),
      ),
    );
  if (validos.length === 0) {
    return NextResponse.json({ error: 'fornecedor invalido' }, { status: 400 });
  }

  // Quem já estava convocado fica como está (unique cotacao+fornecedor).
  const novos = await db
    .insert(schema.cotacaoFornecedor)
    .values(
      validos.map((f) => ({
        cotacaoId: id,
        fornecedorId: f.id,
        tokenPublico: 'cot_' + randomBytes(32).toString('base64url'),
        status: 'PENDENTE' as const,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: schema.cotacaoFornecedor.id });

  const incluidos = novos.length;
  let enviados = 0;
  let semTelefone = 0;
  const falhas: string[] = [];

  if (incluidos > 0 && conviteCotacaoConfigurado()) {
    const [filialRow] = await db
      .select({ nome: schema.filial.nome })
      .from(schema.filial)
      .where(eq(schema.filial.id, c.filialId))
      .limit(1);
    const filial = filialRow?.nome ?? 'Prainha';
    const prazo = c.fechaEm
      ? new Date(c.fechaEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      : 'em breve';

    const alvo = await db
      .select({
        id: schema.cotacaoFornecedor.id,
        token: schema.cotacaoFornecedor.tokenPublico,
        nome: schema.fornecedor.nome,
        fone: foneParaWhatsapp(),
      })
      .from(schema.cotacaoFornecedor)
      .innerJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.cotacaoFornecedor.fornecedorId))
      .where(
        and(
          eq(schema.cotacaoFornecedor.cotacaoId, id),
          inArray(schema.cotacaoFornecedor.id, novos.map((n) => n.id)),
        ),
      );

    for (const f of alvo) {
      const tel = normTelefone(f.fone);
      if (!tel) {
        semTelefone++;
        continue;
      }
      try {
        await enviarConviteCotacao(tel, {
          nome: (f.nome ?? '').split(' ')[0] || 'tudo bem',
          filial,
          prazo,
          token: f.token,
        });
        await db
          .update(schema.cotacaoFornecedor)
          .set({ linkEnviadoEm: new Date() })
          .where(and(eq(schema.cotacaoFornecedor.id, f.id), eq(schema.cotacaoFornecedor.cotacaoId, id)));
        enviados++;
      } catch (e) {
        falhas.push(`${f.nome}: ${(e as Error).message}`);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    incluidos,
    jaConvocados: validos.length - incluidos,
    enviados,
    semTelefone,
    falhas,
    envioAutomatico: conviteCotacaoConfigurado(),
  });
}
