// GET /api/reservas/quem?filialId=…&q=… — quem é a pessoa por trás do telefone
// (ou CPF) digitado na Nova reserva da casa.
//
// Mesmo padrão do cadastro único (lib/cliente-unico): identifica por chave
// FORTE, nunca por nome. Devolve o nome pra preencher, quantas reservas a
// pessoa já fez na filial (e a última), se é cliente do PDV — com o saldo de
// fiado quando deve — e as reservas ativas do mesmo telefone, pra casa não
// criar duplicada sem querer.
import { NextResponse } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { acharCliente } from '@/lib/cliente-unico';
import { hojeBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { user, error } = await exigirPermApi('reserva.create');
  if (error) return error;

  const u = new URL(request.url);
  const filialId = String(u.searchParams.get('filialId') ?? '');
  const dig = String(u.searchParams.get('q') ?? '').replace(/\D/g, '').slice(0, 14);
  if (!/^[0-9a-f-]{36}$/i.test(filialId)) {
    return NextResponse.json({ error: 'filialId inválido' }, { status: 400 });
  }
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }
  if (dig.length < 8) return NextResponse.json({ ok: true, achou: false, curto: true });

  // Cliente do PDV por chave forte. Um celular de 11 dígitos também passa no
  // tamanho de CPF, mas colidir com um CPF cadastrado é improvável — e o
  // telefone cobre o resto (acharCliente tenta os dois).
  const lig = await acharCliente(filialId, { telefone: dig, cpf: dig });
  let cliente: { nome: string | null; telefone: string | null; saldo: number } | null = null;
  if (lig) {
    const [c] = await db
      .select({
        nome: schema.cliente.nome,
        telefone: schema.cliente.telefone,
        saldo: schema.cliente.saldoAtualContaCorrente,
      })
      .from(schema.cliente)
      .where(eq(schema.cliente.id, lig.id))
      .limit(1);
    if (c) cliente = { nome: c.nome, telefone: c.telefone, saldo: Number(c.saldo ?? 0) };
  }

  // Contatos importados (Tagme e afins): é onde mora o histórico de reservas
  // de ANTES do Concilia — cliente antigo pode só existir aqui (caso Peterson,
  // 02/09: telefone certo, zero reservas nossas, 1 fila no Tagme).
  let contato: { nome: string; email: string | null; reservas: number; filas: number; origem: string } | null = null;
  const suf10 = dig.slice(-10);
  if (suf10.length >= 8) {
    const [ct] = await db
      .select({
        nome: schema.clienteContato.nome,
        sobrenome: schema.clienteContato.sobrenome,
        email: schema.clienteContato.email,
        reservas: schema.clienteContato.reservasHistorico,
        filas: schema.clienteContato.filasEsperaHistorico,
        origem: schema.clienteContato.origem,
      })
      .from(schema.clienteContato)
      .where(and(
        eq(schema.clienteContato.filialId, filialId),
        sql`right(regexp_replace(coalesce(${schema.clienteContato.telefone}, ''), '\\D', '', 'g'), ${suf10.length}) = ${suf10}`,
      ))
      .limit(1);
    if (ct) {
      contato = {
        nome: [ct.nome, ct.sobrenome].filter(Boolean).join(' '),
        email: ct.email,
        reservas: Number(ct.reservas ?? 0),
        filas: Number(ct.filas ?? 0),
        origem: ct.origem,
      };
    }
  }

  // Histórico pelo telefone digitado — ou, quando achou por CPF, pelo telefone
  // do cadastro (é ele que amarra as reservas).
  const telHist = lig?.por === 'cpf' ? (cliente?.telefone ?? '').replace(/\D/g, '') : dig;
  const suf = telHist.slice(-8);
  const hoje = hojeBr();
  let visitas = 0;
  let ultima: string | null = null;
  let nomeReserva: string | null = null;
  const ativas: Array<{ data: string; hora: string; status: string }> = [];
  if (suf.length === 8) {
    const rs = await db
      .select({
        nome: schema.reserva.clienteNome,
        data: sql<string>`${schema.reserva.data}::text`,
        hora: schema.reserva.hora,
        status: schema.reserva.status,
      })
      .from(schema.reserva)
      .where(and(
        eq(schema.reserva.filialId, filialId),
        sql`right(regexp_replace(coalesce(${schema.reserva.clienteTelefone}, ''), '\\D', '', 'g'), 8) = ${suf}`,
      ))
      .orderBy(desc(schema.reserva.data))
      .limit(200);
    for (const r of rs) {
      if (!nomeReserva && r.nome) nomeReserva = r.nome;
      const desistiu = r.status === 'cancelada' || r.status === 'no_show';
      if (r.data < hoje && !desistiu) {
        visitas += 1;
        if (!ultima || r.data > ultima) ultima = r.data;
      }
      if (r.data >= hoje && (r.status === 'pendente' || r.status === 'confirmada') && ativas.length < 3) {
        ativas.push({ data: r.data, hora: r.hora, status: r.status });
      }
    }
  }

  const achou = !!lig || visitas > 0 || !!nomeReserva || !!contato;
  return NextResponse.json({
    ok: true,
    achou,
    nome: cliente?.nome ?? nomeReserva ?? contato?.nome ?? null,
    contato: contato ? { origem: contato.origem, reservas: contato.reservas, filas: contato.filas } : null,
    clientePdv: !!lig,
    fiadoSaldo: cliente && cliente.saldo > 0 ? cliente.saldo : 0,
    visitas,
    ultima,
    ativas,
    telefone: cliente?.telefone ?? null,
    por: lig?.por ?? 'telefone',
  });
}
