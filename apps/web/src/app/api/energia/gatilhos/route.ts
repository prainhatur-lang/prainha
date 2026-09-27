// Cadastro dos gatilhos de alarme -> Tuya (tela /configuracoes/energia).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { gatilhoPublico, hostProtectValido } from '@/lib/alarme-protect';
import { filiaisDoUsuario } from '@/lib/filiais';
import { cifrar, segredoConfigurado } from '@/lib/segredo';
import { novoTokenGatilho } from '@/lib/alarme-gatilho';

export async function POST(req: Request) {
  const guard = await exigirPermApi('tuya.configurar');
  if (guard.error) return guard.error;

  const { filialId, nome, dispositivoIds, acao, desligarAposMin, protectHost, protectApiKey } = (await req.json()) as {
    filialId?: string;
    nome?: string;
    dispositivoIds?: string[];
    acao?: string;
    desligarAposMin?: number | null;
    protectHost?: string;
    protectApiKey?: string;
  };
  if (!filialId || !nome?.trim()) {
    return NextResponse.json({ error: 'filialId e nome são obrigatórios' }, { status: 400 });
  }
  if (acao && acao !== 'ligar' && acao !== 'desligar') {
    return NextResponse.json({ error: 'acao inválida' }, { status: 400 });
  }
  const filiais = await filiaisDoUsuario(guard.user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'sem acesso a essa filial' }, { status: 403 });
  }
  const host = protectHost?.trim() || null;
  if (host && !hostProtectValido(host)) {
    return NextResponse.json({ error: 'IP do Protect tem que ser da rede interna (ex: 192.168.5.1)' }, { status: 400 });
  }
  const chave = protectApiKey?.trim() || null;
  if (chave && !segredoConfigurado()) {
    return NextResponse.json({ error: 'CREDENCIAL_SECRET não configurada — não dá pra guardar a chave' }, { status: 500 });
  }

  const [criado] = await db
    .insert(schema.alarmeGatilho)
    .values({
      filialId,
      nome: nome.trim(),
      token: novoTokenGatilho(),
      dispositivoIds: dispositivoIds ?? [],
      acao: acao ?? 'ligar',
      desligarAposMin: desligarAposMin && desligarAposMin > 0 ? Math.round(desligarAposMin) : null,
      protectHost: host,
      protectApiKey: chave ? cifrar(chave) : null,
    })
    .returning();
  return NextResponse.json({ gatilho: gatilhoPublico(criado) });
}
