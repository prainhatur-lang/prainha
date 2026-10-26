// POST /api/financeiro/impostos/ler — multipart com 'arquivo' (PDF ou foto da
// guia). A IA lê tipo, contribuinte, competência, vencimento, valor e código de
// barras; o arquivo vai pro storage e a guia fica LIDA com a proposta de
// rateio. Nada vira conta aqui — isso é o /lancar, depois da conferência.
// Mesmo arquivo de novo devolve a guia que já existe.
// Se o arquivo for o RATEIO do contador (INSS/FGTS por departamento), grava em
// imposto_rateio_contador e as guias da competência usam o valor de cada casa.
// JSON { guiaId } reabre uma guia LIDA pra conferir.
// Núcleo em lib/impostos/processar.ts (o link do contador usa o mesmo).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { PERM_IMPOSTO_LANCAR } from '@/lib/impostos/guia';
import { lerArquivo, reabrirGuia } from '@/lib/impostos/processar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const negado = await negarSemPerm(user.id, PERM_IMPOSTO_LANCAR);
  if (negado) return negado;

  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    const j = (await req.json().catch(() => ({}))) as { guiaId?: string };
    const r = await reabrirGuia(String(j.guiaId ?? ''));
    return NextResponse.json(r.body, { status: r.status });
  }
  if (!ct.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'use multipart/form-data' }, { status: 400 });
  }
  const form = await req.formData();
  const arquivo = form.get('arquivo');
  if (!(arquivo instanceof File)) return NextResponse.json({ error: 'envie o arquivo da guia' }, { status: 400 });
  const r = await lerArquivo(arquivo, user.id);
  return NextResponse.json(r.body, { status: r.status });
}
