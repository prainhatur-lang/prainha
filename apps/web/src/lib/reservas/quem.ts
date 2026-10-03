// Quem é a pessoa por trás do telefone (ou CPF) digitado na Nova reserva.
//
// Mesma resposta do GET /api/reservas/quem (o painel) — aqui em forma de
// função pra recepção da LOJA (vendas-local /reservas → /api/loja/salao,
// tipo `reserva_quem`) ter o MESMO "já é de casa" sem sessão de usuário.
// Identifica por chave FORTE (telefone/CPF), nunca por nome.
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { acharCliente } from '@/lib/cliente-unico';
import { hojeBr } from '@/lib/datas';

export type QuemReserva =
  | { ok: true; achou: false; curto: true }
  | {
      ok: true;
      achou: boolean;
      nome: string | null;
      contato: { origem: string; reservas: number; filas: number } | null;
      clientePdv: boolean;
      fiadoSaldo: number;
      visitas: number;
      ultima: string | null;
      ativas: Array<{ data: string; hora: string; status: string }>;
      telefone: string | null;
      por: string;
    };

export async function quemEhDaReserva(filialId: string, q: string): Promise<QuemReserva> {
  const dig = String(q ?? '').replace(/\D/g, '').slice(0, 14);
  if (dig.length < 8) return { ok: true, achou: false, curto: true };

  // Cliente do PDV por chave forte (telefone ou CPF).
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

  // Contatos importados (Tagme e afins): histórico de ANTES do Concilia.
  let contato: { nome: string; reservas: number; filas: number; origem: string } | null = null;
  const suf10 = dig.slice(-10);
  if (suf10.length >= 8) {
    const [ct] = await db
      .select({
        nome: schema.clienteContato.nome,
        sobrenome: schema.clienteContato.sobrenome,
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
        reservas: Number(ct.reservas ?? 0),
        filas: Number(ct.filas ?? 0),
        origem: ct.origem,
      };
    }
  }

  // Histórico pelo telefone digitado — ou, achando por CPF, pelo do cadastro.
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
        ativas.push({ data: r.data, hora: String(r.hora).slice(0, 5), status: r.status });
      }
    }
  }

  const achou = !!lig || visitas > 0 || !!nomeReserva || !!contato;
  return {
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
  };
}
