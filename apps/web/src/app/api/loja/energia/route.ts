// Iluminação e alarme no painel do GERENTE da loja (vendas-local /gerente) —
// o mesmo "quadro de comando" do /energia, mas pro gerente que já está logado
// no servidor da loja e não tem (ou não abre) o Concilia no celular.
//
// A Tuya só é alcançável daqui (segredo na Vercel) e a chave do Protect mora
// cifrada no banco, então a loja pede pra nuvem: assinatura HMAC escopo
// 'energia' (mesmo PAGAR_MESA_SECRET de /api/loja/ponto). O gerente que agiu
// vem em `por` — a loja só assina depois de validar a sessão de gerente.
//
// acao: 'status'  → luzes/disjuntores com estado real + alarmes (Protect ao vivo)
//       'comando' → {dispositivoId, ligar}
//       'alarme'  → {gatilhoId, armado}
import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function confere(partes: string[], sig: string): boolean {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return false;
  const esperada = createHmac('sha256', seg).update(partes.join('|')).digest('hex');
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(sig || ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function autoriza(f: string, e: number, s: string) {
  return /^[0-9a-f-]{36}$/i.test(f) && e * 1000 >= Date.now() && confere([f, 'energia', String(e)], s);
}

const Body = z.object({
  f: z.string(),
  e: z.coerce.number(),
  s: z.string(),
  acao: z.enum(['status', 'comando', 'alarme']),
  por: z.string().max(80).optional(),
  dispositivoId: z.string().uuid().optional(),
  ligar: z.boolean().optional(),
  gatilhoId: z.string().uuid().optional(),
  armado: z.boolean().optional(),
});

const TIPOS_SENSOR = new Set(['sensor_porta', 'sensor_presenca', 'sensor_temperatura']);

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, erro: 'corpo inválido' }, { status: 400 });
  const b = parsed.data;
  if (!autoriza(b.f, b.e, b.s)) return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });

  const { db, schema } = await import('@concilia/db');
  const { and, asc, eq } = await import('drizzle-orm');
  const { getDeviceStatus, interpretarStatus, ligarDesligar } = await import('@/lib/tuya');
  const { armModeLigado, chamarProtect, protectConfigurado, sincronizarAtivo } = await import('@/lib/alarme-protect');
  const por = `${(b.por || 'gerente').trim()} (loja)`;

  if (b.acao === 'comando') {
    if (!b.dispositivoId || typeof b.ligar !== 'boolean') {
      return NextResponse.json({ ok: false, erro: 'dispositivo/ligar' }, { status: 400 });
    }
    const [d] = await db
      .select()
      .from(schema.tuyaDispositivo)
      .where(and(eq(schema.tuyaDispositivo.id, b.dispositivoId), eq(schema.tuyaDispositivo.filialId, b.f)));
    if (!d || d.tipo === 'entrada' || TIPOS_SENSOR.has(d.tipo)) {
      return NextResponse.json({ ok: false, erro: 'dispositivo não encontrado' }, { status: 404 });
    }
    try {
      await ligarDesligar(d.tuyaDeviceId, d.codigoSwitch, b.ligar);
      return NextResponse.json({ ok: true });
    } catch (e) {
      return NextResponse.json({ ok: false, erro: (e as Error).message });
    }
  }

  if (b.acao === 'alarme') {
    if (!b.gatilhoId || typeof b.armado !== 'boolean') {
      return NextResponse.json({ ok: false, erro: 'gatilho/armado' }, { status: 400 });
    }
    const [g] = await db
      .select()
      .from(schema.alarmeGatilho)
      .where(and(eq(schema.alarmeGatilho.id, b.gatilhoId), eq(schema.alarmeGatilho.filialId, b.f)));
    if (!g) return NextResponse.json({ ok: false, erro: 'alarme não encontrado' }, { status: 404 });
    let ativo = b.armado;
    let avisoErro: string | undefined;
    if (protectConfigurado(g)) {
      const r = await chamarProtect(g, b.armado ? 'ligar' : 'desligar');
      if (!r.ok) return NextResponse.json({ ok: false, erro: `Protect: ${r.erro}` });
      ativo = armModeLigado(r.armMode);
      avisoErro = r.avisoErro;
    }
    const agora = new Date();
    await db
      .update(schema.alarmeGatilho)
      .set({ ativo, ativoAlteradoPor: por, ativoAlteradoEm: agora, atualizadoEm: agora })
      .where(eq(schema.alarmeGatilho.id, g.id));
    return NextResponse.json({ ok: true, armado: ativo, ...(avisoErro ? { avisoErro } : {}) });
  }

  // status
  const [dispositivos, gatilhos] = await Promise.all([
    db
      .select()
      .from(schema.tuyaDispositivo)
      .where(and(eq(schema.tuyaDispositivo.filialId, b.f), eq(schema.tuyaDispositivo.ativo, true)))
      .orderBy(asc(schema.tuyaDispositivo.nome)),
    db
      .select()
      .from(schema.alarmeGatilho)
      .where(eq(schema.alarmeGatilho.filialId, b.f))
      .orderBy(asc(schema.alarmeGatilho.criadoEm)),
  ]);
  const controlaveis = dispositivos.filter((d) => d.tipo !== 'entrada' && !TIPOS_SENSOR.has(d.tipo));

  const [leituras, alarmes] = await Promise.all([
    Promise.all(
      controlaveis.map(async (d) => {
        const base = { id: d.id, nome: d.nome, grupo: d.tipo === 'luz' ? 'luz' : 'disjuntor', tipo: d.tipo };
        try {
          const l = interpretarStatus(await getDeviceStatus(d.tuyaDeviceId), d.codigoSwitch);
          return { ...base, ligado: l.ligado, potenciaW: l.potenciaW, online: true, erro: null as string | null };
        } catch (e) {
          return { ...base, ligado: null, potenciaW: null, online: false, erro: (e as Error).message };
        }
      }),
    ),
    Promise.all(
      gatilhos.map(async (g) => {
        let armado = g.ativo;
        let status: string | null = null;
        let erro: string | null = null;
        const protect = protectConfigurado(g);
        if (protect) {
          const r = await chamarProtect(g, 'status');
          if (r.ok) {
            await sincronizarAtivo(g, r.armMode);
            armado = armModeLigado(r.armMode);
            status = r.armMode.status;
          } else erro = r.erro;
        }
        return {
          id: g.id,
          nome: g.nome,
          armado,
          status,
          protect,
          erro,
          alteradoPor: g.ativoAlteradoPor,
          alteradoEm: g.ativoAlteradoEm?.toISOString() ?? null,
          ultimoDisparoEm: g.ultimoDisparoEm?.toISOString() ?? null,
        };
      }),
    ),
  ]);

  return NextResponse.json({ ok: true, dispositivos: leituras, alarmes });
}
