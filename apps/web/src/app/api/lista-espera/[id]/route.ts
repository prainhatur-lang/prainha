// PATCH /api/lista-espera/[id] — ação no grupo: chamar (avisa no zap), sentou,
// desistiu. Chamar manda o WhatsApp "mesa pronta" (best-effort).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { enviarMesaPronta } from '@/lib/whatsapp-otp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function normTelefone(v: string | null): string | null {
  if (!v) return null;
  let d = v.replace(/\D/g, '');
  if (d.length < 10) return null;
  if (d.length <= 11) d = '55' + d;
  return d;
}

const ACOES = new Set(['chamar', 'sentou', 'desistiu']);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('lista_espera.update');
  if (error) return error;

  const { id } = await params;
  const b = await request.json().catch(() => ({}));
  const acao = typeof b?.acao === 'string' ? b.acao : '';
  if (!ACOES.has(acao)) {
    return NextResponse.json({ error: 'ação inválida' }, { status: 400 });
  }

  const [item] = await db
    .select({
      id: schema.listaEspera.id,
      filialId: schema.listaEspera.filialId,
      nome: schema.listaEspera.nome,
      telefone: schema.listaEspera.telefone,
      filialNome: schema.filial.nome,
    })
    .from(schema.listaEspera)
    .innerJoin(schema.filial, eq(schema.filial.id, schema.listaEspera.filialId))
    .where(eq(schema.listaEspera.id, id))
    .limit(1);
  if (!item) return NextResponse.json({ error: 'não encontrado' }, { status: 404 });

  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === item.filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  let zap: string | null = null;

  if (acao === 'chamar') {
    await db
      .update(schema.listaEspera)
      .set({ status: 'chamado', chamadoEm: sql`now()`, atualizadoEm: sql`now()` })
      .where(eq(schema.listaEspera.id, id));
    const tel = normTelefone(item.telefone);
    if (!tel) {
      zap = 'sem telefone';
    } else {
      try {
        const ok = await enviarMesaPronta(tel, {
          nome: (item.nome ?? '').split(' ')[0] || 'tudo bem',
          filial: item.filialNome ?? 'Prainha',
        });
        zap = ok ? 'enviado' : 'whatsapp não configurado';
      } catch (e) {
        zap = 'falha: ' + (e as Error).message;
      }
    }
  } else if (acao === 'sentou') {
    await db
      .update(schema.listaEspera)
      .set({ status: 'sentado', sentadoEm: sql`now()`, atualizadoEm: sql`now()` })
      .where(eq(schema.listaEspera.id, id));
  } else {
    await db
      .update(schema.listaEspera)
      .set({ status: 'desistiu', atualizadoEm: sql`now()` })
      .where(and(eq(schema.listaEspera.id, id)));
  }

  return NextResponse.json({ ok: true, zap });
}
