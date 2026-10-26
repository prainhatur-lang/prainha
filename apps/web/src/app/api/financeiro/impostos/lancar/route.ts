// POST /api/financeiro/impostos/lancar — guia conferida vira contas a pagar.
// Body JSON: { guiaId, acao: 'lancar' | 'descartar', tipo, contribuinteCnpj,
//   contribuinteNome, competencia, vencimento, valor, codigoBarras, descricao,
//   regra, rateio: [{ filialId, percentual, valor? }] }
//
//   FOLHA com pagadora (E.B.): conta da guia inteira na E.B. + em cada casa uma
//     conta "repasse" com fornecedor E.B. (o Pix da casa pra E.B.).
//   FOLHA sem filial pagadora (Lelis): só as contas de repasse nas casas.
//   PERCENTUAL / CASA: a conta do imposto direto em cada casa, com a parte dela.
// Toda conta leva a guia como boleto (aparece em Pedidos Pix) e o código de
// barras na observação. Núcleo em lib/impostos/processar.ts.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { PERM_IMPOSTO_LANCAR } from '@/lib/impostos/guia';
import { lancarGuia, type BodyLancar } from '@/lib/impostos/processar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const negado = await negarSemPerm(user.id, PERM_IMPOSTO_LANCAR);
  if (negado) return negado;

  const b = (await req.json().catch(() => ({}))) as BodyLancar;
  const minhas = new Set((await filiaisDoUsuario(user.id)).map((f) => f.id));
  const r = await lancarGuia(b, user.id, minhas);
  return NextResponse.json(r.body, { status: r.status });
}
