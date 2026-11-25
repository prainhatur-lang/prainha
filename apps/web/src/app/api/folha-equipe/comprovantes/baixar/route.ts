// POST /api/folha-equipe/comprovantes/baixar { ids } — dá a baixa das contas
// FOLHA dos comprovantes CASADOS (data do depósito, valor − descontos, igual à
// baixa em lote da folha). Um comprovante que falhar não segura os outros.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { hojeBr } from '@/lib/datas';
import { exigirPermApi } from '@/lib/exigir-perm';
import {
  PERM_LOTERICA,
  RecusaComprovante,
  baixarComprovante,
  filialIdsDoUsuario,
} from '@/lib/comprovante-loterica';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Lote grande não pode ser cortado no meio (33 comprovantes de 23/11/2026
// ficaram casados sem baixa e ninguém viu — dono 25/11/2026).
export const maxDuration = 300;

export async function POST(req: Request) {
  const auth = await exigirPermApi(PERM_LOTERICA);
  if (auth.error) return auth.error;
  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === 'string').slice(0, 500) : [];
  if (ids.length === 0) return NextResponse.json({ error: 'nenhum comprovante escolhido' }, { status: 400 });

  const filiais = await filialIdsDoUsuario(auth.user.id);
  let contas = 0;
  let baixados = 0;
  const falhas: Array<{ id: string; erro: string }> = [];
  for (const id of ids) {
    try {
      const n = await baixarComprovante(id, auth.user.id, filiais);
      if (n > 0) baixados++;
      contas += n;
    } catch (e) {
      if (!(e instanceof RecusaComprovante)) console.error('[comprovantes/baixar]', id, e);
      falhas.push({ id, erro: (e as Error).message });
      // A falha fica escrita no próprio comprovante: aparece na lista e no
      // aviso do topo, em vez de sumir com a mensagem da tela.
      await db
        .update(schema.comprovanteLoterica)
        .set({ erro: `não baixou em ${hojeBr().split('-').reverse().join('/')}: ${(e as Error).message}`.slice(0, 500) })
        .where(and(eq(schema.comprovanteLoterica.id, id), eq(schema.comprovanteLoterica.status, 'CASADO')))
        .catch(() => undefined);
    }
  }
  return NextResponse.json({ ok: true, baixados, contas, falhas });
}
