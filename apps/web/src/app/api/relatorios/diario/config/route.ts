// GET/POST /api/relatorios/diario/config — quem recebe o relatório diário das
// casas pelo WhatsApp (só o DONO mexe).

import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import {
  lerConfig,
  salvarConfig,
  normalizarTelefone,
  organizacoesDoDono,
  ultimosEnvios,
} from '@/lib/relatorio-diario-envio';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function organizacaoDoDono(userId: string, pedida?: string | null) {
  const orgs = await organizacoesDoDono(userId);
  return (pedida ? orgs.find((o) => o.id === pedida) : orgs[0]) ?? null;
}

export async function GET(req: Request) {
  const guard = await exigirPermApi('relatorio.read');
  if (guard.error) return guard.error;
  const org = await organizacaoDoDono(guard.user.id, new URL(req.url).searchParams.get('organizacaoId'));
  if (!org) return NextResponse.json({ error: 'só o dono configura o envio' }, { status: 403 });
  const [config, envios] = await Promise.all([lerConfig(org.id), ultimosEnvios(org.id)]);
  return NextResponse.json({ ok: true, config, envios });
}

export async function POST(req: Request) {
  const guard = await exigirPermApi('relatorio.read');
  if (guard.error) return guard.error;
  const body = (await req.json().catch(() => null)) as
    | { organizacaoId?: string; ativo?: boolean; telefones?: unknown }
    | null;
  if (!body) return NextResponse.json({ error: 'corpo inválido' }, { status: 400 });
  const org = await organizacaoDoDono(guard.user.id, body.organizacaoId);
  if (!org) return NextResponse.json({ error: 'só o dono configura o envio' }, { status: 403 });

  const brutos = Array.isArray(body.telefones) ? body.telefones.map((t) => String(t)) : [];
  const telefones: string[] = [];
  const invalidos: string[] = [];
  for (const b of brutos) {
    if (!b.trim()) continue;
    const n = normalizarTelefone(b);
    if (n) telefones.push(n);
    else invalidos.push(b.trim());
  }
  if (invalidos.length) {
    return NextResponse.json(
      { error: `Número inválido: ${invalidos.join(', ')}. Use DDD + número (ex.: 79 99999-0000).` },
      { status: 400 },
    );
  }
  const config = await salvarConfig(org.id, { ativo: body.ativo !== false, telefones }, guard.user.id);
  return NextResponse.json({ ok: true, config });
}
