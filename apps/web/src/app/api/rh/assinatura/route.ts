// Assinatura eletrônica de documento pelo funcionário (29/10/2026) — lado da
// empresa. Regra em lib/rh/assinatura.ts.
// POST { acao: 'criar', documentoId }  → link /op/assinar/<token> + link do WhatsApp
//      (se já tem um pedido aguardando e dentro do prazo, devolve o mesmo)
// POST { acao: 'cancelar', id }         → cancela um pedido aguardando
// GET  ?id=<assinatura>&selfie=1        → redireciona pra selfie do aceite
// Pedir/cancelar = mesma permissão de subir o documento (entrada =
// funcionario.update, saída = funcionario.desligar); ver = funcionario.read.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';
import { exigirPermApi, negarSemPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { BUCKET_DOC_RH, rotuloTipo } from '@/lib/rh/documento-vinculo';
import { ASSINATURA_VALIDADE_DIAS, hashArquivoRh, novoTokenAssinatura } from '@/lib/rh/assinatura';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.discriminatedUnion('acao', [
  z.object({ acao: z.literal('criar'), documentoId: z.string().uuid() }),
  z.object({ acao: z.literal('cancelar'), id: z.string().uuid() }),
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O usuário enxerga a lotação ou uma casa extra da pessoa? */
async function enxergaPessoa(userId: string, funcionarioId: string): Promise<NextResponse | null> {
  const [func] = await db
    .select({ filialId: schema.funcionario.filialId })
    .from(schema.funcionario)
    .where(eq(schema.funcionario.id, funcionarioId))
    .limit(1);
  if (!func) return NextResponse.json({ error: 'funcionário não encontrado' }, { status: 404 });
  const extras = await db
    .select({ filialId: schema.funcionarioFilialExtra.filialId })
    .from(schema.funcionarioFilialExtra)
    .where(eq(schema.funcionarioFilialExtra.funcionarioId, funcionarioId));
  const casas = [func.filialId, ...extras.map((e) => e.filialId)];
  const filiais = await filiaisDoUsuario(userId);
  if (!filiais.some((f) => casas.includes(f.id))) {
    return NextResponse.json({ error: 'sem acesso à casa desse funcionário' }, { status: 403 });
  }
  return null;
}

const permDo = (m: string) => (m === 'desligamento' ? 'funcionario.desligar' : 'funcionario.update');

function linkWhatsapp(telefone: string | null, texto: string): string {
  let d = (telefone ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  const t = encodeURIComponent(texto);
  return d.length >= 12 ? `https://wa.me/${d}?text=${t}` : `https://wa.me/?text=${t}`;
}

export async function POST(req: Request) {
  const auth = await exigirPermApi('funcionario.read');
  if (auth.error) return auth.error;
  const user = auth.user;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  const d = parsed.data;
  const A = schema.funcionarioAssinatura;
  const D = schema.funcionarioDocumento;

  if (d.acao === 'cancelar') {
    const [a] = await db
      .select({ funcionarioId: A.funcionarioId, status: A.status, momento: D.momento })
      .from(A)
      .innerJoin(D, eq(D.id, A.documentoId))
      .where(eq(A.id, d.id))
      .limit(1);
    if (!a) return NextResponse.json({ error: 'pedido não encontrado' }, { status: 404 });
    if (a.status !== 'pendente') return NextResponse.json({ error: 'só dá pra cancelar o que está aguardando' }, { status: 400 });
    const semPerm = await negarSemPerm(user.id, permDo(a.momento));
    if (semPerm) return semPerm;
    const fora = await enxergaPessoa(user.id, a.funcionarioId);
    if (fora) return fora;
    await db
      .update(A)
      .set({ status: 'cancelado', canceladoEm: new Date(), canceladoPor: user.id })
      .where(and(eq(A.id, d.id), eq(A.status, 'pendente')));
    return NextResponse.json({ ok: true });
  }

  // criar
  const [doc] = await db
    .select({
      id: D.id,
      funcionarioId: D.funcionarioId,
      filialId: D.filialId,
      momento: D.momento,
      tipo: D.tipo,
      arquivoPath: D.arquivoPath,
      canceladoEm: D.canceladoEm,
    })
    .from(D)
    .where(eq(D.id, d.documentoId))
    .limit(1);
  if (!doc || doc.canceladoEm) return NextResponse.json({ error: 'documento não encontrado' }, { status: 404 });
  const semPerm = await negarSemPerm(user.id, permDo(doc.momento));
  if (semPerm) return semPerm;
  const fora = await enxergaPessoa(user.id, doc.funcionarioId);
  if (fora) return fora;

  const [pessoa] = await db
    .select({ nome: schema.funcionario.nome, telefone: schema.funcionario.telefone, cpf: schema.funcionario.cpf })
    .from(schema.funcionario)
    .where(eq(schema.funcionario.id, doc.funcionarioId))
    .limit(1);
  const [casa] = await db
    .select({ nome: schema.filial.nome })
    .from(schema.filial)
    .where(eq(schema.filial.id, doc.filialId))
    .limit(1);

  const origem = new URL(req.url).origin;
  const montar = (token: string, id: string) => {
    const link = `${origem}/op/assinar/${token}`;
    const primeiro = (pessoa?.nome ?? '').trim().split(/\s+/)[0] ?? '';
    const texto =
      `Olá${primeiro ? `, ${primeiro}` : ''}! A ${casa?.nome ?? 'empresa'} enviou o documento "${rotuloTipo(doc.tipo)}" ` +
      `pra você assinar pelo celular. Abra o link, confira o documento, tire uma selfie e assine: ${link}`;
    return { ok: true, id, link, whatsapp: linkWhatsapp(pessoa?.telefone ?? null, texto), semCpf: !pessoa?.cpf };
  };

  // Já tem um aguardando e dentro do prazo → devolve o mesmo link.
  const [aberto] = await db
    .select({ id: A.id, token: A.token })
    .from(A)
    .where(and(eq(A.documentoId, doc.id), eq(A.status, 'pendente'), gt(A.expiraEm, new Date())))
    .orderBy(desc(A.enviadoEm))
    .limit(1);
  if (aberto) return NextResponse.json(montar(aberto.token, aberto.id));

  let hash: string;
  try {
    hash = await hashArquivoRh(doc.arquivoPath);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'não consegui ler o arquivo' }, { status: 500 });
  }
  const token = novoTokenAssinatura();
  const [criado] = await db
    .insert(A)
    .values({
      funcionarioId: doc.funcionarioId,
      filialId: doc.filialId,
      documentoId: doc.id,
      token,
      status: 'pendente',
      hashDocumento: hash,
      enviadoPor: user.id,
      expiraEm: new Date(Date.now() + ASSINATURA_VALIDADE_DIAS * 86_400_000),
    })
    .returning({ id: A.id });
  return NextResponse.json(montar(token, criado!.id));
}

export async function GET(req: Request) {
  const auth = await exigirPermApi('funcionario.read');
  if (auth.error) return auth.error;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!UUID.test(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });
  const A = schema.funcionarioAssinatura;
  const [a] = await db
    .select({ funcionarioId: A.funcionarioId, selfiePath: A.selfiePath })
    .from(A)
    .where(and(eq(A.id, id), isNull(A.canceladoEm)))
    .limit(1);
  if (!a?.selfiePath) return NextResponse.json({ error: 'sem selfie' }, { status: 404 });
  const fora = await enxergaPessoa(auth.user.id, a.funcionarioId);
  if (fora) return fora;
  const admin = await createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET_DOC_RH).createSignedUrl(a.selfiePath, 60);
  if (error || !data) return NextResponse.json({ error: `storage: ${error?.message ?? 'sem resposta'}` }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}
