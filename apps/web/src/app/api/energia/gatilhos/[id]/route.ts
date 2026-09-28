import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { dispararGatilho } from '@/lib/alarme-gatilho';
import { filiaisDoUsuario } from '@/lib/filiais';
import { cifrar, segredoConfigurado } from '@/lib/segredo';
import { gatilhoPublico, hostProtectValido, idAvisoValido } from '@/lib/alarme-protect';

async function temAcesso(userId: string, id: string): Promise<NextResponse | null> {
  const [g] = await db
    .select({ filialId: schema.alarmeGatilho.filialId })
    .from(schema.alarmeGatilho)
    .where(eq(schema.alarmeGatilho.id, id));
  if (!g) return NextResponse.json({ error: 'não encontrado' }, { status: 404 });
  const filiais = await filiaisDoUsuario(userId);
  if (!filiais.some((f) => f.id === g.filialId)) {
    return NextResponse.json({ error: 'sem acesso a essa filial' }, { status: 403 });
  }
  return null;
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermApi('tuya.configurar');
  if (guard.error) return guard.error;
  const { id } = await params;
  const negado = await temAcesso(guard.user.id, id);
  if (negado) return negado;

  const { nome, dispositivoIds, acao, desligarAposMin, ativo, protectHost, protectApiKey, protectAvisoLigado, protectAvisoDesligado } = (await req.json()) as {
    nome?: string;
    dispositivoIds?: string[];
    acao?: string;
    desligarAposMin?: number | null;
    ativo?: boolean;
    /** '' limpa (volta ao modo sem Protect) */
    protectHost?: string;
    /** só vem quando o gerente digita uma chave nova; '' apaga */
    protectApiKey?: string;
    /** '' limpa */
    protectAvisoLigado?: string;
    protectAvisoDesligado?: string;
  };
  if (acao !== undefined && acao !== 'ligar' && acao !== 'desligar') {
    return NextResponse.json({ error: 'acao inválida' }, { status: 400 });
  }
  const host = protectHost?.trim();
  if (host && !hostProtectValido(host)) {
    return NextResponse.json({ error: 'IP do Protect tem que ser da rede interna (ex: 192.168.5.1)' }, { status: 400 });
  }
  const chave = protectApiKey?.trim();
  const avisoLig = protectAvisoLigado?.trim();
  const avisoDes = protectAvisoDesligado?.trim();
  if ((avisoLig && !idAvisoValido(avisoLig)) || (avisoDes && !idAvisoValido(avisoDes))) {
    return NextResponse.json({ error: 'ID de acionamento inválido — copie do alarme do Protect (formato xxxxxxxx-xxxx-…)' }, { status: 400 });
  }
  if (chave && !segredoConfigurado()) {
    return NextResponse.json({ error: 'CREDENCIAL_SECRET não configurada — não dá pra guardar a chave' }, { status: 500 });
  }

  const [atualizado] = await db
    .update(schema.alarmeGatilho)
    .set({
      ...(nome !== undefined ? { nome: nome.trim() } : {}),
      ...(dispositivoIds !== undefined ? { dispositivoIds } : {}),
      ...(acao !== undefined ? { acao } : {}),
      ...(desligarAposMin !== undefined
        ? { desligarAposMin: desligarAposMin && desligarAposMin > 0 ? Math.round(desligarAposMin) : null }
        : {}),
      ...(ativo !== undefined ? { ativo } : {}),
      ...(host !== undefined ? { protectHost: host || null } : {}),
      ...(chave !== undefined ? { protectApiKey: chave ? cifrar(chave) : null } : {}),
      ...(avisoLig !== undefined ? { protectAvisoLigado: avisoLig || null } : {}),
      ...(avisoDes !== undefined ? { protectAvisoDesligado: avisoDes || null } : {}),
      atualizadoEm: new Date(),
    })
    .where(eq(schema.alarmeGatilho.id, id))
    .returning();
  if (!atualizado) return NextResponse.json({ error: 'não encontrado' }, { status: 404 });
  return NextResponse.json({ gatilho: gatilhoPublico(atualizado) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermApi('tuya.configurar');
  if (guard.error) return guard.error;
  const { id } = await params;
  const negado = await temAcesso(guard.user.id, id);
  if (negado) return negado;
  await db.delete(schema.alarmeGatilho).where(eq(schema.alarmeGatilho.id, id));
  return NextResponse.json({ ok: true });
}

/** Botão "Testar" da tela: dispara como se o alarme tivesse chamado. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermApi('tuya.control');
  if (guard.error) return guard.error;
  const { id } = await params;
  const negado = await temAcesso(guard.user.id, id);
  if (negado) return negado;
  const [gatilho] = await db.select().from(schema.alarmeGatilho).where(eq(schema.alarmeGatilho.id, id));
  if (!gatilho) return NextResponse.json({ error: 'não encontrado' }, { status: 404 });
  const resultado = await dispararGatilho(gatilho, { teste: true });
  return NextResponse.json({ ok: true, resultado });
}
