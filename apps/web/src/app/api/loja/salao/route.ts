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
import { parseJuntadas } from '@/lib/reservas/mesas-juntadas';

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
  const { and, eq, inArray, gte, desc, asc, or } = await import('drizzle-orm');
  const hoje = hojeBr();
  const desde24h = new Date(Date.now() - 24 * 3600 * 1000);
  const desde12h = new Date(Date.now() - 12 * 3600 * 1000);

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
      sentado_em: schema.listaEspera.sentadoEm,
    })
    .from(schema.listaEspera)
    // Fila viva + o que saiu dela nas últimas 12h: a recepção precisa ver o
    // que acabou de marcar (e poder desfazer um "sentou" clicado por engano).
    .where(
      and(
        eq(schema.listaEspera.filialId, f),
        or(
          inArray(schema.listaEspera.status, ['aguardando', 'chamado']),
          and(
            inArray(schema.listaEspera.status, ['sentado', 'desistiu']),
            gte(schema.listaEspera.atualizadoEm, desde12h),
          ),
        ),
      ),
    )
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
      // O que a RECEPÇÃO da loja precisa pra identificar quem chegou (tela
      // /reservas do vendas-local): o pedido especial, o gosto do cliente, a
      // bebida já escolhida e se a reserva foi paga (lounge).
      observacao: schema.reserva.observacao,
      preferencias: schema.reserva.preferencias,
      bebida: schema.reserva.bebidaPedido,
      bebida_qtd: schema.reserva.bebidaComboQtd,
      valor: schema.reserva.valor,
      canal: schema.reserva.canal,
    })
    .from(schema.reserva)
    .where(
      and(
        eq(schema.reserva.filialId, f),
        eq(schema.reserva.data, hoje),
        // no_show entra pra recepção poder DESFAZER um toque errado — o cartão
        // continua na tela do dia marcado em vermelho.
        inArray(schema.reserva.status, ['pendente', 'confirmada', 'sentada', 'no_show']),
      ),
    )
    .orderBy(asc(schema.reserva.hora))
    .limit(120);

  // mesa_juntada pode ser lista ("13,14") — o painel da loja concatena
  // "mesa 12" + "+" + mesa_juntada, então já vai "13+14".
  const reservasSaida = reservas.map((r) => ({
    ...r,
    mesa_juntada: parseJuntadas(r.mesa_juntada).join('+') || null,
  }));
  return NextResponse.json({ ok: true, agora: new Date().toISOString(), hoje, areas, espera, avaliacoes, reservas: reservasSaida });
}

const ACOES_ESPERA = new Set(['chamar', 'sentou', 'desistiu', 'voltar']);
// O que a RECEPÇÃO pode fazer numa reserva pela loja. Cancelar NÃO está aqui
// de propósito: cancelar dispara estorno integral e é ato de administrador
// (regra do Elison, 16/08) — continua só no painel, com login.
const ACOES_RESERVA = new Set(['sentar', 'confirmar', 'no_show', 'hora', 'mesa', 'pessoas']);
const STATUS_AVAL = new Set(['em_contato', 'resolvido']);

/** POST — ação do gerente na loja: lista de espera (chamar/sentou/desistiu)
 *  ou marcar avaliação como em contato/resolvida. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | {
        f?: string; e?: number; s?: string; tipo?: string; id?: string; acao?: string; status?: string; por?: string;
        mesa?: string; hora?: string; pessoas?: number;
      }
    | null;
  if (!body || !autoriza(String(body.f || ''), Number(body.e || 0), String(body.s || ''))) {
    return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });
  }
  if (body.tipo === 'avaliacao_nova') return avaliacaoNova(String(body.f), body as unknown as AvaliacaoNova);
  if (body.tipo === 'espera_nova') return esperaNova(String(body.f), body as unknown as EsperaNova);
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
      // Onde sentou vai pra observação — lista_espera não tem coluna de mesa e
      // não vale uma migration só por isso; assim aparece igual no /lista-espera.
      const mesa = String(body.mesa || '').replace(/\D/g, '').slice(0, 6);
      await db
        .update(schema.listaEspera)
        .set({
          status: 'sentado',
          sentadoEm: sql`now()`,
          atualizadoEm: sql`now()`,
          ...(mesa ? { observacao: sql`coalesce(${schema.listaEspera.observacao} || ' · ', '') || ${'sentou na mesa ' + mesa}` } : {}),
        })
        .where(eq(schema.listaEspera.id, id));
    } else if (acao === 'voltar') {
      await db
        .update(schema.listaEspera)
        .set({ status: 'aguardando', chamadoEm: null, sentadoEm: null, atualizadoEm: sql`now()` })
        .where(eq(schema.listaEspera.id, id));
    } else {
      await db
        .update(schema.listaEspera)
        .set({ status: 'desistiu', atualizadoEm: sql`now()` })
        .where(eq(schema.listaEspera.id, id));
    }
    return NextResponse.json({ ok: true, zap });
  }

  // RESERVA: a recepção administra de verdade pelo salão (sentar, confirmar,
  // não-compareceu, mudar horário/mesa/pessoas). A rota /api/reservas/[id] é
  // presa a login de usuário, então as mesmas regras vivem aqui: conflito de
  // mesa, auditoria em reserva_alteracao e aviso no WhatsApp do cliente.
  if (body.tipo === 'reserva') {
    const acao = String(body.acao || '');
    if (!ACOES_RESERVA.has(acao)) return NextResponse.json({ ok: false, erro: 'ação inválida' }, { status: 400 });
    const [r] = await db
      .select({
        filialId: schema.reserva.filialId,
        data: schema.reserva.data,
        hora: schema.reserva.hora,
        area: schema.reserva.area,
        mesa: schema.reserva.mesa,
        mesaJuntada: schema.reserva.mesaJuntada,
        status: schema.reserva.status,
        pessoas: schema.reserva.pessoas,
        nome: schema.reserva.clienteNome,
        telefone: schema.reserva.clienteTelefone,
      })
      .from(schema.reserva)
      .where(and(eq(schema.reserva.id, id), eq(schema.reserva.filialId, f)))
      .limit(1);
    if (!r) return NextResponse.json({ ok: false, erro: 'reserva não encontrada' }, { status: 404 });
    if (r.status === 'cancelada') {
      return NextResponse.json({ ok: false, erro: 'reserva cancelada — fale com o escritório' }, { status: 400 });
    }

    const set: Record<string, unknown> = { atualizadoEm: sql`now()` };
    const mesaPedida = String(body.mesa ?? '').trim().slice(0, 20) || null;
    const [ano, mes, dia] = String(r.data).split('-');
    const dataBr = `${dia}/${mes}/${ano}`;
    let mensagem: string | null = null;

    if (acao === 'confirmar') {
      set.status = 'confirmada';
    } else if (acao === 'pessoas') {
      const n = Number(body.pessoas);
      if (!Number.isInteger(n) || n < 1 || n > 500) {
        return NextResponse.json({ ok: false, erro: 'nº de pessoas inválido' }, { status: 400 });
      }
      set.pessoas = n;
    } else if (acao === 'hora') {
      const hora = String(body.hora || '');
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) {
        return NextResponse.json({ ok: false, erro: 'horário inválido (HH:MM)' }, { status: 400 });
      }
      set.hora = hora;
      mensagem = `Sua reserva de ${dataBr} mudou de horário: agora é às ${hora}. Te esperamos!`;
    } else if (acao === 'no_show') {
      set.status = 'no_show';
      // Fecha a comanda aberta na mesa pra liberar o mapa (mesmo tratamento do
      // painel: `pedido.numero` é integer e a mesa pode ser texto tipo "12A").
      const numeroMesa = Number((r.mesa ?? '').replace(/\D/g, ''));
      if (r.mesa && Number.isFinite(numeroMesa) && numeroMesa > 0) {
        const { isNull } = await import('drizzle-orm');
        await db
          .update(schema.pedido)
          .set({ dataFechamento: sql`now()` })
          .where(
            and(
              eq(schema.pedido.filialId, r.filialId),
              eq(schema.pedido.numero, numeroMesa),
              isNull(schema.pedido.dataFechamento),
            ),
          )
          .catch(() => null);
      }
      mensagem = `Notamos que você não compareceu à sua reserva de ${dataBr} às ${r.hora}. Se quiser remarcar, é só chamar a gente!`;
    } else {
      // sentar | mesa
      if (acao === 'mesa' && !mesaPedida) return NextResponse.json({ ok: false, erro: 'diga a mesa' }, { status: 400 });
      const mesaFinal = mesaPedida ?? r.mesa;
      if (!mesaFinal) return NextResponse.json({ ok: false, erro: 'diga em qual mesa' }, { status: 400 });
      const trocou = mesaPedida !== null && mesaPedida !== r.mesa;
      // Mesa nova = as juntadas antigas não valem mais (eram vizinhas da outra).
      const juntadasFinal = trocou ? null : r.mesaJuntada;
      if (trocou) {
        set.mesa = mesaFinal;
        set.mesaJuntada = null;
      }
      if (r.area) {
        const { mesasEstaoLivres } = await import('@/lib/reservas/mesa-disponivel');
        const { mesasDaReserva } = await import('@/lib/reservas/mesas-juntadas');
        const [filR] = await db
          .select({ reservaConfig: schema.filial.reservaConfig })
          .from(schema.filial)
          .where(eq(schema.filial.id, f))
          .limit(1);
        const mesasValidas = (filR?.reservaConfig?.areas ?? [])
          .find((a) => a.nome === r.area)
          ?.mesas?.map((m) => String(m.numero).trim());
        const livre = await mesasEstaoLivres({
          filialId: f,
          data: String(r.data),
          area: r.area,
          mesas: mesasDaReserva(mesaFinal, juntadasFinal),
          excluirReservaId: id,
          mesasValidas,
        });
        if (!livre) {
          return NextResponse.json({ ok: false, erro: `Mesa ${mesaFinal} não está livre — escolha outra.` }, { status: 409 });
        }
      }
      if (acao === 'sentar') set.status = 'sentada';
      else if (trocou) mensagem = `Sua mesa pra reserva de ${dataBr} às ${r.hora} agora é a mesa ${mesaFinal}.`;
    }

    await db.update(schema.reserva).set(set).where(and(eq(schema.reserva.id, id), eq(schema.reserva.filialId, f)));
    try {
      const { registrarAlteracoesReserva } = await import('@/lib/reservas/alteracoes');
      await registrarAlteracoesReserva(id, r, set, { tipo: 'equipe', nome: por });
    } catch {
      /* auditoria é best-effort */
    }
    if (mensagem && r.telefone) {
      try {
        const { enviarAtualizacaoReserva } = await import('@/lib/whatsapp-otp');
        await enviarAtualizacaoReserva(r.telefone, { nome: (r.nome || '').split(' ')[0] || 'tudo bem', mensagem });
      } catch {
        /* o aviso no zap nunca derruba a ação da recepção */
      }
    }
    return NextResponse.json({ ok: true });
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

type AvaliacaoNova = {
  cpf?: string; mes?: string; nota?: number; comentario?: string | null; nome?: string | null;
  whatsapp?: string | null; mesa?: number | null; brinde?: string | null; criado_em?: string;
};

/** AVALIE E GANHE UM DRINK: a avaliação feita no QR da mesa (vendas-local)
 *  chega aqui depois que o drink já entrou na conta. A trava de um-por-mês
 *  é da loja; aqui o índice único (filial, cpf, mes_ref) só evita duplicar
 *  quando a loja reenvia. Devolve o link do Google pra nota alta — convite
 *  opcional, NUNCA condição pro drink (Google proíbe avaliação incentivada). */
async function avaliacaoNova(f: string, b: AvaliacaoNova) {
  const nota = Number(b.nota);
  // CPF é do DRINK, não da avaliação. Quem só quer reclamar/elogiar (tela
  // "Avaliar" do QR da mesa) manda sem CPF e sem mês — o índice único
  // (filial, cpf, mes_ref) é parcial (WHERE cpf IS NOT NULL), então avaliação
  // sem CPF nunca esbarra na trava do um-drink-por-mês.
  const cpf = String(b.cpf || '').replace(/\D/g, '');
  const mes = String(b.mes || '') || hojeBr().slice(0, 7);
  if (!(Number.isInteger(nota) && nota >= 1 && nota <= 5) || (cpf && cpf.length !== 11) || !/^\d{4}-\d{2}$/.test(mes)) {
    return NextResponse.json({ ok: false, erro: 'dados inválidos' }, { status: 400 });
  }
  const { db, schema } = await import('@concilia/db');
  const { eq } = await import('drizzle-orm');
  const [fil] = await db
    .select({ googleUrl: schema.filial.googleReviewUrl, tripUrl: schema.filial.tripadvisorReviewUrl, corte: schema.filial.notaCorteGoogle })
    .from(schema.filial)
    .where(eq(schema.filial.id, f))
    .limit(1);
  if (!fil) return NextResponse.json({ ok: false, erro: 'filial' }, { status: 404 });
  const alta = nota >= (fil.corte ?? 4);
  const txt = (v: unknown, n: number) => (String(v ?? '').trim() ? String(v).trim().slice(0, n) : null);
  const mesa = Number(b.mesa) || null;
  const criado = b.criado_em && !Number.isNaN(Date.parse(b.criado_em)) ? new Date(b.criado_em) : new Date();
  const [nova] = await db
    .insert(schema.avaliacao)
    .values({
      filialId: f,
      nota,
      comentario: txt(b.comentario, 2000),
      nome: txt(b.nome, 200),
      whatsapp: String(b.whatsapp || '').replace(/\D/g, '').slice(0, 30) || null,
      origem: mesa ? `mesa-${mesa} (QR)` : 'mesa (QR)',
      foiPraGoogle: alta && !!(fil.googleUrl || fil.tripUrl),
      // nota alta nasce resolvida; baixa entra no painel pra equipe ligar
      status: alta ? 'resolvido' : 'novo',
      cpf: cpf || null,
      mesRef: mes,
      brinde: txt(b.brinde, 200),
      mesa,
      criadoEm: criado,
    })
    .onConflictDoNothing()
    .returning({ id: schema.avaliacao.id });
  let id = nova?.id ?? null;
  if (!id && cpf) {
    // reenvio: já está aqui — devolve o id pra loja parar de tentar
    const { and } = await import('drizzle-orm');
    const [ja] = await db
      .select({ id: schema.avaliacao.id })
      .from(schema.avaliacao)
      .where(and(eq(schema.avaliacao.filialId, f), eq(schema.avaliacao.cpf, cpf), eq(schema.avaliacao.mesRef, mes)))
      .limit(1);
    id = ja?.id ?? null;
  }
  return NextResponse.json({
    ok: true,
    id,
    google_url: alta ? fil.googleUrl ?? null : null,
    trip_url: alta ? fil.tripUrl ?? null : null,
  });
}

type EsperaNova = { nome?: string; pessoas?: number; telefone?: string | null; area?: string | null; observacao?: string | null };

/** Recepção colocou alguém na FILA pela tela da loja. É a MESMA lista_espera
 *  do /lista-espera na nuvem de propósito: uma fila só, vista pelo salão e
 *  pelo escritório, e o "chamar" manda o template de verdade do WhatsApp. */
async function esperaNova(f: string, b: EsperaNova) {
  const nome = String(b.nome || '').trim().slice(0, 200);
  if (!nome) return NextResponse.json({ ok: false, erro: 'diga o nome' }, { status: 400 });
  const pessoas = Math.max(1, Math.min(500, Math.round(Number(b.pessoas) || 1)));
  const txt = (v: unknown, n: number) => (String(v ?? '').trim() ? String(v).trim().slice(0, n) : null);
  const { db, schema } = await import('@concilia/db');
  const [nova] = await db
    .insert(schema.listaEspera)
    .values({
      filialId: f,
      nome,
      pessoas,
      telefone: String(b.telefone || '').replace(/\D/g, '').slice(0, 30) || null,
      area: txt(b.area, 100),
      observacao: txt(b.observacao, 500),
      status: 'aguardando',
    })
    .returning({ id: schema.listaEspera.id });
  return NextResponse.json({ ok: true, id: nova?.id ?? null });
}
