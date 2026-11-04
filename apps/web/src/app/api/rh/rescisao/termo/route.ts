// TRCT gerado no sistema → termo na ficha, pronto pra assinatura (04/11/2026).
// Pedido do dono: "gerava a rescisão, enviava pelo WhatsApp da pessoa, ela lia,
// dava o aceite, assinava e tirava a foto; quando assinar já entra no contas a
// pagar, no Pix a pagar da pessoa".
// POST { funcionarioId, html, liquido, bruto, descontos, afastamento, vencimento, causa }
//   → guarda o termo (HTML do jeito que está na tela) como documento de saída
//     'trct' com dados.lancarAoAssinar; o navegador então pede a assinatura
//     (/api/rh/assinatura criar). Quando a pessoa assina, a assinatura pública
//     lança a conta (lib/rh/rescisao-lancar.ts) em nome de quem enviou.
// Precisa de funcionario.desligar + conta_pagar.create (a conta sai em nome de quem envia).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';
import { exigirPermApi, negarSemPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { BUCKET_DOC_RH, pastaDocRh } from '@/lib/rh/documento-vinculo';
import type { RescisaoLida } from '@/lib/rh/rescisao';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Body = z.object({
  funcionarioId: z.string().uuid(),
  html: z.string().min(200).max(3_000_000),
  liquido: z.number().positive().max(1_000_000),
  bruto: z.number().min(0).max(1_000_000).nullable().optional(),
  descontos: z.number().min(0).max(1_000_000).nullable().optional(),
  afastamento: Ymd,
  vencimento: Ymd,
  causa: z.string().trim().max(200).optional(),
});

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export async function POST(req: Request) {
  const auth = await exigirPermApi('funcionario.read');
  if (auth.error) return auth.error;
  const user = auth.user;
  const semPerm = (await negarSemPerm(user.id, 'funcionario.desligar')) ?? (await negarSemPerm(user.id, 'conta_pagar.create'));
  if (semPerm) return semPerm;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  const d = parsed.data;

  const [func] = await db
    .select({ id: schema.funcionario.id, filialId: schema.funcionario.filialId, nome: schema.funcionario.nome, cpf: schema.funcionario.cpf })
    .from(schema.funcionario)
    .where(eq(schema.funcionario.id, d.funcionarioId))
    .limit(1);
  if (!func) return NextResponse.json({ error: 'funcionário não encontrado' }, { status: 404 });
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((x) => x.id === func.filialId)) {
    return NextResponse.json({ error: 'sem acesso à casa da lotação desse funcionário' }, { status: 403 });
  }

  // Só estilo e texto: tira qualquer script/evento (a página também é servida em sandbox).
  const html = d.html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<(iframe|object|embed|link|base|meta http-equiv)[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const path = `${pastaDocRh(func.filialId)}/${func.id}/${ts}-trct-sistema.html`;
  const admin = await createAdminClient();
  const up = await admin.storage.from(BUCKET_DOC_RH).upload(path, Buffer.from(html, 'utf8'), {
    contentType: 'text/html; charset=utf-8',
    upsert: false,
  });
  if (up.error) return NextResponse.json({ error: `storage: ${up.error.message}` }, { status: 500 });

  const lida: RescisaoLida & { origem: 'sistema'; lancarAoAssinar: true; vencimento: string } = {
    nome: func.nome,
    cpf: func.cpf,
    dataAfastamento: d.afastamento,
    dataLimite: d.vencimento,
    causa: d.causa || null,
    bruto: d.bruto ?? null,
    descontos: d.descontos ?? null,
    liquido: Math.round(d.liquido * 100) / 100,
    aviso: null,
    origem: 'sistema',
    lancarAoAssinar: true,
    vencimento: d.vencimento,
  };
  const primeiro = func.nome.trim().split(/\s+/)[0] ?? 'funcionario';
  const [criado] = await db
    .insert(schema.funcionarioDocumento)
    .values({
      funcionarioId: func.id,
      filialId: func.filialId,
      momento: 'desligamento',
      tipo: 'trct',
      descricao: `Gerado pelo sistema — líquido ${brl(lida.liquido!)}`,
      arquivoPath: path,
      arquivoNome: `trct-${primeiro.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '')}.html`,
      usuarioId: user.id,
      dados: lida,
    })
    .returning({ id: schema.funcionarioDocumento.id });
  return NextResponse.json({ ok: true, documentoId: criado!.id });
}
