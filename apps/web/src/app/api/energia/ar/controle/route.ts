// Criar controle de ar-condicionado no aparelho infravermelho, pelo sistema.
// GET  ?dispositivoId=            → marcas de ar que o infravermelho conhece
// GET  ?dispositivoId=&brandId=   → códigos (remote_index) da marca, pra testar
// POST { dispositivoId, acao:'testar', remoteIndex, ligar }          → dispara teste (tuya.control)
// POST { dispositivoId, acao:'salvar', brandId, brandName, remoteIndex, nome } → cria (tuya.configurar)

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { criarControleAr, listarCodigosIr, listarMarcasIr, testarCodigoAr } from '@/lib/tuya';

export const dynamic = 'force-dynamic';

async function aparelhoDoUsuario(userId: string, dispositivoId: string | null | undefined) {
  if (!dispositivoId) return { erro: NextResponse.json({ error: 'dispositivoId obrigatório' }, { status: 400 }) };
  const [d] = await db.select().from(schema.tuyaDispositivo).where(eq(schema.tuyaDispositivo.id, dispositivoId));
  if (!d || d.tipo !== 'sensor_temperatura') {
    return { erro: NextResponse.json({ error: 'aparelho infravermelho não encontrado' }, { status: 404 }) };
  }
  const filiais = await filiaisDoUsuario(userId);
  if (!filiais.some((f) => f.id === d.filialId)) {
    return { erro: NextResponse.json({ error: 'sem acesso a essa filial' }, { status: 403 }) };
  }
  return { aparelho: d };
}

const inteiro = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

export async function GET(req: Request) {
  const guard = await exigirPermApi('tuya.read');
  if (guard.error) return guard.error;
  const sp = new URL(req.url).searchParams;
  const r = await aparelhoDoUsuario(guard.user.id, sp.get('dispositivoId'));
  if (r.erro) return r.erro;
  try {
    const brandId = sp.get('brandId');
    if (brandId) {
      if (!/^\d{1,9}$/.test(brandId)) return NextResponse.json({ error: 'brandId inválido' }, { status: 400 });
      return NextResponse.json({ codigos: await listarCodigosIr(r.aparelho.tuyaDeviceId, Number(brandId)) });
    }
    const marcas = await listarMarcasIr(r.aparelho.tuyaDeviceId);
    return NextResponse.json({ marcas: marcas.map((m) => ({ id: m.brand_id, nome: m.brand_name })) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const b = (await req.json()) as {
    dispositivoId?: string;
    acao?: string;
    remoteIndex?: number;
    ligar?: boolean;
    brandId?: number;
    brandName?: string;
    nome?: string;
  };
  if (b.acao !== 'testar' && b.acao !== 'salvar') {
    return NextResponse.json({ error: 'acao inválida' }, { status: 400 });
  }
  const guard = await exigirPermApi(b.acao === 'salvar' ? 'tuya.configurar' : 'tuya.control');
  if (guard.error) return guard.error;
  const r = await aparelhoDoUsuario(guard.user.id, b.dispositivoId);
  if (r.erro) return r.erro;
  if (!inteiro(b.remoteIndex)) return NextResponse.json({ error: 'remoteIndex obrigatório' }, { status: 400 });

  try {
    const ir = r.aparelho.tuyaDeviceId;
    if (b.acao === 'testar') {
      if (typeof b.ligar !== 'boolean') return NextResponse.json({ error: 'ligar obrigatório' }, { status: 400 });
      await testarCodigoAr(ir, b.remoteIndex, 'power', b.ligar ? 1 : 0);
      return NextResponse.json({ ok: true });
    }
    const nome = (b.nome ?? '').trim().slice(0, 60);
    const brandName = (b.brandName ?? '').trim().slice(0, 60);
    if (!nome || !brandName || !inteiro(b.brandId)) {
      return NextResponse.json({ error: 'nome e marca são obrigatórios' }, { status: 400 });
    }
    const remoteId = await criarControleAr(ir, { brandId: b.brandId, brandName, remoteIndex: b.remoteIndex, nome });
    return NextResponse.json({ ok: true, remoteId });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
