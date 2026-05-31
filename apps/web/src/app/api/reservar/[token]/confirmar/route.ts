// POST /api/reservar/[token]/confirmar — valida o OTP e cria a reserva.
// Publico. Body: { telefone, codigo, nome, espaco, data, hora, pessoas, observacao }

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, desc, eq, isNull } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function normTelefone(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let d = v.replace(/\D/g, '');
  if (d.length < 10 || d.length > 13) return null;
  if (d.length <= 11) d = '55' + d;
  return d;
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) return NextResponse.json({ error: 'token inválido' }, { status: 404 });

  const [filial] = await db
    .select({
      id: schema.filial.id,
      nome: schema.filial.nome,
      reservaConfig: schema.filial.reservaConfig,
    })
    .from(schema.filial)
    .where(eq(schema.filial.avaliacaoToken, token))
    .limit(1);
  if (!filial) return NextResponse.json({ error: 'filial não encontrada' }, { status: 404 });

  const b = await request.json().catch(() => null);
  const telefone = normTelefone(b?.telefone);
  const codigo = typeof b?.codigo === 'string' ? b.codigo.replace(/\D/g, '') : '';
  const nome = typeof b?.nome === 'string' ? b.nome.trim().slice(0, 200) : '';
  const espaco = typeof b?.espaco === 'string' ? b.espaco.trim().slice(0, 100) : '';
  const data = typeof b?.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.data) ? b.data : null;
  const hora = typeof b?.hora === 'string' && /^\d{2}:\d{2}$/.test(b.hora) ? b.hora : null;
  const pessoas = Number.isInteger(b?.pessoas) && b.pessoas > 0 ? Math.min(b.pessoas, 99) : 0;

  if (!telefone || !codigo || !nome || !data || !hora || !pessoas) {
    return NextResponse.json({ error: 'preencha todos os campos' }, { status: 400 });
  }

  // Valida espaco + hora limite
  const cfg = filial.reservaConfig;
  const areaCfg = cfg?.areas?.find((a) => a.nome === espaco);
  if (!areaCfg || !areaCfg.ativo || areaCfg.somenteEventos) {
    return NextResponse.json({ error: 'espaço indisponível para reserva' }, { status: 400 });
  }
  if (areaCfg.horaLimite && hora > areaCfg.horaLimite) {
    return NextResponse.json(
      { error: `${espaco} aceita reserva só até ${areaCfg.horaLimite}` },
      { status: 400 },
    );
  }

  // Valida OTP: ultimo codigo nao verificado deste telefone/filial
  const [otp] = await db
    .select()
    .from(schema.reservaOtp)
    .where(
      and(
        eq(schema.reservaOtp.filialId, filial.id),
        eq(schema.reservaOtp.telefone, telefone),
        isNull(schema.reservaOtp.verificadoEm),
      ),
    )
    .orderBy(desc(schema.reservaOtp.criadoEm))
    .limit(1);

  if (!otp) return NextResponse.json({ error: 'peça um código primeiro' }, { status: 400 });
  if (otp.tentativas >= 5) return NextResponse.json({ error: 'muitas tentativas. Peça um novo código.' }, { status: 429 });
  if (new Date(otp.expiraEm).getTime() < Date.now()) {
    return NextResponse.json({ error: 'código expirado. Peça um novo.' }, { status: 400 });
  }
  if (otp.codigo !== codigo) {
    await db.update(schema.reservaOtp).set({ tentativas: otp.tentativas + 1 }).where(eq(schema.reservaOtp.id, otp.id));
    return NextResponse.json({ error: 'código incorreto' }, { status: 400 });
  }

  // OK — marca verificado e cria a reserva
  await db.update(schema.reservaOtp).set({ verificadoEm: new Date() }).where(eq(schema.reservaOtp.id, otp.id));

  const valorAtual = typeof cfg?.valorAtual === 'number' ? cfg.valorAtual : 0;
  await db.insert(schema.reserva).values({
    filialId: filial.id,
    clienteNome: nome,
    clienteTelefone: telefone,
    pessoas,
    data,
    hora,
    status: 'confirmada',
    area: espaco,
    canal: 'site',
    observacao: typeof b?.observacao === 'string' && b.observacao.trim() ? b.observacao.trim().slice(0, 2000) : null,
    valor: String(valorAtual.toFixed(2)),
  });

  return NextResponse.json({
    ok: true,
    valorCheio: typeof cfg?.valorCheio === 'number' ? cfg.valorCheio : null,
    valorAtual,
  });
}
