// POST /api/rh/extrato-empresa — busca agora, na API do Inter, o extrato da
// empresa que paga pessoal (E.B. Serviços) e grava o que ainda não está em
// `extrato_empresa`. Botão da tela /rh/folha-contador/pagamentos.
// Só leitura no banco; não dá baixa nem gera conta.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { exigirPermApi } from '@/lib/exigir-perm';
import { hojeBr, diasAtrasBr } from '@/lib/datas';
import { EMPRESAS_EXTRATO, extratoEmpresaConfigurado, sincronizarExtratoEmpresa } from '@/lib/extrato-empresa';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z.object({
  empresa: z.enum(Object.keys(EMPRESAS_EXTRATO) as ['EB']).default('EB'),
  dias: z.number().int().min(1).max(365).default(120),
});

export async function POST(req: Request) {
  const { error } = await exigirPermApi('folha_equipe.read');
  if (error) return error;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  const { empresa, dias } = parsed.data;

  if (!extratoEmpresaConfigurado(empresa)) {
    return NextResponse.json(
      { error: `A integração do Inter da ${EMPRESAS_EXTRATO[empresa].nome} ainda não foi salva (INTER_${empresa}_*).` },
      { status: 409 },
    );
  }
  try {
    const r = await sincronizarExtratoEmpresa(empresa, diasAtrasBr(dias), hojeBr());
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.slice(0, 400) }, { status: 502 });
  }
}
