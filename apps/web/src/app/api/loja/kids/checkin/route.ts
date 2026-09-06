// Espaço Kids — a loja registra um check-in na nuvem pra abrir a ponte do
// WhatsApp com o responsável.
//
// POST { f, e, s, codigo, telefone, responsavel, criancas:[{nome,idade}], mesa, link_camera }
//   -> { ok, numero_casa, phone_number_id, ja_confirmado, telefone_confirmado? }
//
// Assinatura HMAC igual ao /cliente-documento (chave PAGAR_MESA_SECRET, escopo
// 'kids'). Código repetido na filial -> 409 (a loja gera outro e tenta de novo).
// Mesmo telefone confirmado nessa filial nas últimas 12 h -> nasce confirmado,
// sem QR, e o responsável recebe a msg de "entrou".

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { horaAgoraBr } from '@/lib/datas';
import { validaLojaKids, numeroDaCasa, listaCriancas, msgEntrou, enviarParaResponsavel } from '@/lib/kids';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ ok: false, erro: 'corpo inválido' }, { status: 400 });
  const filial = await validaLojaKids(b);
  if (!filial) return NextResponse.json({ ok: false, erro: 'assinatura inválida ou expirada' }, { status: 403 });

  const codigo = String(b.codigo || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(codigo)) return NextResponse.json({ ok: false, erro: 'código inválido' }, { status: 400 });
  const telefone = String(b.telefone || '').replace(/\D/g, '');
  if (telefone.length < 10 || telefone.length > 15) {
    return NextResponse.json({ ok: false, erro: 'telefone inválido' }, { status: 400 });
  }
  const responsavel = String(b.responsavel || '').trim().slice(0, 160);
  if (!responsavel) return NextResponse.json({ ok: false, erro: 'responsável obrigatório' }, { status: 400 });
  const lista = (Array.isArray(b.criancas) ? b.criancas : [])
    .map((c) => {
      const o = (c ?? {}) as { nome?: unknown; idade?: unknown };
      const idade = Number(o.idade);
      return {
        nome: String(o.nome ?? '').trim().slice(0, 80),
        idade: Number.isInteger(idade) && idade >= 0 && idade <= 17 ? idade : null,
      };
    })
    .filter((c) => c.nome);
  if (!lista.length) return NextResponse.json({ ok: false, erro: 'nenhuma criança' }, { status: 400 });
  const criancas = listaCriancas(lista);
  const mesaN = Number(b.mesa);
  const mesa = Number.isInteger(mesaN) && mesaN > 0 ? mesaN : null;
  const linkRaw = String(b.link_camera || '').trim();
  const linkCamera = /^https:\/\/\S+$/.test(linkRaw) ? linkRaw.slice(0, 500) : null;

  const numero = await numeroDaCasa(filial.id);
  if (!numero?.numeroExibicao) {
    return NextResponse.json({ ok: false, erro: 'nenhum número de WhatsApp cadastrado na nuvem' }, { status: 503 });
  }

  // Já confirmou o zap hoje (mesmos últimos 8 dígitos, nessa filial, 12 h)?
  const fim8 = telefone.slice(-8);
  const [anterior] = await db
    .select({ telefoneConfirmado: schema.kidsCheckin.telefoneConfirmado })
    .from(schema.kidsCheckin)
    .where(
      and(
        eq(schema.kidsCheckin.filialId, filial.id),
        inArray(schema.kidsCheckin.status, ['confirmado', 'encerrado']),
        gt(schema.kidsCheckin.confirmadoEm, sql`now() - interval '12 hours'`),
        sql`${schema.kidsCheckin.telefoneConfirmado} IS NOT NULL`,
        sql`(right(${schema.kidsCheckin.telefoneDigitado}, 8) = ${fim8} OR right(${schema.kidsCheckin.telefoneConfirmado}, 8) = ${fim8})`,
      ),
    )
    .orderBy(desc(schema.kidsCheckin.confirmadoEm))
    .limit(1);
  const jaConfirmado = !!anterior?.telefoneConfirmado;

  let id: string;
  try {
    const [row] = await db
      .insert(schema.kidsCheckin)
      .values({
        filialId: filial.id,
        codigo,
        phoneNumberId: numero.phoneNumberId,
        telefoneDigitado: telefone,
        telefoneConfirmado: jaConfirmado ? anterior!.telefoneConfirmado : null,
        responsavelNome: responsavel,
        criancas,
        mesa,
        linkCamera,
        status: jaConfirmado ? 'confirmado' : 'aguardando',
        confirmadoEm: jaConfirmado ? sql`now()` : null,
      })
      .returning({ id: schema.kidsCheckin.id });
    id = row.id;
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === '23505') return NextResponse.json({ ok: false, erro: 'código repetido' }, { status: 409 });
    throw e;
  }

  if (jaConfirmado) {
    await enviarParaResponsavel(
      { id, phoneNumberId: numero.phoneNumberId, telefoneConfirmado: anterior!.telefoneConfirmado! },
      msgEntrou(criancas, horaAgoraBr(), mesa),
    );
  }

  return NextResponse.json({
    ok: true,
    numero_casa: numero.numeroExibicao,
    phone_number_id: numero.phoneNumberId,
    ja_confirmado: jaConfirmado,
    telefone_confirmado: jaConfirmado ? anterior!.telefoneConfirmado : null,
  });
}
