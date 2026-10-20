// GET /api/cron/regime-agendado
// Cron diário (08:10 UTC → 05:10 BRT): aplica no cadastro as mudanças de
// regime/salário marcadas em funcionario_regime_agenda cuja data chegou
// (ex.: intermitentes da escala base da Tabuará viram CLT em 01/11/2026).
// Roda de novo sem efeito: só pega linha sem aplicado_em e sem cancelado_em.
// Auth: Bearer CRON_SECRET.

import { NextResponse } from 'next/server';
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { hojeBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const hoje = hojeBr();
  // Mais de uma linha pra mesma pessoa: aplica em ordem de data; a última vence.
  const pendentes = (await db.execute(sql`
    SELECT a.id, a.funcionario_id, a.a_partir::text AS a_partir, a.regime_salarial, a.salario_base::text AS salario_base, f.nome
      FROM funcionario_regime_agenda a JOIN funcionario f ON f.id = a.funcionario_id
     WHERE a.aplicado_em IS NULL AND a.cancelado_em IS NULL AND a.a_partir <= ${hoje}::date
     ORDER BY a.a_partir, a.criado_em
  `)) as unknown as Array<{ id: string; funcionario_id: string; a_partir: string; regime_salarial: string; salario_base: string | null; nome: string }>;

  const aplicados: string[] = [];
  for (const p of pendentes) {
    await db.execute(sql`
      UPDATE funcionario
         SET regime_salarial = ${p.regime_salarial},
             salario_base = COALESCE(${p.salario_base}::numeric, salario_base)
       WHERE id = ${p.funcionario_id}::uuid`);
    await db.execute(sql`UPDATE funcionario_regime_agenda SET aplicado_em = now() WHERE id = ${p.id}::uuid`);
    aplicados.push(`${p.nome} → ${p.regime_salarial} ${p.salario_base ?? ''} (desde ${p.a_partir})`);
  }
  return NextResponse.json({ ok: true, hoje, aplicados });
}
