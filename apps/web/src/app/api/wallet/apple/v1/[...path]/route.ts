// Web service da Apple Wallet (webServiceURL do pass = /api/wallet/apple).
// Spec: developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes
//
//   POST   v1/devices/<dev>/registrations/<passType>/<serial>   registra aparelho (pushToken)
//   DELETE v1/devices/<dev>/registrations/<passType>/<serial>   tira o cartão do aparelho
//   GET    v1/devices/<dev>/registrations/<passType>?passesUpdatedSince=<tag>
//   GET    v1/passes/<passType>/<serial>                        pass atualizado
//   POST   v1/log                                               log de erro do iPhone
//
// serial = fidelidade_cartao.id; autorização = header "ApplePass <apple_auth_token>".

import { db, schema } from '@concilia/db';
import { and, eq, gt, inArray } from 'drizzle-orm';
import { gerarPkpass } from '@/lib/fidelidade/apple';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ path: string[] }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tipoOk(t: string) {
  return !!process.env.APPLE_PASS_TYPE_ID && t === process.env.APPLE_PASS_TYPE_ID.trim();
}

async function cartaoAutorizado(req: Request, serial: string) {
  if (!UUID.test(serial)) return null;
  const auth = req.headers.get('authorization') || '';
  const tk = auth.startsWith('ApplePass ') ? auth.slice(10).trim() : '';
  if (!tk) return null;
  const [c] = await db.select().from(schema.fidelidadeCartao).where(eq(schema.fidelidadeCartao.id, serial)).limit(1);
  if (!c || c.appleAuthToken !== tk) return null;
  return c;
}

export async function POST(req: Request, { params }: Ctx) {
  const p = (await params).path;
  if (p[0] === 'log') {
    const b = await req.json().catch(() => null);
    console.warn('[wallet apple log]', JSON.stringify(b)?.slice(0, 2000));
    return new Response(null, { status: 200 });
  }
  // devices/<dev>/registrations/<type>/<serial>
  if (p[0] !== 'devices' || p[2] !== 'registrations' || p.length !== 5 || !tipoOk(p[3])) return new Response(null, { status: 404 });
  const c = await cartaoAutorizado(req, p[4]);
  if (!c) return new Response(null, { status: 401 });
  const b = (await req.json().catch(() => null)) as { pushToken?: string } | null;
  const pushToken = String(b?.pushToken || '').slice(0, 200);
  if (!pushToken) return new Response(null, { status: 400 });
  const deviceId = p[1].slice(0, 128);
  const [ja] = await db
    .select({ id: schema.fidelidadeAppleRegistro.id })
    .from(schema.fidelidadeAppleRegistro)
    .where(and(eq(schema.fidelidadeAppleRegistro.deviceId, deviceId), eq(schema.fidelidadeAppleRegistro.cartaoId, c.id)))
    .limit(1);
  if (ja) {
    await db.update(schema.fidelidadeAppleRegistro).set({ pushToken }).where(eq(schema.fidelidadeAppleRegistro.id, ja.id));
    return new Response(null, { status: 200 });
  }
  await db.insert(schema.fidelidadeAppleRegistro).values({ cartaoId: c.id, deviceId, pushToken }).onConflictDoNothing();
  return new Response(null, { status: 201 });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const p = (await params).path;
  if (p[0] !== 'devices' || p[2] !== 'registrations' || p.length !== 5 || !tipoOk(p[3])) return new Response(null, { status: 404 });
  const c = await cartaoAutorizado(req, p[4]);
  if (!c) return new Response(null, { status: 401 });
  await db
    .delete(schema.fidelidadeAppleRegistro)
    .where(and(eq(schema.fidelidadeAppleRegistro.deviceId, p[1]), eq(schema.fidelidadeAppleRegistro.cartaoId, c.id)));
  return new Response(null, { status: 200 });
}

export async function GET(req: Request, { params }: Ctx) {
  const p = (await params).path;
  // passes/<type>/<serial>
  if (p[0] === 'passes' && p.length === 3) {
    if (!tipoOk(p[1])) return new Response(null, { status: 404 });
    const c = await cartaoAutorizado(req, p[2]);
    if (!c) return new Response(null, { status: 401 });
    const ims = req.headers.get('if-modified-since');
    const mod = Math.floor(c.passAtualizadoEm.getTime() / 1000) * 1000;
    // cartão que ainda não tem o código da frente: o pass que está no iPhone é
    // de antes — nunca responde "não mudou", senão ele fica sem o código. Gerar
    // o pass cria o código e marca a mudança agora.
    const semCodigo = !c.codigoCarteira;
    if (!semCodigo && ims && Date.parse(ims) >= mod) return new Response(null, { status: 304 });
    const pk = await gerarPkpass(c);
    return new Response(new Uint8Array(pk), {
      headers: {
        'content-type': 'application/vnd.apple.pkpass',
        'last-modified': new Date(semCodigo ? Date.now() : mod).toUTCString(),
        'cache-control': 'no-store',
      },
    });
  }
  // devices/<dev>/registrations/<type>?passesUpdatedSince=<ms>
  if (p[0] === 'devices' && p[2] === 'registrations' && p.length === 4) {
    if (!tipoOk(p[3])) return new Response(null, { status: 404 });
    const desde = Number(new URL(req.url).searchParams.get('passesUpdatedSince') || 0);
    const regs = await db
      .select({ cartaoId: schema.fidelidadeAppleRegistro.cartaoId })
      .from(schema.fidelidadeAppleRegistro)
      .where(eq(schema.fidelidadeAppleRegistro.deviceId, p[1]));
    if (!regs.length) return new Response(null, { status: 204 });
    const conds = [inArray(schema.fidelidadeCartao.id, regs.map((r) => r.cartaoId))];
    if (desde > 0) conds.push(gt(schema.fidelidadeCartao.passAtualizadoEm, new Date(desde)));
    const cs = await db
      .select({ id: schema.fidelidadeCartao.id, em: schema.fidelidadeCartao.passAtualizadoEm })
      .from(schema.fidelidadeCartao)
      .where(and(...conds));
    if (!cs.length) return new Response(null, { status: 204 });
    const ultimo = Math.max(...cs.map((c) => c.em.getTime()));
    return Response.json({ serialNumbers: cs.map((c) => c.id), lastUpdated: String(ultimo) });
  }
  return new Response(null, { status: 404 });
}
