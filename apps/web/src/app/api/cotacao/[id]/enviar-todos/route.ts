// POST /api/cotacao/[id]/enviar-todos
// Dispara o convite da cotação pros fornecedores AUTOMATICAMENTE via WhatsApp
// (template UTILIDADE WHATSAPP_COTACAO_TEMPLATE). Marca link_enviado_em.
// Só roda se o WhatsApp de cotação estiver configurado (env).

import { NextResponse } from 'next/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { conviteCotacaoConfigurado, enviarConviteCotacao } from '@/lib/whatsapp-otp';

export const runtime = 'nodejs';

function normTelefone(v: string | null): string | null {
  if (!v) return null;
  let d = v.replace(/\D/g, '');
  if (d.length < 10) return null;
  if (d.length <= 11) d = '55' + d;
  return d;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'cotacao.update');
  if (semPerm) return semPerm;

  if (!conviteCotacaoConfigurado()) {
    return NextResponse.json(
      { error: 'Envio automático não configurado (faltam as envs do WhatsApp de cotação). Use o botão 📲 por fornecedor.' },
      { status: 400 },
    );
  }

  const { id } = await params;
  const [c] = await db
    .select({ id: schema.cotacao.id, filialId: schema.cotacao.filialId, fechaEm: schema.cotacao.fechaEm })
    .from(schema.cotacao)
    .where(eq(schema.cotacao.id, id))
    .limit(1);
  if (!c) return NextResponse.json({ error: 'cotacao nao encontrada' }, { status: 404 });

  const [filialRow] = await db
    .select({ nome: schema.filial.nome })
    .from(schema.filial)
    .where(eq(schema.filial.id, c.filialId))
    .limit(1);
  const filial = filialRow?.nome ?? 'Prainha';
  const prazo = c.fechaEm
    ? new Date(c.fechaEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : 'em breve';

  const fornecedores = await db
    .select({
      id: schema.cotacaoFornecedor.id,
      token: schema.cotacaoFornecedor.tokenPublico,
      nome: schema.fornecedor.nome,
      // WhatsApp da casa primeiro; fone_principal vem do Consumer e costuma
      // ser o fixo da empresa, onde a mensagem não chega.
      fone: sql<string | null>`COALESCE(NULLIF(${schema.fornecedor.foneWhatsapp}, ''), ${schema.fornecedor.fonePrincipal})`,
    })
    .from(schema.cotacaoFornecedor)
    .innerJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.cotacaoFornecedor.fornecedorId))
    // Só quem ainda não recebeu — evita reenvio duplicado ao reapertar "Enviar pra todos".
    .where(and(eq(schema.cotacaoFornecedor.cotacaoId, id), isNull(schema.cotacaoFornecedor.linkEnviadoEm)));

  let enviados = 0;
  let semTelefone = 0;
  const falhas: string[] = [];

  for (const f of fornecedores) {
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

  return NextResponse.json({ ok: true, enviados, semTelefone, falhas });
}
