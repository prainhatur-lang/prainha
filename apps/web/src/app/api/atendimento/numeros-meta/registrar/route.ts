// Estado de um número na Meta e o REGISTRO dele na Cloud API — o passo que
// tira o número de "Pendente" no Gerenciador do WhatsApp (ver lib/atendimento/
// numero-meta.ts pro porquê).
//
// GET  ?phoneNumberId=<id>          → { estado }
// POST { phoneNumberId, pin }       → { ok, estado } — pin = 6 dígitos escolhidos
//                                     pelo dono; vira a verificação em duas
//                                     etapas do número. Não é guardado nem
//                                     escrito em log.
// Auth: sessão com atendimento.config, e o número tem que ser de uma filial
// que a pessoa acessa.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { lerEstadoNumeroMeta, registrarNumeroMeta } from '@/lib/atendimento/numero-meta';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function numeroAcessivel(userId: string, phoneNumberId: string): Promise<boolean> {
  const [numero] = await db
    .select({ filialId: schema.whatsappNumero.filialId })
    .from(schema.whatsappNumero)
    .where(eq(schema.whatsappNumero.phoneNumberId, phoneNumberId))
    .limit(1);
  if (!numero) return false;
  const filiais = await filiaisDoUsuario(userId);
  return filiais.some((f) => f.id === numero.filialId);
}

export async function GET(request: Request) {
  const { user, error } = await exigirPermApi('atendimento.config');
  if (error) return error;
  const phoneNumberId = new URL(request.url).searchParams.get('phoneNumberId') ?? '';
  if (!phoneNumberId || !(await numeroAcessivel(user.id, phoneNumberId))) {
    return NextResponse.json({ error: 'número não acessível' }, { status: 404 });
  }
  return NextResponse.json({ estado: await lerEstadoNumeroMeta(phoneNumberId) });
}

export async function POST(request: Request) {
  const { user, error } = await exigirPermApi('atendimento.config');
  if (error) return error;
  const b = await request.json().catch(() => null);
  const phoneNumberId = typeof b?.phoneNumberId === 'string' ? b.phoneNumberId : '';
  const pin = typeof b?.pin === 'string' ? b.pin.trim() : '';
  if (!phoneNumberId || !(await numeroAcessivel(user.id, phoneNumberId))) {
    return NextResponse.json({ error: 'número não acessível' }, { status: 404 });
  }
  if (!/^\d{6}$/.test(pin)) {
    return NextResponse.json({ error: 'O PIN tem que ter exatamente 6 dígitos.' }, { status: 400 });
  }

  // Antes de gastar uma das 10 tentativas que a Meta dá a cada 72 h: número já
  // registrado não se registra de novo (trocaria o PIN de um número que está
  // funcionando), e sem o código confirmado a Meta recusa de qualquer jeito.
  const antes = await lerEstadoNumeroMeta(phoneNumberId);
  if (antes.erroLeitura) {
    return NextResponse.json({ error: `Não consegui ler o número na Meta: ${antes.erroLeitura}` }, { status: 502 });
  }
  if (antes.registrado) {
    return NextResponse.json({ error: 'Este número já está registrado na API.', estado: antes }, { status: 409 });
  }
  if (antes.codigo !== 'VERIFIED') {
    return NextResponse.json(
      {
        error:
          'O código de confirmação do número ainda não foi validado. Conclua a verificação no Gerenciador do WhatsApp (Números de telefone) e volte aqui.',
        estado: antes,
      },
      { status: 400 },
    );
  }

  const registro = await registrarNumeroMeta(phoneNumberId, pin);
  if (!registro.ok) {
    return NextResponse.json({ error: registro.erro ?? 'A Meta recusou o registro.', estado: antes }, { status: 502 });
  }
  console.log('[numero-meta] registrado', { phoneNumberId, por: user.id });
  return NextResponse.json({ ok: true, estado: await lerEstadoNumeroMeta(phoneNumberId) });
}
