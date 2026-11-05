// Pagamentos da folha (do sistema: ponto + salário do cadastro) → contas a pagar (05/11/2026). Regra em
// lib/rh/folha-contador-pagamentos.ts.
// GET  ?filialId&comp → o que a casa tem pra lançar (simulação, não grava)
// POST { filialId, comp, refs[], vencimento } → cria as contas (pula as já lançadas)
// Ver: 'folha_equipe.read'. Lançar: + 'conta_pagar.create'.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { exigirPermApi, negarSemPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { hojeBr } from '@/lib/datas';
import { saidasNoMes, semSalarioNoMes } from '@/lib/rh/nossa-folha';
import { diaristasForaDaFolha, lancarPagamentosDaFolha, pagamentosDaFolha, quintoDiaUtil } from '@/lib/rh/folha-contador-pagamentos';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COMP = /^\d{4}-\d{2}$/;

async function podeCasa(userId: string, filialId: string) {
  const filiais = await filiaisDoUsuario(userId);
  return filiais.some((f) => f.id === filialId);
}

export async function GET(req: Request) {
  const auth = await exigirPermApi('folha_equipe.read');
  if (auth.error) return auth.error;
  const url = new URL(req.url);
  const filialId = url.searchParams.get('filialId') ?? '';
  const comp = url.searchParams.get('comp') ?? '';
  if (!COMP.test(comp) || !filialId) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  if (!(await podeCasa(auth.user.id, filialId))) return NextResponse.json({ error: 'sem acesso à casa' }, { status: 403 });
  const [itens, semSalario, saidas, registro] = await Promise.all([
    pagamentosDaFolha(filialId, comp),
    semSalarioNoMes(filialId, comp),
    saidasNoMes(filialId, comp),
    diaristasForaDaFolha(filialId, comp),
  ]);
  return NextResponse.json({ itens, semSalario, saidas, diaristas: registro.diaristas, semExtrato: registro.semExtrato, vencimento: quintoDiaUtil(comp), previa: comp >= hojeBr().slice(0, 7) });
}

const Body = z.object({
  filialId: z.string().uuid(),
  comp: z.string().regex(COMP),
  refs: z.array(z.string().min(1).max(50)).min(1).max(200),
  vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fora: z.array(z.string().min(1).max(200)).max(200).optional(),
});

export async function POST(req: Request) {
  const auth = await exigirPermApi('folha_equipe.read');
  if (auth.error) return auth.error;
  const semPerm = await negarSemPerm(auth.user.id, 'conta_pagar.create');
  if (semPerm) return semPerm;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  const d = parsed.data;
  if (d.comp >= hojeBr().slice(0, 7)) return NextResponse.json({ error: 'mês ainda não fechou: a folha é prévia' }, { status: 400 });
  if (!(await podeCasa(auth.user.id, d.filialId))) return NextResponse.json({ error: 'sem acesso à casa' }, { status: 403 });
  const r = await lancarPagamentosDaFolha({ casaFilialId: d.filialId, comp: d.comp, refs: d.refs, vencimento: d.vencimento, usuarioId: auth.user.id, fora: d.fora });
  return NextResponse.json(r);
}
