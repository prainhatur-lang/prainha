// /api/cardapio/totem/estoque — estoque da recepção (mora na loja).
//   GET  ?filialId=            → itens com saldo + últimos movimentos
//   POST { filialId, codigo_pdv, tipo: entrada|saida|contagem|parar, qtd?, obs? }
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { chamarLojaTotemEstoque } from '@/lib/totem-estoque';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

async function acesso(userId: string, filialId: string) {
  const filiais = await filiaisDoUsuario(userId);
  return filiais.some((f) => f.id === filialId);
}

export async function GET(request: Request) {
  const auth = await exigirPermApi('produto.update');
  if (auth.error) return auth.error;
  const filialId = new URL(request.url).searchParams.get('filialId') || '';
  if (!z.string().uuid().safeParse(filialId).success) return NextResponse.json({ ok: false, erro: 'filial inválida' }, { status: 400 });
  if (!(await acesso(auth.user.id, filialId))) return NextResponse.json({ ok: false, erro: 'sem acesso a essa filial' }, { status: 403 });
  return NextResponse.json(await chamarLojaTotemEstoque(filialId, '/saldo'));
}

const Entrada = z.object({
  filialId: z.string().uuid(),
  codigo_pdv: z.number().int().positive(),
  tipo: z.enum(['entrada', 'saida', 'contagem', 'parar']),
  qtd: z.number().min(0).max(100000).optional(),
  obs: z.string().max(200).optional(),
});

export async function POST(request: Request) {
  const auth = await exigirPermApi('produto.update');
  if (auth.error) return auth.error;
  const parsed = Entrada.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, erro: 'dados inválidos' }, { status: 400 });
  const b = parsed.data;
  if (!(await acesso(auth.user.id, b.filialId))) return NextResponse.json({ ok: false, erro: 'sem acesso a essa filial' }, { status: 403 });
  return NextResponse.json(
    await chamarLojaTotemEstoque(b.filialId, '/ajustar', {
      method: 'POST',
      body: { codigo_pdv: b.codigo_pdv, tipo: b.tipo, qtd: b.qtd ?? 0, obs: b.obs ?? null, quem: auth.user.email ?? null },
    }),
  );
}
