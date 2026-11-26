// Aparelhos da conta Tuya (Smart Life) — a tela de cadastro lista o que já está
// pareado no app pra escolher em vez de copiar o Device ID do celular. Parte de
// um aparelho já cadastrado (qualquer casa: a conta é uma só) pra achar a conta.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { listarAparelhosDaConta, type TuyaAparelhoConta } from '@/lib/tuya';

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await exigirPermApi('tuya.configurar');
  if (guard.error) return guard.error;

  const cadastrados = await db
    .select({
      tuyaDeviceId: schema.tuyaDispositivo.tuyaDeviceId,
      nome: schema.tuyaDispositivo.nome,
      filialId: schema.tuyaDispositivo.filialId,
    })
    .from(schema.tuyaDispositivo);
  if (cadastrados.length === 0) {
    return NextResponse.json(
      { error: 'Cadastre o primeiro aparelho pelo Device ID — a lista da conta parte de um aparelho já cadastrado.' },
      { status: 400 },
    );
  }

  // tenta a partir de cada aparelho conhecido até um responder (aparelho removido do app dá erro)
  const ids = [...new Set(cadastrados.map((c) => c.tuyaDeviceId))];
  let aparelhos: TuyaAparelhoConta[] | null = null;
  let ultimoErro = '';
  for (const id of ids.slice(0, 5)) {
    try {
      aparelhos = await listarAparelhosDaConta(id);
      break;
    } catch (e) {
      ultimoErro = (e as Error).message;
    }
  }
  if (!aparelhos) {
    return NextResponse.json({ error: `A Tuya não listou os aparelhos da conta (${ultimoErro}).` }, { status: 502 });
  }

  const porId = new Map<string, Array<{ nome: string; filialId: string }>>();
  for (const c of cadastrados) {
    const l = porId.get(c.tuyaDeviceId) ?? [];
    l.push({ nome: c.nome, filialId: c.filialId });
    porId.set(c.tuyaDeviceId, l);
  }

  return NextResponse.json({
    aparelhos: aparelhos.map((a) => ({
      id: a.id,
      nome: a.name,
      produto: a.product_name ?? null,
      categoria: a.category ?? null,
      online: a.online,
      cadastros: porId.get(a.id) ?? [],
    })),
  });
}
