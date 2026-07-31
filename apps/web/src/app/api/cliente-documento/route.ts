// Base de clientes COMPARTILHADA entre as filiais.
//
// GET  ?h=<cpf_hash>&f=<filial>&e=<expira>&s=<assinatura>  -> acha o nome
// POST { h, nome, tel, f, e, s }                            -> publica um novo
//
// Chamado pelo vendas-local de cada loja, que nao tem sessao aqui: a
// autorizacao e' a mesma assinatura HMAC do /pagar-mesa. Sem ela, qualquer
// um leria a base de clientes do grupo sabendo um hash.
//
// Nunca trafega CPF: a loja manda o HASH, calculado com o mesmo salt.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Mesma chave do /pagar-mesa: a loja ja a tem configurada. */
function confere(partes: string[], sig: string): boolean {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return false;
  const esperada = createHmac('sha256', seg).update(partes.join('|')).digest('hex');
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(sig || ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** A filial diz a que organizacao pertence — a base e' do grupo, nao da loja. */
async function orgDaFilial(filialId: string): Promise<string | null> {
  const [f] = await db
    .select({ org: schema.filial.organizacaoId })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  return f?.org ?? null;
}

function valida(sp: URLSearchParams | Record<string, string>) {
  const g = (k: string) => (sp instanceof URLSearchParams ? sp.get(k) : sp[k]) || '';
  const h = g('h'), f = g('f'), e = Number(g('e')), s = g('s');
  if (!/^[a-f0-9]{64}$/.test(h) || !f || !Number.isFinite(e)) return null;
  if (e * 1000 < Date.now()) return null;
  if (!confere([f, h, String(e)], s)) return null;
  return { h, f };
}

export async function GET(request: Request) {
  const v = valida(new URL(request.url).searchParams);
  if (!v) return NextResponse.json({ error: 'assinatura inválida ou expirada' }, { status: 403 });
  const org = await orgDaFilial(v.f);
  if (!org) return NextResponse.json({ error: 'filial não encontrada' }, { status: 404 });
  const [c] = await db
    .select({ nome: schema.clienteDocumento.nome, origem: schema.clienteDocumento.origem,
      telefoneFim: schema.clienteDocumento.telefoneFim })
    .from(schema.clienteDocumento)
    .where(and(eq(schema.clienteDocumento.organizacaoId, org), eq(schema.clienteDocumento.cpfHash, v.h)))
    .limit(1);
  return NextResponse.json({ ok: true, achou: !!c, nome: c?.nome ?? null, origem: c?.origem ?? null,
    telefone_fim: c?.telefoneFim ?? null });
}

export async function POST(request: Request) {
  const b = await request.json().catch(() => null);
  if (!b) return NextResponse.json({ error: 'corpo inválido' }, { status: 400 });
  const v = valida(b as Record<string, string>);
  if (!v) return NextResponse.json({ error: 'assinatura inválida ou expirada' }, { status: 403 });
  const org = await orgDaFilial(v.f);
  if (!org) return NextResponse.json({ error: 'filial não encontrada' }, { status: 404 });
  const nome = String(b.nome || '').trim().slice(0, 160);
  if (!nome) return NextResponse.json({ error: 'nome obrigatório' }, { status: 400 });
  const tel = String(b.tel || '').replace(/\D/g, '').slice(-8) || null;
  const origem = ['consumer', 'spc', 'manual', 'importacao'].includes(String(b.origem))
    ? String(b.origem) : 'manual';
  await db
    .insert(schema.clienteDocumento)
    .values({ organizacaoId: org, cpfHash: v.h, nome, telefoneFim: tel, origem, filialId: v.f })
    .onConflictDoUpdate({
      target: [schema.clienteDocumento.organizacaoId, schema.clienteDocumento.cpfHash],
      set: { nome, telefoneFim: tel, atualizadoEm: new Date() },
    });
  return NextResponse.json({ ok: true });
}
