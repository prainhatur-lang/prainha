// POST /api/delivery-admin/fotos-da-loja { filialId } — traz do servidor da
// loja a foto dos itens do delivery que estão sem foto (só itens ligados a um
// produto do salão desta casa; nunca troca foto que já existe).
import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { puxarFotosDaLoja } from '@/lib/delivery/fotos-da-loja';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request) {
  const { user, error } = await exigirPermApi('delivery.update');
  if (error) return error;
  const b = await request.json().catch(() => null);
  const filialId = typeof b?.filialId === 'string' ? b.filialId : '';
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }
  const r = await puxarFotosDaLoja(filialId);
  if (!r.ok) return NextResponse.json({ error: r.erro ?? 'falhou', ...r }, { status: 502 });
  return NextResponse.json(r);
}
