// POST /api/nfe/avulsa — emite a NF-e (modelo 55) de venda de um bem do ativo
// imobilizado da casa (o carro, um equipamento) pro comprador. Idempotente
// pelo id que a tela gera: repetir devolve a mesma nota.
// { homologacao: true } emite no ambiente de teste da SEFAZ.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { exigirPermApi } from '@/lib/exigir-perm';
import { emitirNfeAvulsa } from '@/lib/nfe/emitir-avulsa';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const txt = (max: number) => z.string().trim().max(max);
const Body = z.object({
  id: z.string().uuid(),
  filialId: z.string().uuid(),
  homologacao: z.boolean().optional(),
  destinatario: z.object({
    documento: txt(20),
    nome: txt(120),
    ie: txt(20).optional(),
    email: txt(80).optional(),
    logradouro: txt(120),
    numero: txt(60).optional(),
    complemento: txt(60).optional(),
    bairro: txt(60),
    codigoMunicipio: txt(10),
    municipio: txt(60),
    uf: txt(2),
    cep: txt(10),
    fone: txt(20).optional(),
  }),
  item: z.object({
    descricao: txt(120).min(2),
    detalhe: txt(500).optional(),
    ncm: txt(12),
    valor: z.number().positive().max(99_999_999),
    origem: txt(1).optional(),
  }),
  formaPagamento: txt(2),
  revenda: z.boolean().optional(),
  fiscal: z
    .object({
      cfop: txt(4).optional(),
      cst: txt(2).optional(),
      cstPisCofins: txt(2).optional(),
      cstIbsCbs: txt(3).optional(),
      classTrib: txt(6).optional(),
    })
    .optional(),
  infoExtra: txt(2000).optional(),
});

export async function POST(req: Request) {
  const { user, error } = await exigirPermApi('nfce.emitir');
  if (error) return error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const campo = parsed.error.issues[0]?.path.join('.') ?? '';
    return NextResponse.json({ error: `confira os dados da nota${campo ? ` (${campo})` : ''}` }, { status: 400 });
  }
  const d = parsed.data;

  const r = await emitirNfeAvulsa({
    id: d.id,
    filialId: d.filialId,
    userId: user.id,
    destinatario: d.destinatario,
    itens: [
      {
        descricao: d.item.descricao,
        detalhe: d.item.detalhe,
        ncm: d.item.ncm,
        quantidade: 1,
        unidade: 'UN',
        valorTotal: d.item.valor,
        origem: d.item.origem,
      },
    ],
    formaPagamento: d.formaPagamento,
    revenda: d.revenda === true,
    fiscal: d.fiscal,
    infoExtra: d.infoExtra,
    homologacao: d.homologacao === true,
  });
  if (!r.ok) {
    return NextResponse.json(
      { error: r.erro, cstat: r.cstat, transitorio: r.transitorio === true },
      { status: r.transitorio ? 503 : 400 },
    );
  }
  return NextResponse.json({ ok: true, jaExistia: r.jaExistia, nota: r.nota, aviso: r.aviso });
}
