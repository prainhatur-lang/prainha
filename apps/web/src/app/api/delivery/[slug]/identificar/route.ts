// POST /api/delivery/[slug]/identificar  { cpf }
//
// Cadastro unificado no checkout: o cliente digita o CPF e o delivery já sabe
// quem é — mesmo cadastro da reserva e do salão, mesma cascata
// (@/lib/identificar-cpf: nossas bases → cache → SPC).
//
// Público, e valem as MESMAS duas defesas da rota de reserva:
//  1. NÃO devolve cadastro. Só primeiro nome e telefone — o que o checkout
//     usa. Endereço, nascimento e nome da mãe ficam no servidor; devolver
//     isso viraria consulta de CPF de graça pra qualquer um.
//  2. Teto de consulta PAGA por filial por hora. Cache não conta (é de
//     graça). Batendo no teto o pedido continua — só deixa de consultar.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, gte, sql } from 'drizzle-orm';
import { cpfValido, hashCpf, spcConfigurado } from '@/lib/spc';
import { identificarPorCpf, primeiroNome, telefoneFormatado } from '@/lib/identificar-cpf';
import { lojaDeliveryPorSlug } from '@/lib/delivery/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Mesmo teto da reserva: uma casa cheia faz dezenas de pedidos por dia, não
 *  centenas por hora — quem passar disso é varredura, não cliente. */
const TETO_SPC_HORA = 40;

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const loja = await lojaDeliveryPorSlug(slug);
  if (!loja) return NextResponse.json({ error: 'loja não encontrada' }, { status: 404 });

  let body: { cpf?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'json inválido' }, { status: 400 });
  }

  const cpf = String(body.cpf ?? '').replace(/\D/g, '');
  if (!cpfValido(cpf)) return NextResponse.json({ error: 'CPF inválido' }, { status: 400 });

  // O teto só vale pra consulta NOVA — CPF já no cache sai de graça e passa
  // direto, mesmo com a filial no limite.
  let permitirSpc = spcConfigurado();
  if (permitirSpc) {
    const [jaTem] = await db
      .select({ cpfHash: schema.spcConsulta.cpfHash })
      .from(schema.spcConsulta)
      .where(eq(schema.spcConsulta.cpfHash, hashCpf(cpf)))
      .limit(1);
    if (!jaTem) {
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.spcConsulta)
        .where(and(
          eq(schema.spcConsulta.filialId, loja.filialId),
          gte(schema.spcConsulta.consultadoEm, sql`now() - interval '1 hour'`),
        ));
      if (n >= TETO_SPC_HORA) permitirSpc = false;
    }
  }

  try {
    const r = await identificarPorCpf(cpf, loja.filialId, { permitirSpc });
    const nome = primeiroNome(r.dados.nome);
    return NextResponse.json({
      conhecido: !!nome,
      // Nome COMPLETO aqui: o pedido sai no nome de quem recebe, e o
      // entregador precisa dele inteiro na porta.
      nome: r.dados.nome ?? null,
      primeiroNome: nome,
      telefone: telefoneFormatado(r.dados.celular ?? r.dados.telefone),
    });
  } catch {
    // Identificar é conveniência: falhou, o checkout segue pedindo os dados.
    return NextResponse.json({ conhecido: false, nome: null, primeiroNome: null, telefone: null });
  }
}
