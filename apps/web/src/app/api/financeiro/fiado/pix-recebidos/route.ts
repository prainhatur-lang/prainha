// Pix recebidos no extrato da casa do cliente, pra escolher qual pagou a
// baixa do fiado. Os de nome parecido com o cliente vêm primeiro.
import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { pixRecebidosParaFiado } from '@/lib/fiado-pix';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const auth = await exigirPermApi('conta_receber.create');
  if (auth.error) return auth.error;

  const clienteId = new URL(request.url).searchParams.get('clienteId') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(clienteId)) {
    return NextResponse.json({ ok: false, erro: 'cliente inválido' }, { status: 400 });
  }
  const [cli] = await db
    .select({ filialId: schema.cliente.filialId, nome: schema.cliente.nome })
    .from(schema.cliente)
    .where(eq(schema.cliente.id, clienteId))
    .limit(1);
  if (!cli) return NextResponse.json({ ok: false, erro: 'cliente não encontrado' }, { status: 404 });
  const filiais = await filiaisDoUsuario(auth.user.id);
  if (!filiais.some((f) => f.id === cli.filialId)) {
    return NextResponse.json({ ok: false, erro: 'sem acesso a essa filial' }, { status: 403 });
  }

  const pix = await pixRecebidosParaFiado({ filialId: cli.filialId, clienteNome: cli.nome });
  return NextResponse.json({ ok: true, pix });
}
