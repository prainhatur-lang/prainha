// Advertência / suspensão pelo sistema (pedido do dono 10/11/2026).
// POST { funcionarioId, tipo, motivo, descricao, dataFato, dias?, inicioSuspensao? }
//   → gera o documento aqui no servidor (lib/rh/advertencia.ts), guarda como
//     funcionario_documento momento 'ocorrencia' e devolve documentoId. O
//     navegador então pede a assinatura (/api/rh/assinatura criar) e abre o
//     WhatsApp da pessoa com o link.
// Precisa de funcionario.update (Gerente, RH e Admin têm).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { and, eq, isNull } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';
import { exigirPermApi, negarSemPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { BUCKET_DOC_RH, pastaDocRh } from '@/lib/rh/documento-vinculo';
import { htmlAdvertencia, TIPOS_OCORRENCIA } from '@/lib/rh/advertencia';
import { hojeBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Body = z.object({
  funcionarioId: z.string().uuid(),
  tipo: z.enum(TIPOS_OCORRENCIA),
  motivo: z.string().trim().min(2).max(120),
  descricao: z.string().trim().min(10).max(4000),
  dataFato: Ymd,
  dias: z.number().int().min(1).max(30).nullable().optional(),
  inicioSuspensao: Ymd.nullable().optional(),
});

export async function POST(req: Request) {
  const auth = await exigirPermApi('funcionario.read');
  if (auth.error) return auth.error;
  const user = auth.user;
  const semPerm = await negarSemPerm(user.id, 'funcionario.update');
  if (semPerm) return semPerm;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Preencha o motivo e conte o que aconteceu (mínimo 10 letras).' }, { status: 400 });
  }
  const d = parsed.data;
  if (d.dataFato > hojeBr()) return NextResponse.json({ error: 'A data do fato não pode ser no futuro.' }, { status: 400 });
  if (d.tipo === 'suspensao' && !d.dias) return NextResponse.json({ error: 'Diga quantos dias de suspensão.' }, { status: 400 });

  const F = schema.funcionario;
  const [func] = await db
    .select({
      id: F.id,
      filialId: F.filialId,
      nome: F.nome,
      cpf: F.cpf,
      cargo: F.cargo,
      empresaRegistro: F.empresaRegistro,
      cnpjRegistro: F.cnpjRegistro,
    })
    .from(F)
    .where(eq(F.id, d.funcionarioId))
    .limit(1);
  if (!func) return NextResponse.json({ error: 'funcionário não encontrado' }, { status: 404 });
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((x) => x.id === func.filialId)) {
    return NextResponse.json({ error: 'sem acesso à casa da lotação desse funcionário' }, { status: 403 });
  }

  const [casa] = await db
    .select({ nome: schema.filial.nome, cnpj: schema.filial.cnpj })
    .from(schema.filial)
    .where(eq(schema.filial.id, func.filialId))
    .limit(1);
  const [quem] = await db.select({ nome: schema.usuario.nome, email: schema.usuario.email }).from(schema.usuario).where(eq(schema.usuario.id, user.id)).limit(1);

  const D = schema.funcionarioDocumento;
  const anteriores = await db
    .select({ id: D.id })
    .from(D)
    .where(and(eq(D.funcionarioId, func.id), eq(D.momento, 'ocorrencia'), eq(D.tipo, d.tipo), isNull(D.canceladoEm)));

  const html = htmlAdvertencia({
    tipo: d.tipo,
    empregador: func.empresaRegistro || casa?.nome || 'Empresa',
    cnpj: func.cnpjRegistro || casa?.cnpj || null,
    casa: casa?.nome ?? '',
    nome: func.nome,
    cpf: func.cpf,
    cargo: func.cargo,
    dataFato: d.dataFato,
    motivo: d.motivo,
    descricao: d.descricao,
    gerente: quem?.nome || quem?.email || 'Gerência',
    numero: anteriores.length + 1,
    dataEmissao: hojeBr(),
    dias: d.dias ?? null,
    inicioSuspensao: d.inicioSuspensao ?? null,
  });

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const path = `${pastaDocRh(func.filialId)}/${func.id}/${ts}-${d.tipo}-sistema.html`;
  const admin = await createAdminClient();
  const up = await admin.storage.from(BUCKET_DOC_RH).upload(path, Buffer.from(html, 'utf8'), {
    contentType: 'text/html; charset=utf-8',
    upsert: false,
  });
  if (up.error) return NextResponse.json({ error: `storage: ${up.error.message}` }, { status: 500 });

  const primeiro = func.nome.trim().split(/\s+/)[0] ?? 'funcionario';
  const [criado] = await db
    .insert(D)
    .values({
      funcionarioId: func.id,
      filialId: func.filialId,
      momento: 'ocorrencia',
      tipo: d.tipo,
      descricao: `${d.motivo} — fato em ${d.dataFato.split('-').reverse().join('/')}`.slice(0, 200),
      arquivoPath: path,
      arquivoNome: `${d.tipo}-${primeiro.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '')}.html`,
      usuarioId: user.id,
      dados: {
        origem: 'sistema',
        motivo: d.motivo,
        descricao: d.descricao,
        dataFato: d.dataFato,
        dias: d.dias ?? null,
        inicioSuspensao: d.inicioSuspensao ?? null,
        numero: anteriores.length + 1,
      },
    })
    .returning({ id: D.id });
  return NextResponse.json({ ok: true, documentoId: criado!.id });
}
