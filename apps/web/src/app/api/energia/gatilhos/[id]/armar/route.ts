// Ligar/desligar o alarme (botão grande do quadro de comando). Só precisa de
// tuya.control (gerente), não de tuya.configurar.
//
// Com o UniFi Protect configurado no gatilho (host + chave), arma/desarma o
// alarme de verdade no Protect via servidor da loja (lib/alarme-protect) — o
// Protect passa a ser a fonte da verdade: desarmado ele nem notifica nem chama
// o webhook. Sem Protect, vale o modo antigo: o webhook chega e é ignorado.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { armModeLigado, chamarProtect, protectConfigurado, sincronizarAtivo } from '@/lib/alarme-protect';

export const dynamic = 'force-dynamic';

async function carregar(id: string, userId: string) {
  const [gatilho] = await db.select().from(schema.alarmeGatilho).where(eq(schema.alarmeGatilho.id, id));
  if (!gatilho) return { erro: NextResponse.json({ error: 'não encontrado' }, { status: 404 }) };
  const filiais = await filiaisDoUsuario(userId);
  if (!filiais.some((f) => f.id === gatilho.filialId)) {
    return { erro: NextResponse.json({ error: 'sem acesso a essa filial' }, { status: 403 }) };
  }
  return { gatilho };
}

/** Estado ao vivo do Protect (o cartão consulta ao abrir e de tempos em tempos). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermApi('tuya.read');
  if (guard.error) return guard.error;
  const { gatilho, erro } = await carregar((await params).id, guard.user.id);
  if (erro) return erro;
  if (!protectConfigurado(gatilho)) return NextResponse.json({ protect: false, armado: gatilho.ativo });
  const r = await chamarProtect(gatilho, 'status');
  if (!r.ok) return NextResponse.json({ protect: true, armado: gatilho.ativo, erro: r.erro });
  await sincronizarAtivo(gatilho, r.armMode);
  return NextResponse.json({ protect: true, armado: armModeLigado(r.armMode), armMode: r.armMode });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermApi('tuya.control');
  if (guard.error) return guard.error;
  const { armado } = (await req.json()) as { armado?: boolean };
  if (typeof armado !== 'boolean') return NextResponse.json({ error: 'armado inválido' }, { status: 400 });
  const { gatilho, erro } = await carregar((await params).id, guard.user.id);
  if (erro) return erro;

  let armMode = null;
  if (protectConfigurado(gatilho)) {
    const r = await chamarProtect(gatilho, armado ? 'ligar' : 'desligar');
    if (!r.ok) return NextResponse.json({ error: `Protect: ${r.erro}` }, { status: 502 });
    armMode = r.armMode;
  }

  const agora = new Date();
  const [atualizado] = await db
    .update(schema.alarmeGatilho)
    .set({
      ativo: armMode ? armModeLigado(armMode) : armado,
      ativoAlteradoPor: guard.user.email ?? guard.user.id,
      ativoAlteradoEm: agora,
      atualizadoEm: agora,
    })
    .where(eq(schema.alarmeGatilho.id, gatilho.id))
    .returning();
  return NextResponse.json({
    ok: true,
    armado: atualizado.ativo,
    armMode,
    alteradoPor: atualizado.ativoAlteradoPor,
    alteradoEm: atualizado.ativoAlteradoEm?.toISOString() ?? null,
  });
}
