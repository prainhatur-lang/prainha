// GET /api/financeiro/caixa/conferir?filial= — veredito da conferência de TODO
// caixa aberto na loja: fecharia ou não, e por quê. Não fecha nada.
//
// É o que responde "não fechou hoje — por quê?" sem esperar a rotina das 04:00
// nem abrir o banco na mão. Roda a MESMA régua (caixaMaquininhaConfere) que o
// fechamento automático usa, então o que aparece aqui é o que vai acontecer.
import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { chamarLojaCaixa } from '@/lib/caixa-loja';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// A conferência consulta Firebird + Postgres por caixa (~2s pra 20 caixas,
// medido em produção no pico). O default da plataforma é menor que o timeout
// de 20s do chamarLojaCaixa — sem isto, loja LENTA (não caída) morre na
// plataforma e o gerente vê erro genérico em vez de "Loja fora do ar".
export const maxDuration = 30;

export async function GET(request: Request) {
  const { user, error } = await exigirPermApi('relatorio.read');
  if (error) return error;
  const filialId = new URL(request.url).searchParams.get('filial') ?? '';
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ ok: false, erro: 'filial não acessível' }, { status: 403 });
  }
  return NextResponse.json(await chamarLojaCaixa(filialId, '/conferir'));
}
