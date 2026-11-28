// POST /api/agua/comando { tipo } — pedido pra placa dos filtros feito no
// Concilia online. A nuvem NÃO alcança a placa (ela só responde na rede da
// loja e a API dela não tem senha): o pedido entra na fila agua_comandos e o
// servidor da loja busca no próximo envio (até 1 minuto), executa e devolve o
// resultado. Só as ações de retrolavagem — relé avulso e teste rápido são só
// na tela Água da loja. Pedido que a loja não busca em 10 minutos expira.

import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { pedirComandoPlaca, AGUA_TIPOS_PLACA } from '@/lib/agua';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { user, error } = await exigirPermApi('agua.control');
  if (error) return error;

  const body = (await req.json().catch(() => null)) as { tipo?: unknown } | null;
  const tipo = String(body?.tipo ?? '');
  if (!(AGUA_TIPOS_PLACA as readonly string[]).includes(tipo)) {
    return NextResponse.json({ error: 'Pedido desconhecido.' }, { status: 400 });
  }
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const nome = String(meta.nome || meta.name || meta.full_name || user.email || 'Concilia online').slice(0, 60);
  try {
    const r = await pedirComandoPlaca(tipo as (typeof AGUA_TIPOS_PLACA)[number], user.id, nome);
    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 409 });
    return NextResponse.json({ ok: true, id: r.id });
  } catch (e) {
    console.error('[agua] pedido pra placa falhou', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível registrar o pedido.' }, { status: 500 });
  }
}
