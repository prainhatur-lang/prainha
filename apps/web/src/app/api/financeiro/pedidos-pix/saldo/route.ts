// GET /api/financeiro/pedidos-pix/saldo?filialId= — saldo de agora no Inter
// da casa, pra tela de Pedidos a pagar por Pix mostrar antes do botão
// (pedido do dono 22/10/2026). Só leitura. Quem decide se o Pix sai é a rota
// /pagar, que confere o saldo de novo dentro da trava da casa.

import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { InterSaldoErro, resolverCredenciaisInterPagamentos } from '@/lib/inter';
import { lerSaldoParaPix, podePagarPix } from '@/lib/pix-pagamento';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: Request) {
  const { user, error } = await exigirPermApi('conta_pagar.marcar_pago');
  if (error) return error;
  if (!(await podePagarPix(user.id))) {
    return NextResponse.json({ error: 'Só o Admin pode mandar Pix pelo sistema.' }, { status: 403 });
  }
  const filialId = new URL(req.url).searchParams.get('filialId') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(filialId)) return NextResponse.json({ error: 'filialId inválido' }, { status: 400 });

  const [acesso] = await db
    .select({ id: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, filialId)))
    .limit(1);
  if (!acesso) return NextResponse.json({ error: 'sem acesso à casa' }, { status: 403 });

  const cred = resolverCredenciaisInterPagamentos(filialId);
  if (!cred) {
    return NextResponse.json({ error: 'Esta casa não tem a integração de pagamentos do Inter configurada.' }, { status: 400 });
  }

  try {
    const saldo = await lerSaldoParaPix(filialId, cred);
    return NextResponse.json({ ok: true, ...saldo });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const st = e instanceof InterSaldoErro ? e.status : 0;
    const semEscopo = st === 401 || st === 403 || /scope|escopo|invalid_client|unauthorized/i.test(msg);
    return NextResponse.json(
      {
        error: semEscopo
          ? 'A integração do Inter desta casa não tem a permissão "Consultar extrato e saldo".'
          : `O Inter não respondeu o saldo agora. (${msg.slice(0, 200)})`,
      },
      { status: 503 },
    );
  }
}
