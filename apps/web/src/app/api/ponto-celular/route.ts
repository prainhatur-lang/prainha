// Ponto pelo celular (24/10/2026) — rota PÚBLICA chamada pela página
// /op/ponto/<token>. Quem prova a pessoa é o token do link + a selfie
// (comparada aqui no servidor com o rosto do tablet) + o GPS dentro do raio.
// Regras e motivo de recusar (e não deixar pendente) em lib/rh/ponto-celular.ts.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { baterPontoCelular, batidasDoDia, diaOperacionalDe, pessoaDoToken } from '@/lib/rh/ponto-celular';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  const p = await pessoaDoToken(token);
  if (!p) return NextResponse.json({ ok: false, erro: 'Link inválido ou desativado. Peça um novo ao gerente.' }, { status: 404 });
  const dia = diaOperacionalDe(new Date());
  const doDia = await batidasDoDia(p.id, dia);
  const nomes = new Map(p.casas.map((c) => [c.id, c.nome]));
  return NextResponse.json({
    ok: true,
    nome: p.nome.split(' ')[0],
    temRosto: p.temRosto,
    casas: p.casas.map((c) => ({ nome: c.nome, raioM: c.raioM })),
    dia,
    batidas: doDia.map((b) => ({ quando: b.quando.toISOString(), tipo: b.tipo, casa: nomes.get(b.filialId) ?? null })),
  });
}

const Body = z.object({
  token: z.string().min(16).max(64),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  precisao: z.number().min(0).max(1_000_000),
  descriptor: z.array(z.number()).length(128),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, erro: 'Dados incompletos (GPS ou selfie).' }, { status: 400 });
  const p = await pessoaDoToken(parsed.data.token);
  if (!p) return NextResponse.json({ ok: false, erro: 'Link inválido ou desativado. Peça um novo ao gerente.' }, { status: 404 });
  const r = await baterPontoCelular(p, { ...parsed.data, userAgent: req.headers.get('user-agent') });
  return NextResponse.json(r, { status: r.ok ? 200 : 422 });
}
