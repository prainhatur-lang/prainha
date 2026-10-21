// Número NOVO de WhatsApp pra uma casa, sem passar pelo Gerenciador da Meta
// (20/10, Prainha Mar). Três passos, cada um um POST:
//
//  { acao: 'adicionar', filialId, numero, nome }  → põe o número na conta do
//      WhatsApp (a mesma do Bar e da Tabuará), liga à filial em whatsapp_numero
//      (atender desmarcado) e já pede o código por SMS. Número que já está na
//      conta só é ligado à filial.
//  { acao: 'pedir_codigo', phoneNumberId, metodo: 'SMS'|'VOICE' }
//  { acao: 'confirmar_codigo', phoneNumberId, codigo }
//
// Depois disso o painel do número mostra o registro com PIN (rota registrar).
// Auth: sessão com atendimento.config e acesso à filial do número.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import {
  adicionarNumeroNaWaba,
  confirmarCodigoMeta,
  lerEstadoNumeroMeta,
  numerosDaWaba,
  pedirCodigoMeta,
  wabaDosNumeros,
} from '@/lib/atendimento/numero-meta';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const { user, error } = await exigirPermApi('atendimento.config');
  if (error) return error;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const acao = typeof b?.acao === 'string' ? b.acao : '';
  const filiais = await filiaisDoUsuario(user.id);

  if (acao === 'adicionar') {
    const filialId = typeof b?.filialId === 'string' ? b.filialId : '';
    if (!filiais.some((f) => f.id === filialId)) {
      return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
    }
    let digitos = (typeof b?.numero === 'string' ? b.numero : '').replace(/\D/g, '');
    if (digitos.startsWith('55') && digitos.length >= 12) digitos = digitos.slice(2);
    if (digitos.length < 10 || digitos.length > 11) {
      return NextResponse.json({ error: 'Digite o número com DDD (ex.: 79 99981-2578).' }, { status: 400 });
    }
    const nome = (typeof b?.nome === 'string' ? b.nome : '').trim().slice(0, 60);
    if (nome.length < 3) {
      return NextResponse.json({ error: 'Digite o nome que aparece pro cliente (ex.: Prainha Mar).' }, { status: 400 });
    }

    const atuais = await db.select().from(schema.whatsappNumero);
    const waba = await wabaDosNumeros(atuais.map((n) => n.phoneNumberId));
    if (!waba) return NextResponse.json({ error: 'Não achei a conta do WhatsApp na Meta.' }, { status: 502 });

    const completo = `55${digitos}`;
    const jaNaConta = (await numerosDaWaba(waba)).find((n) => n.digitos === completo);
    let phoneNumberId = jaNaConta?.id ?? '';
    if (!phoneNumberId) {
      const r = await adicionarNumeroNaWaba(waba, '55', digitos, nome);
      if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 502 });
      phoneNumberId = r.id;
    }

    const ligado = atuais.find((n) => n.phoneNumberId === phoneNumberId);
    if (ligado && ligado.filialId !== filialId) {
      return NextResponse.json({ error: 'Este número já está ligado a outra casa.' }, { status: 409 });
    }
    if (!ligado) {
      await db.insert(schema.whatsappNumero).values({
        phoneNumberId,
        filialId,
        numeroExibicao: completo,
        atendenteAtivo: false,
      });
    }
    console.log('[numero-meta] adicionado', { phoneNumberId, filialId, por: user.id, jaNaConta: !!jaNaConta });

    const estado = await lerEstadoNumeroMeta(phoneNumberId);
    let codigo: { ok: boolean; erro?: string } | null = null;
    if (estado.codigo !== 'VERIFIED' && !estado.registrado) codigo = await pedirCodigoMeta(phoneNumberId, 'SMS');
    return NextResponse.json({ ok: true, phoneNumberId, estado, codigo });
  }

  if (acao === 'pedir_codigo' || acao === 'confirmar_codigo') {
    const phoneNumberId = typeof b?.phoneNumberId === 'string' ? b.phoneNumberId : '';
    const [numero] = await db
      .select({ filialId: schema.whatsappNumero.filialId })
      .from(schema.whatsappNumero)
      .where(eq(schema.whatsappNumero.phoneNumberId, phoneNumberId))
      .limit(1);
    if (!numero || !filiais.some((f) => f.id === numero.filialId)) {
      return NextResponse.json({ error: 'número não acessível' }, { status: 404 });
    }
    if (acao === 'pedir_codigo') {
      const metodo = b?.metodo === 'VOICE' ? 'VOICE' : 'SMS';
      const r = await pedirCodigoMeta(phoneNumberId, metodo);
      return NextResponse.json(r.ok ? { ok: true } : { error: r.erro }, { status: r.ok ? 200 : 502 });
    }
    const codigo = (typeof b?.codigo === 'string' ? b.codigo : '').replace(/\D/g, '');
    if (codigo.length !== 6) return NextResponse.json({ error: 'O código tem 6 dígitos.' }, { status: 400 });
    const r = await confirmarCodigoMeta(phoneNumberId, codigo);
    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 502 });
    return NextResponse.json({ ok: true, estado: await lerEstadoNumeroMeta(phoneNumberId) });
  }

  return NextResponse.json({ error: 'ação desconhecida' }, { status: 400 });
}
