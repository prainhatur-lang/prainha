// POST /api/nfce/[id]/nfe — converte o cupom (NFC-e autorizada) em NF-e
// (modelo 55) no CNPJ/CPF do cliente. O cupom continua válido; a nota sai com
// CFOP 5929 referenciando a chave dele. Idempotente: repetir devolve a mesma
// nota. { homologacao: true } emite no ambiente de teste da SEFAZ.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { exigirPermApi } from '@/lib/exigir-perm';
import { emitirNfeDoCupom } from '@/lib/nfe/emitir-cupom';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const txt = (max: number) => z.string().trim().max(max);
const Body = z.object({
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
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('nfce.emitir');
  if (error) return error;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'preencha os dados do cliente' }, { status: 400 });

  const r = await emitirNfeDoCupom({
    nfceId: id,
    userId: user.id,
    destinatario: parsed.data.destinatario,
    homologacao: parsed.data.homologacao === true,
  });
  if (!r.ok) {
    return NextResponse.json(
      { error: r.erro, cstat: r.cstat, transitorio: r.transitorio === true },
      { status: r.transitorio ? 503 : 400 },
    );
  }
  return NextResponse.json({ ok: true, jaExistia: r.jaExistia, nota: r.nota });
}
