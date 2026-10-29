// Assinatura eletrônica — lado do funcionário (29/10/2026). PÚBLICA: quem
// abre é a pessoa pelo link /op/assinar/<token>, sem login. A defesa é o
// token (24 bytes aleatórios, vale 15 dias) + o CPF dela + a selfie.
// GET  ?token=…            → dados pra tela (nome, documento, situação)
// GET  ?token=…&arquivo=1  → redireciona pro arquivo (endereço de 5 minutos)
// POST { token, cpf, aceite: true, selfie, descriptor? } → assina
// Regra em lib/rh/assinatura.ts.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNull } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';
import { BUCKET_DOC_RH, extensaoDoc, rotuloTipo } from '@/lib/rh/documento-vinculo';
import { distanciaFacial } from '@/lib/rh/ponto-celular';
import {
  caminhoSelfieAssinatura,
  descritorRosto,
  hashArquivoRh,
  ipDoPedido,
  selfieDoAceite,
  textoAceite,
} from '@/lib/rh/assinatura';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function pedidoDoToken(token: string | null | undefined) {
  if (!token || token.length < 20 || token.length > 64) return null;
  const A = schema.funcionarioAssinatura;
  const D = schema.funcionarioDocumento;
  const F = schema.funcionario;
  const [p] = await db
    .select({
      id: A.id,
      status: A.status,
      filialId: A.filialId,
      funcionarioId: A.funcionarioId,
      hashDocumento: A.hashDocumento,
      expiraEm: A.expiraEm,
      abertoEm: A.abertoEm,
      assinadoEm: A.assinadoEm,
      tipo: D.tipo,
      descricao: D.descricao,
      arquivoPath: D.arquivoPath,
      arquivoNome: D.arquivoNome,
      docCancelado: D.canceladoEm,
      nome: F.nome,
      cpf: F.cpf,
      faceDescriptor: F.faceDescriptor,
      casa: schema.filial.nome,
    })
    .from(A)
    .innerJoin(D, eq(D.id, A.documentoId))
    .innerJoin(F, eq(F.id, A.funcionarioId))
    .innerJoin(schema.filial, eq(schema.filial.id, A.filialId))
    .where(eq(A.token, token))
    .limit(1);
  return p ?? null;
}

type Pedido = NonNullable<Awaited<ReturnType<typeof pedidoDoToken>>>;

const nomeDoc = (p: Pedido) => rotuloTipo(p.tipo) + (p.descricao ? ` — ${p.descricao}` : '');

function situacao(p: Pedido): { ok: true } | { ok: false; erro: string } {
  if (p.status === 'cancelado' || p.docCancelado) return { ok: false, erro: 'Este pedido de assinatura foi cancelado pela empresa.' };
  if (p.status === 'pendente' && p.expiraEm.getTime() < Date.now()) {
    return { ok: false, erro: 'Este link venceu. Peça um novo para a empresa.' };
  }
  return { ok: true };
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const p = await pedidoDoToken(sp.get('token'));
  if (!p) return NextResponse.json({ ok: false, erro: 'Link inválido.' }, { status: 404 });
  const s = situacao(p);
  if (!s.ok) return NextResponse.json(s, { status: 410 });

  if (sp.get('arquivo')) {
    const admin = await createAdminClient();
    const { data, error } = await admin.storage.from(BUCKET_DOC_RH).createSignedUrl(p.arquivoPath, 300);
    if (error || !data) return NextResponse.json({ ok: false, erro: 'Não consegui abrir o arquivo.' }, { status: 500 });
    if (!p.abertoEm) {
      await db
        .update(schema.funcionarioAssinatura)
        .set({ abertoEm: new Date() })
        .where(and(eq(schema.funcionarioAssinatura.id, p.id), isNull(schema.funcionarioAssinatura.abertoEm)));
    }
    return NextResponse.redirect(data.signedUrl);
  }

  return NextResponse.json({
    ok: true,
    nome: p.nome,
    casa: p.casa,
    documento: nomeDoc(p),
    ehPdf: extensaoDoc(p.arquivoNome ?? p.arquivoPath) === 'pdf',
    status: p.status,
    assinadoEm: p.assinadoEm?.toISOString() ?? null,
    pedeCpf: !!p.cpf,
    texto: textoAceite(p.nome, nomeDoc(p)),
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    token?: string;
    cpf?: string;
    aceite?: boolean;
    selfie?: string;
    descriptor?: unknown;
  } | null;
  const p = await pedidoDoToken(body?.token);
  if (!p) return NextResponse.json({ ok: false, erro: 'Link inválido.' }, { status: 404 });
  const s = situacao(p);
  if (!s.ok) return NextResponse.json(s, { status: 410 });
  if (p.status === 'assinado') return NextResponse.json({ ok: true, assinadoEm: p.assinadoEm?.toISOString() });
  if (body?.aceite !== true) return NextResponse.json({ ok: false, erro: 'Marque que leu e concorda.' }, { status: 400 });

  const cpf = (body.cpf ?? '').replace(/\D/g, '');
  if (p.cpf && cpf !== p.cpf.replace(/\D/g, '')) {
    return NextResponse.json({ ok: false, erro: 'O CPF não confere com o do cadastro.' }, { status: 400 });
  }
  if (!p.cpf && cpf.length !== 11) return NextResponse.json({ ok: false, erro: 'Digite o seu CPF (11 números).' }, { status: 400 });

  const selfie = selfieDoAceite(body.selfie);
  if (!selfie) return NextResponse.json({ ok: false, erro: 'Tire a selfie para assinar.' }, { status: 400 });

  // O arquivo tem que ser o mesmo de quando a empresa pediu a assinatura.
  let hash: string;
  try {
    hash = await hashArquivoRh(p.arquivoPath);
  } catch {
    return NextResponse.json({ ok: false, erro: 'Não consegui conferir o documento. Tente de novo.' }, { status: 500 });
  }
  if (hash !== p.hashDocumento) {
    return NextResponse.json(
      { ok: false, erro: 'O documento foi trocado depois do pedido. Peça um novo link para a empresa.' },
      { status: 409 },
    );
  }

  const descr = descritorRosto(body.descriptor);
  const cadastrado = descritorRosto(p.faceDescriptor);
  const fd = descr && cadastrado ? distanciaFacial(descr, cadastrado) : null;

  const path = caminhoSelfieAssinatura(p.filialId, p.funcionarioId, p.id);
  const admin = await createAdminClient();
  const up = await admin.storage.from(BUCKET_DOC_RH).upload(path, selfie.buf, { contentType: selfie.mime, upsert: true });
  if (up.error) return NextResponse.json({ ok: false, erro: 'Não consegui guardar a selfie. Tente de novo.' }, { status: 500 });

  const agora = new Date();
  const A = schema.funcionarioAssinatura;
  const feitos = await db
    .update(A)
    .set({
      status: 'assinado',
      assinadoEm: agora,
      assinadoIp: ipDoPedido(req),
      assinadoAparelho: (req.headers.get('user-agent') ?? '').slice(0, 500) || null,
      cpfInformado: cpf || null,
      hashNoAceite: hash,
      selfiePath: path,
      faceDistancia: fd != null && Number.isFinite(fd) ? fd.toFixed(3) : null,
      textoAceite: textoAceite(p.nome, nomeDoc(p)),
      abertoEm: p.abertoEm ?? agora,
    })
    .where(and(eq(A.id, p.id), eq(A.status, 'pendente')))
    .returning({ id: A.id });
  if (!feitos.length) return NextResponse.json({ ok: false, erro: 'Este pedido já não está aguardando.' }, { status: 409 });
  return NextResponse.json({ ok: true, assinadoEm: agora.toISOString() });
}
