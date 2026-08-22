// POST /api/reservar/[token]/identificar  { cpf }
//
// A reserva começa pelo CPF: em vez de pedir nome e telefone, a gente
// descobre quem é. A cascata é a de @/lib/identificar-cpf (nossas bases →
// cache → SPC). Público — o token na URL identifica a filial, não tem login.
//
// ⚠️ ROTA PÚBLICA COM SPC ATRÁS. Duas defesas obrigatórias:
//
//  1. NÃO devolve cadastro. Só primeiro nome e telefone MASCARADO — o que a
//     pessoa precisa pra se reconhecer. Devolver endereço/nascimento/nome da
//     mãe transformaria a página de reserva em consulta de CPF de graça pra
//     qualquer um (e o dado é de terceiro, não de quem está digitando).
//  2. Teto de consulta PAGA por filial por hora. Cache não conta (é de graça);
//     o teto existe só pra ninguém varrer CPF na nossa conta do SPC. Batendo
//     no teto, a reserva continua — só deixa de consultar e pede o nome.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, gte, sql } from 'drizzle-orm';
import { cpfValido, hashCpf, spcConfigurado } from '@/lib/spc';
import { identificarPorCpf, primeiroNome, telefoneMascarado } from '@/lib/identificar-cpf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Consultas PAGAS que uma filial pode disparar pelo site em 1 hora. Uma casa
 *  cheia faz dezenas de reservas por dia, não centenas por hora — quem passar
 *  disso é varredura, não cliente. */
const TETO_SPC_HORA = 40;

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) return NextResponse.json({ error: 'token inválido' }, { status: 404 });

  const [filial] = await db
    .select({ id: schema.filial.id })
    .from(schema.filial)
    .where(eq(schema.filial.avaliacaoToken, token))
    .limit(1);
  if (!filial) return NextResponse.json({ error: 'não encontrado' }, { status: 404 });

  let body: { cpf?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'json inválido' }, { status: 400 });
  }

  const cpf = String(body.cpf ?? '').replace(/\D/g, '');
  if (!cpfValido(cpf)) return NextResponse.json({ error: 'CPF inválido' }, { status: 400 });

  // O teto só vale pra consulta NOVA. CPF que já está no cache sai de graça e
  // passa direto, mesmo com a filial no limite.
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
          eq(schema.spcConsulta.filialId, filial.id),
          gte(schema.spcConsulta.consultadoEm, sql`now() - interval '1 hour'`),
        ));
      if (n >= TETO_SPC_HORA) permitirSpc = false;
    }
  }

  try {
    const r = await identificarPorCpf(cpf, filial.id, { permitirSpc });
    const nome = primeiroNome(r.dados.nome);
    const fone = r.dados.celular ?? r.dados.telefone;
    return NextResponse.json({
      conhecido: !!nome,
      primeiroNome: nome,
      // Mascarado de propósito: serve pro cliente confirmar que é o número
      // dele, sem entregar telefone de terceiro pra quem digitou o CPF.
      telefoneMascarado: telefoneMascarado(fone),
      temTelefone: !!telefoneMascarado(fone),
    });
  } catch {
    // Identificação é conveniência: falhou, a reserva segue pedindo o nome.
    return NextResponse.json({ conhecido: false, primeiroNome: null, telefoneMascarado: null, temTelefone: false });
  }
}
