// Log das chamadas à API do iFood feitas em homologação (loja de teste) —
// o arquivo que o chamado de homologação pede.
//
//   GET ?filialId=&modulo=shipping&desde=ISO&ate=ISO  → JSON pra baixar

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { user, error } = await exigirPermApi('delivery.read');
  if (error) return error;
  const u = new URL(req.url);
  const filialId = u.searchParams.get('filialId') ?? '';
  const modulo = (u.searchParams.get('modulo') ?? 'shipping').slice(0, 20);
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }
  const desde = u.searchParams.get('desde');
  const ate = u.searchParams.get('ate');
  const filtros = [eq(schema.ifoodHomologLog.filialId, filialId), eq(schema.ifoodHomologLog.modulo, modulo)];
  if (desde && !Number.isNaN(Date.parse(desde))) filtros.push(gte(schema.ifoodHomologLog.quando, new Date(desde)));
  if (ate && !Number.isNaN(Date.parse(ate))) filtros.push(lte(schema.ifoodHomologLog.quando, new Date(ate)));

  const linhas = await db
    .select()
    .from(schema.ifoodHomologLog)
    .where(and(...filtros))
    .orderBy(asc(schema.ifoodHomologLog.quando))
    .limit(5000);

  const chamadas = linhas.map((l) => {
    let resposta: unknown = l.resposta;
    try { resposta = l.resposta ? JSON.parse(l.resposta) : null; } catch { /* texto */ }
    return {
      quando: l.quando.toISOString(),
      metodo: l.metodo,
      url: 'https://merchant-api.ifood.com.br' + l.caminho,
      status: l.status,
      ms: l.ms,
      tentativa: l.tentativa,
      pedido: l.pedido,
      resposta,
    };
  });
  const corpo = JSON.stringify({ modulo, filialId, total: chamadas.length, chamadas }, null, 2);
  return new NextResponse(corpo, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="ifood-${modulo}-log.json"`,
    },
  });
}
