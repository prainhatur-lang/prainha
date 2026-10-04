// GET /api/atendimento/pendentes — clientes que a Nina passou pra equipe e
// que ainda estão esperando alguém responder. Alimenta o aviso que aparece em
// todas as telas do app (components/aviso-nina.tsx).
//
// "Esperando" = conversa em status `humano`, cliente falou nas últimas 24h
// (depois disso a janela do WhatsApp fecha) e a última mensagem NÃO é da
// equipe — assim que alguém responde, sai da lista; se o cliente escrever de
// novo, volta.

import { NextResponse } from 'next/server';
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const { user, error } = await exigirPermApi('atendimento.read');
  if (error) return error;

  const filiais = await filiaisDoUsuario(user.id);
  if (filiais.length === 0) return NextResponse.json({ pendentes: [] });
  const ids = sql.join(filiais.map((f) => sql`${f.id}::uuid`), sql`, `);

  const rows = (await db.execute(sql`
    SELECT c.id, c.filial_id, c.nome_cliente, c.telefone, c.motivo_transferencia,
           c.ultima_msg_cliente_em
    FROM atendimento_conversa c
    WHERE c.filial_id IN (${ids})
      AND c.status = 'humano'
      AND c.ultima_msg_cliente_em > now() - interval '24 hours'
      AND COALESCE((
        SELECT m.autor FROM atendimento_mensagem m
        WHERE m.conversa_id = c.id
        ORDER BY m.criado_em DESC LIMIT 1
      ), 'cliente') <> 'equipe'
    ORDER BY c.ultima_msg_cliente_em ASC
    LIMIT 30
  `)) as unknown as Array<{
    id: string; filial_id: string; nome_cliente: string | null; telefone: string;
    motivo_transferencia: string | null; ultima_msg_cliente_em: string | null;
  }>;

  const nomes = new Map(filiais.map((f) => [f.id, f.nome]));
  return NextResponse.json({
    pendentes: rows.map((r) => ({
      id: r.id,
      nome: r.nome_cliente || r.telefone,
      motivo: r.motivo_transferencia,
      desde: r.ultima_msg_cliente_em,
      filialNome: nomes.get(r.filial_id) ?? '',
    })),
  });
}
