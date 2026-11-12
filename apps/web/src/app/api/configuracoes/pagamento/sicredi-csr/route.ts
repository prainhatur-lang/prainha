// Gera o pedido de certificado da API Pix Sicredi desta casa (ver lib/sicredi-csr.ts).
//   POST { filialId } → gera chave nova (cifrada, 'keyPendente') e devolve o .csr
//   GET ?filialId=     → baixa de novo o último .csr gerado
// A chave privada nunca sai do servidor.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { cifrar, decifrar, pista, segredoConfigurado } from '@/lib/segredo';
import { gerarCsrSicredi } from '@/lib/sicredi-csr';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function gravar(filialId: string, chave: string, valor: string, userId: string) {
  await db
    .insert(schema.filialCredencial)
    .values({ filialId, provedor: 'sicredi', chave, valor: cifrar(valor), pista: pista(valor), atualizadoPor: userId })
    .onConflictDoUpdate({
      target: [schema.filialCredencial.filialId, schema.filialCredencial.provedor, schema.filialCredencial.chave],
      set: { valor: cifrar(valor), pista: pista(valor), atualizadoPor: userId, atualizadoEm: new Date() },
    });
}

function arquivo(csrPem: string, cnpj: string) {
  return new NextResponse(csrPem, {
    headers: {
      'content-type': 'application/pkcs10',
      'content-disposition': `attachment; filename="sicredi-pix-${cnpj}.csr"`,
      'cache-control': 'no-store',
    },
  });
}

async function filialAcessivel(userId: string, filialId: string) {
  const filiais = await filiaisDoUsuario(userId);
  if (!filiais.some((f) => f.id === filialId)) return null;
  const [f] = await db
    .select({ nome: schema.filial.nome, cnpj: schema.filial.cnpj })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  return f ?? null;
}

export async function POST(request: Request) {
  const { user, error } = await exigirPermApi('configuracao.editar');
  if (error) return error;
  if (!segredoConfigurado()) {
    return NextResponse.json({ error: 'CREDENCIAL_SECRET não está configurada no servidor.' }, { status: 503 });
  }
  const b = await request.json().catch(() => null);
  const filialId = typeof b?.filialId === 'string' ? b.filialId : '';
  const f = await filialAcessivel(user.id, filialId);
  if (!f) return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  const cnpj = (f.cnpj ?? '').replace(/\D/g, '');
  if (cnpj.length !== 14) {
    return NextResponse.json({ error: 'O cadastro desta casa está sem CNPJ válido (Lojas e taxas).' }, { status: 400 });
  }

  const { keyPem, csrPem } = gerarCsrSicredi(cnpj, f.nome);
  // Chave nova vai como PENDENTE: a credencial que já funciona não muda até
  // chegar o .cer deste pedido.
  await gravar(filialId, 'keyPendente', Buffer.from(keyPem).toString('base64'), user.id);
  await gravar(filialId, 'csr', csrPem, user.id);
  return arquivo(csrPem, cnpj);
}

export async function GET(request: Request) {
  const { user, error } = await exigirPermApi('configuracao.editar');
  if (error) return error;
  const filialId = new URL(request.url).searchParams.get('filialId') ?? '';
  const f = await filialAcessivel(user.id, filialId);
  if (!f) return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  const [l] = await db
    .select({ valor: schema.filialCredencial.valor })
    .from(schema.filialCredencial)
    .where(and(
      eq(schema.filialCredencial.filialId, filialId),
      eq(schema.filialCredencial.provedor, 'sicredi'),
      eq(schema.filialCredencial.chave, 'csr'),
    ))
    .limit(1);
  if (!l) return NextResponse.json({ error: 'nenhum pedido gerado' }, { status: 404 });
  return arquivo(decifrar(l.valor), (f.cnpj ?? '').replace(/\D/g, ''));
}
