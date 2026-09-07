// SALÃO PRA LOJA: o que a nuvem sabe e o vendas-local não vê.
//
// O painel do gerente (vendas-local /gerente) tem a mesa aberta, o KDS e as
// reclamações em tempo real — mas o mapa de mesas (reserva_config), a lista
// de espera, as avaliações do cliente e as reservas do dia moram aqui. A loja
// pergunta (GET) a cada poucos segundos e devolve ações da lista de espera
// (POST: chamar/sentou/desistiu) e o "visto" da avaliação.
//
// Auth: a MESMA assinatura HMAC dos outros /api/loja/* (PAGAR_MESA_SECRET,
// que a loja já tem no start.bat). Assina [f, 'salao', e].
import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { hojeBr } from '@/lib/datas';

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
  return /^[0-9a-f-]{36}$/i.test(f) && e * 1000 >= Date.now() && confere([f, 'salao', String(e)], s);
}

/** GET ?f=&e=&s= — áreas/mesas do mapa, lista de espera viva, avaliações
 *  das últimas 24h e reservas de hoje ainda por chegar/sentadas. */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const f = sp.get('f') || '';
  if (!autoriza(f, Number(sp.get('e') || 0), sp.get('s') || '')) {
    return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });
  }
  const { db, schema } = await import('@concilia/db');
  const { and, eq, inArray, gte, desc, asc } = await import('drizzle-orm');
  const hoje = hojeBr();
  const desde24h = new Date(Date.now() - 24 * 3600 * 1000);

  const [fil] = await db
    .select({ reservaConfig: schema.filial.reservaConfig })
    .from(schema.filial)
    .where(eq(schema.filial.id, f))
    .limit(1);
  const areas = (fil?.reservaConfig?.areas ?? [])
    .filter((a) => a.ativo !== false)
    .map((a) => ({
      nome: a.nome,
      mesas: (a.mesas ?? []).map((m) => ({ numero: String(m.numero).trim(), lugares: Number(m.lugares) || 0 })),
    }));

  const espera = await db
    .select({
      id: schema.listaEspera.id,
      nome: schema.listaEspera.nome,
      telefone: schema.listaEspera.telefone,
      pessoas: schema.listaEspera.pessoas,
      status: schema.listaEspera.status,
      area: schema.listaEspera.area,
      observacao: schema.listaEspera.observacao,
      criado_em: schema.listaEspera.criadoEm,
      chamado_em: schema.listaEspera.chamadoEm,
    })
    .from(schema.listaEspera)
    .where(and(eq(schema.listaEspera.filialId, f), inArray(schema.listaEspera.status, ['aguardando', 'chamado'])))
    .orderBy(asc(schema.listaEspera.criadoEm))
    .limit(60);

  const avaliacoes = await db
    .select({
      id: schema.avaliacao.id,
      nota: schema.avaliacao.nota,
      comentario: schema.avaliacao.comentario,
      nome: schema.avaliacao.nome,
      whatsapp: schema.avaliacao.whatsapp,
      origem: schema.avaliacao.origem,
      status: schema.avaliacao.status,
      criado_em: schema.avaliacao.criadoEm,
    })
    .from(schema.avaliacao)
    .where(and(eq(schema.avaliacao.filialId, f), gte(schema.avaliacao.criadoEm, desde24h)))
    .orderBy(desc(schema.avaliacao.criadoEm))
    .limit(80);

  const reservas = await db
    .select({
      id: schema.reserva.id,
      nome: schema.reserva.clienteNome,
      telefone: schema.reserva.clienteTelefone,
      pessoas: schema.reserva.pessoas,
      hora: schema.reserva.hora,
      status: schema.reserva.status,
      area: schema.reserva.area,
      mesa: schema.reserva.mesa,
      mesa_juntada: schema.reserva.mesaJuntada,
    })
    .from(schema.reserva)
    .where(
      and(
        eq(schema.reserva.filialId, f),
        eq(schema.reserva.data, hoje),
        inArray(schema.reserva.status, ['pendente', 'confirmada', 'sentada']),
      ),
    )
    .orderBy(asc(schema.reserva.hora))
    .limit(120);

  return NextResponse.json({ ok: true, agora: new Date().toISOString(), hoje, areas, espera, avaliacoes, reservas });
}

const ACOES_ESPERA = new Set(['chamar', 'sentou', 'desistiu']);
const STATUS_AVAL = new Set(['em_contato', 'resolvido']);

/** POST — ação do gerente na loja: lista de espera (chamar/sentou/desistiu)
 *  ou marcar avaliação como em contato/resolvida. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { f?: string; e?: number; s?: string; tipo?: string; id?: string; acao?: string; status?: string; por?: string }
    | null;
  if (!body || !autoriza(String(body.f || ''), Number(body.e || 0), String(body.s || ''))) {
    return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });
  }
  const id = String(body.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, erro: 'id inválido' }, { status: 400 });
  }
  const { db, schema } = await import('@concilia/db');
  const { and, eq, sql } = await import('drizzle-orm');
  const f = String(body.f);
  const por = String(body.por || 'gerente (loja)').slice(0, 100);

  if (body.tipo === 'espera') {
    const acao = String(body.acao || '');
    if (!ACOES_ESPERA.has(acao)) return NextResponse.json({ ok: false, erro: 'ação inválida' }, { status: 400 });
    const [item] = await db
      .select({ nome: schema.listaEspera.nome, telefone: schema.listaEspera.telefone, filialNome: schema.filial.nome })
      .from(schema.listaEspera)
      .innerJoin(schema.filial, eq(schema.filial.id, schema.listaEspera.filialId))
      .where(and(eq(schema.listaEspera.id, id), eq(schema.listaEspera.filialId, f)))
      .limit(1);
    if (!item) return NextResponse.json({ ok: false, erro: 'não encontrado' }, { status: 404 });
    let zap: string | null = null;
    if (acao === 'chamar') {
      await db
        .update(schema.listaEspera)
        .set({ status: 'chamado', chamadoEm: sql`now()`, atualizadoEm: sql`now()` })
        .where(eq(schema.listaEspera.id, id));
      let tel = String(item.telefone || '').replace(/\D/g, '');
      if (tel.length >= 10) {
        if (tel.length <= 11) tel = '55' + tel;
        try {
          const { enviarMesaPronta } = await import('@/lib/whatsapp-otp');
          const ok = await enviarMesaPronta(tel, { nome: (item.nome ?? '').split(' ')[0] || 'tudo bem', filial: item.filialNome ?? 'Prainha' });
          zap = ok ? 'enviado' : 'whatsapp não configurado';
        } catch (e) {
          zap = 'falha: ' + (e as Error).message;
        }
      } else zap = 'sem telefone';
    } else if (acao === 'sentou') {
      await db
        .update(schema.listaEspera)
        .set({ status: 'sentado', sentadoEm: sql`now()`, atualizadoEm: sql`now()` })
        .where(eq(schema.listaEspera.id, id));
    } else {
      await db
        .update(schema.listaEspera)
        .set({ status: 'desistiu', atualizadoEm: sql`now()` })
        .where(eq(schema.listaEspera.id, id));
    }
    return NextResponse.json({ ok: true, zap });
  }

  if (body.tipo === 'avaliacao') {
    const status = String(body.status || '');
    if (!STATUS_AVAL.has(status)) return NextResponse.json({ ok: false, erro: 'status inválido' }, { status: 400 });
    await db
      .update(schema.avaliacao)
      .set({
        status,
        // quem mexeu pela loja não é usuário da nuvem (resolvidoPor é uuid): fica anotado
        observacaoInterna: sql`coalesce(${schema.avaliacao.observacaoInterna} || E'\\n', '') || ${`[${por || 'loja'}] ${status} às ${new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}`}`,
        atualizadoEm: sql`now()`,
      })
      .where(and(eq(schema.avaliacao.id, id), eq(schema.avaliacao.filialId, f)));
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, erro: 'tipo inválido' }, { status: 400 });
}
