// Lista de reservas do dia pelo WhatsApp (20/10/2026, pedido do dono): todo dia
// às 07:00 quem cuida de cada casa (chefe de cozinha, gerente de salão, bar)
// recebe as reservas de HOJE das casas dele; o dono e o gerente recebem todas.
//
// Quem recebe fica em relatorio_diario_config.destinos_reservas (tela em
// /relatorios/diario). O aviso vai pelo modelo aprovado `relatorio_diario`
// ({{1}} = "reservas de hoje (terça 21/10)", {{2}} = uma linha por casa) com o
// botão "Ver resumo" levando `reservas:<dia>`. O toque abre a janela de 24 h e
// a lista inteira chega em texto, lida na hora (pega o que mudou desde as 07:00).
// Quem falou com a gente nas últimas 24 h já recebe a lista direto.

import { db, schema } from '@concilia/db';
import type { DestinoReservasConfig } from '@concilia/db/schema';
import { and, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { enviarTexto } from '@/lib/atendimento/zap';
import { hojeBr } from '@/lib/datas';
import { rotuloDia } from '@/lib/relatorio-diario';
import { chaveTelefone, enviarModelo, registrar, type OrigemEnvio } from '@/lib/relatorio-diario-envio';

const JANELA_MS = (23 * 60 + 45) * 60 * 1000;
/** 01 Bar, 02 Tabuará, 03 Mar — ordem das casas na mensagem. */
const ORDEM_CASAS = [
  '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9',
  'fde37b95-7c7e-4b41-a618-2aba1fbc0de7',
  'e899dae2-38bf-4f3f-9149-7effd059fab8',
];
const STATUS_FORA = ['cancelada', 'no_show'];

export const PREFIXO_PAYLOAD = 'reservas:';

// ---------------------------------------------------------------------------
// Quem recebe
// ---------------------------------------------------------------------------

export async function destinosReservas(organizacaoId: string): Promise<DestinoReservasConfig[]> {
  const [row] = await db
    .select({ destinos: schema.relatorioDiarioConfig.destinosReservas })
    .from(schema.relatorioDiarioConfig)
    .where(eq(schema.relatorioDiarioConfig.organizacaoId, organizacaoId))
    .limit(1);
  return row?.destinos ?? [];
}

export async function salvarDestinosReservas(
  organizacaoId: string,
  destinos: DestinoReservasConfig[],
  usuarioId: string | null,
): Promise<void> {
  await db
    .insert(schema.relatorioDiarioConfig)
    .values({ organizacaoId, destinosReservas: destinos, atualizadoPor: usuarioId })
    .onConflictDoUpdate({
      target: schema.relatorioDiarioConfig.organizacaoId,
      set: { destinosReservas: destinos, atualizadoPor: usuarioId, atualizadoEm: new Date() },
    });
}

/** Todas as linhas (organização + pessoa) com o mesmo WhatsApp. */
async function destinosPorTelefone(fone: string): Promise<Array<DestinoReservasConfig & { organizacaoId: string }>> {
  const chave = chaveTelefone(fone);
  const rows = await db
    .select({ organizacaoId: schema.relatorioDiarioConfig.organizacaoId, destinos: schema.relatorioDiarioConfig.destinosReservas })
    .from(schema.relatorioDiarioConfig)
    .where(isNotNull(schema.relatorioDiarioConfig.destinosReservas));
  const achados: Array<DestinoReservasConfig & { organizacaoId: string }> = [];
  for (const r of rows) {
    for (const d of r.destinos ?? []) {
      if (d.ativo && chaveTelefone(d.telefone) === chave) achados.push({ ...d, organizacaoId: r.organizacaoId });
    }
  }
  return achados;
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

interface LinhaReserva {
  filial_id: string;
  hora: string;
  cliente_nome: string;
  pessoas: number;
  area: string | null;
  mesa: string | null;
  mesa_juntada: string | null;
  observacao: string | null;
  preferencias: string | null;
  bebida_pedido: string | null;
  pagamento_status: string | null;
  confirmada: boolean;
  status: string;
}

export interface CasaReservas {
  filialId: string;
  nome: string;
  reservas: LinhaReserva[];
}

function uuidArray(ids: string[]) {
  return sql`ARRAY[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]::uuid[]`;
}

export async function reservasDoDia(filialIds: string[], dia: string): Promise<CasaReservas[]> {
  if (!filialIds.length) return [];
  const filiais = (await db.execute(sql`
    SELECT id::text AS id, nome FROM filial WHERE id = ANY(${uuidArray(filialIds)})
  `)) as unknown as Array<{ id: string; nome: string }>;
  const linhas = (await db.execute(sql`
    SELECT filial_id::text AS filial_id, hora, cliente_nome, pessoas, area, mesa, mesa_juntada,
           observacao, preferencias::text AS preferencias, bebida_pedido, pagamento_status,
           (confirmada_cliente_em IS NOT NULL) AS confirmada, status
      FROM reserva
     WHERE filial_id = ANY(${uuidArray(filialIds)})
       AND data = ${dia}::date
       AND status NOT IN ('cancelada', 'no_show')
     ORDER BY hora, cliente_nome
  `)) as unknown as LinhaReserva[];
  const pos = (id: string) => {
    const i = ORDEM_CASAS.indexOf(id);
    return i < 0 ? 99 : i;
  };
  return filiais
    .sort((a, b) => pos(a.id) - pos(b.id) || a.nome.localeCompare(b.nome))
    .map((f) => ({
      filialId: f.id,
      nome: f.nome,
      reservas: linhas.filter((l) => l.filial_id === f.id && !STATUS_FORA.includes(l.status)),
    }));
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const pessoasDe = (rs: LinhaReserva[]) => rs.reduce((s, r) => s + (Number(r.pessoas) || 0), 0);

/** {{2}} do modelo: uma linha por casa. */
export function resumoReservas(casas: CasaReservas[]): string {
  return casas
    .map((c) => {
      if (!c.reservas.length) return `${c.nome}: nenhuma reserva`;
      return `${c.nome}: ${plural(c.reservas.length, 'reserva', 'reservas')} · ${plural(pessoasDe(c.reservas), 'pessoa', 'pessoas')} · 1ª às ${c.reservas[0]!.hora}`;
    })
    .join(' | ');
}

/** Preferências guardadas como json (lista ou objeto) → texto curto. */
function textoPreferencias(bruto: string | null): string {
  if (!bruto) return '';
  try {
    const v = JSON.parse(bruto) as unknown;
    if (Array.isArray(v)) return v.map(String).filter(Boolean).join(', ');
    if (v && typeof v === 'object') {
      return Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== false && x != null && x !== '')
        .map(([k, x]) => (x === true ? k : `${k}: ${String(x)}`))
        .join(', ');
    }
    return String(v ?? '');
  } catch {
    return bruto;
  }
}

const corta = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

function linhaReserva(r: LinhaReserva): string {
  const partes = [`${r.hora} · ${corta(r.cliente_nome || 'sem nome', 32)} · ${r.pessoas}p`];
  if (r.mesa) partes.push(`mesa ${r.mesa}${r.mesa_juntada ? `+${r.mesa_juntada}` : ''}`);
  const marcas: string[] = [];
  if (r.status === 'sentada') marcas.push('🪑 sentada');
  else if (r.confirmada) marcas.push('✅');
  if (r.pagamento_status === 'pago') marcas.push('💳 pago');
  if (r.bebida_pedido) marcas.push(`🍾 ${corta(r.bebida_pedido, 30)}`);
  let txt = partes.join(' · ') + (marcas.length ? ` ${marcas.join(' ')}` : '');
  const extra = [r.observacao ?? '', textoPreferencias(r.preferencias)]
    .map((x) => x.trim())
    .filter((x) => x && !/^Reserva feita pela Nina/i.test(x));
  if (extra.length) txt += `\n   _${corta(extra.join(' · '), 120)}_`;
  return txt;
}

function blocoCasa(c: CasaReservas): string {
  if (!c.reservas.length) return `*${c.nome}*\nNenhuma reserva pra hoje.`;
  const porArea = new Map<string, LinhaReserva[]>();
  for (const r of c.reservas) {
    const a = r.area?.trim() || 'Sem área';
    porArea.set(a, [...(porArea.get(a) ?? []), r]);
  }
  const areas = [...porArea.entries()].sort((a, b) => a[1][0]!.hora.localeCompare(b[1][0]!.hora));
  const partes = [
    `*${c.nome}* — ${plural(c.reservas.length, 'reserva', 'reservas')} · ${plural(pessoasDe(c.reservas), 'pessoa', 'pessoas')}`,
  ];
  for (const [area, rs] of areas) {
    partes.push(`\n*${area}* (${rs.length} · ${pessoasDe(rs)}p)\n${rs.map(linhaReserva).join('\n')}`);
  }
  return partes.join('\n');
}

/** Texto inteiro, quebrado em mensagens de até ~3.500 caracteres (limite da Meta é 4.096). */
export function textoReservas(casas: CasaReservas[], dia: string): string[] {
  const cabecalho = `📋 *Reservas ${dia === hojeBr() ? "de hoje" : "do dia"} — ${rotuloDia(dia)}*\n✅ confirmou · 💳 pago · 🍾 bebida pedida`;
  const blocos = casas.map(blocoCasa);
  const msgs: string[] = [];
  let atual = cabecalho;
  for (const bloco of blocos) {
    // casa grande demais: quebra por linha
    const pedacos = bloco.length > 3400 ? bloco.split('\n') : [bloco];
    const sep = pedacos.length > 1 ? '\n' : '\n\n';
    for (const [i, p] of pedacos.entries()) {
      const junta = i === 0 ? '\n\n' : sep;
      if ((atual + junta + p).length > 3500) {
        msgs.push(atual);
        atual = p;
      } else {
        atual += junta + p;
      }
    }
  }
  msgs.push(atual);
  return msgs;
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

/** A pessoa falou com o número padrão nas últimas 24 h? (texto livre chega) */
async function janelaAberta(telefone: string, phoneNumberId: string): Promise<boolean> {
  const [toque] = await db
    .select({ id: schema.relatorioDiarioEnvio.id })
    .from(schema.relatorioDiarioEnvio)
    .where(
      and(
        eq(schema.relatorioDiarioEnvio.telefone, telefone),
        eq(schema.relatorioDiarioEnvio.canal, 'toque'),
        eq(schema.relatorioDiarioEnvio.phoneNumberId, phoneNumberId),
        gte(schema.relatorioDiarioEnvio.criadoEm, new Date(Date.now() - JANELA_MS)),
      ),
    )
    .limit(1);
  return !!toque;
}

async function jaFoiHoje(organizacaoId: string, telefone: string, dia: string): Promise<boolean> {
  const [linha] = await db
    .select({ id: schema.relatorioDiarioEnvio.id })
    .from(schema.relatorioDiarioEnvio)
    .where(
      and(
        eq(schema.relatorioDiarioEnvio.organizacaoId, organizacaoId),
        eq(schema.relatorioDiarioEnvio.telefone, telefone),
        eq(schema.relatorioDiarioEnvio.dia, dia),
        eq(schema.relatorioDiarioEnvio.canal, 'reservas'),
        eq(schema.relatorioDiarioEnvio.ok, true),
      ),
    )
    .limit(1);
  return !!linha;
}

/** Manda a lista inteira em texto. true = a Meta aceitou tudo. */
async function enviarListaTexto(
  alvo: { organizacaoId: string; telefone: string; para: string; phoneNumberId: string; filialIds: string[] },
  dia: string,
  origem: OrigemEnvio,
): Promise<{ ok: boolean; erro?: string }> {
  const casas = await reservasDoDia(alvo.filialIds, dia);
  for (const corpo of textoReservas(casas, dia)) {
    const r = await enviarTexto(alvo.phoneNumberId, alvo.para, corpo);
    if (!r.waMessageId) {
      await registrar({
        organizacaoId: alvo.organizacaoId,
        dia,
        telefone: alvo.telefone,
        canal: 'reservas',
        origem,
        ok: false,
        erro: `texto: ${r.erro ?? 'falhou'}`,
        phoneNumberId: alvo.phoneNumberId,
      });
      return { ok: false, erro: r.erro };
    }
  }
  return { ok: true };
}

export interface ResultadoReservas {
  nome: string;
  telefone: string;
  ok: boolean;
  canal: 'modelo' | 'texto' | 'nenhum';
  erro?: string;
  pulado?: boolean;
}

/**
 * Manda as reservas de `dia` pra quem está cadastrado. `cron` não repete quem
 * já recebeu no dia; `manual` manda de novo. `soTelefone` = só essa pessoa.
 */
export async function enviarReservasDoDia(opts: {
  organizacaoId: string;
  dia: string;
  origem: OrigemEnvio;
  soTelefone?: string;
}): Promise<ResultadoReservas[]> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_ID || '';
  const destinos = (await destinosReservas(opts.organizacaoId)).filter(
    (d) => d.ativo && d.filialIds.length && (!opts.soTelefone || chaveTelefone(d.telefone) === chaveTelefone(opts.soTelefone)),
  );
  const out: ResultadoReservas[] = [];
  for (const d of destinos) {
    if (opts.origem === 'cron' && (await jaFoiHoje(opts.organizacaoId, d.telefone, opts.dia))) {
      out.push({ nome: d.nome, telefone: d.telefone, ok: true, canal: 'nenhum', pulado: true });
      continue;
    }
    // Janela aberta: a lista inteira direto, sem precisar tocar no botão.
    if (phoneNumberId && (await janelaAberta(d.telefone, phoneNumberId))) {
      const r = await enviarListaTexto(
        { organizacaoId: opts.organizacaoId, telefone: d.telefone, para: d.telefone, phoneNumberId, filialIds: d.filialIds },
        opts.dia,
        opts.origem,
      );
      if (r.ok) {
        await registrar({
          organizacaoId: opts.organizacaoId,
          dia: opts.dia,
          telefone: d.telefone,
          canal: 'reservas',
          origem: opts.origem,
          ok: true,
          erro: 'texto',
          phoneNumberId,
        });
        out.push({ nome: d.nome, telefone: d.telefone, ok: true, canal: 'texto' });
        continue;
      }
      // texto falhou (janela fechou de fato): cai pro modelo
    }
    const casas = await reservasDoDia(d.filialIds, opts.dia);
    const r = await enviarModelo(
      d.telefone,
      opts.dia,
      resumoReservas(casas),
      `reservas de hoje (${rotuloDia(opts.dia)})`,
      `${PREFIXO_PAYLOAD}${opts.dia}`,
    );
    const ok = !!r.waMessageId;
    await registrar({
      organizacaoId: opts.organizacaoId,
      dia: opts.dia,
      telefone: d.telefone,
      canal: 'reservas',
      origem: opts.origem,
      ok,
      erro: r.erro ?? null,
      waMessageId: r.waMessageId,
      phoneNumberId: r.phoneNumberId,
    });
    out.push({ nome: d.nome, telefone: d.telefone, ok, canal: 'modelo', erro: r.erro });
  }
  return out;
}

/** Cron das 07:00: todas as organizações com alguém cadastrado. */
export async function enviarReservasDeHojeTodas(dia: string): Promise<Array<{ organizacaoId: string; envios: ResultadoReservas[] | string }>> {
  const orgs = await db
    .select({ id: schema.relatorioDiarioConfig.organizacaoId })
    .from(schema.relatorioDiarioConfig)
    .where(isNotNull(schema.relatorioDiarioConfig.destinosReservas));
  const out: Array<{ organizacaoId: string; envios: ResultadoReservas[] | string }> = [];
  for (const o of orgs) {
    try {
      out.push({ organizacaoId: o.id, envios: await enviarReservasDoDia({ organizacaoId: o.id, dia, origem: 'cron' }) });
    } catch (e) {
      out.push({ organizacaoId: o.id, envios: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Toque no botão / pedido por texto
// ---------------------------------------------------------------------------

/** "lista de reservas", "reservas de hoje", "reservas do dia" — só de quem está cadastrado. */
const PEDIDO_TEXTO = /^(a )?(lista (de|das) )?reservas( de hoje| do dia)?[.!?]*$/i;

/**
 * Webhook: toque no "Ver resumo" do aviso de reservas (payload `reservas:<dia>`)
 * ou um cadastrado escrevendo "reservas de hoje". Devolve o envio da lista (rodar no after) ou null.
 */
export async function tratarPedidoReservas(msg: {
  id?: string;
  from?: string;
  payload?: string;
  texto?: string;
  phoneNumberId?: string;
}): Promise<(() => Promise<void>) | null> {
  if (!msg.from || !msg.phoneNumberId) return null;
  let dia: string | null = null;
  let origem: OrigemEnvio = 'toque';
  if (msg.payload?.startsWith(PREFIXO_PAYLOAD)) {
    const d = msg.payload.slice(PREFIXO_PAYLOAD.length);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) dia = d;
  } else if (!msg.payload && msg.texto && /reservas/i.test(msg.texto)) {
    const t = msg.texto.trim();
    if (t.length <= 40 && PEDIDO_TEXTO.test(t)) {
      dia = hojeBr();
      origem = 'pedido';
    }
  }
  if (!dia) return null;

  const destinos = await destinosPorTelefone(msg.from);
  if (!destinos.length) return null;

  // A Meta reentrega webhook: a mesma mensagem não manda a lista duas vezes.
  if (msg.id) {
    const [repetida] = await db
      .select({ id: schema.relatorioDiarioEnvio.id })
      .from(schema.relatorioDiarioEnvio)
      .where(and(eq(schema.relatorioDiarioEnvio.waMessageId, msg.id), eq(schema.relatorioDiarioEnvio.canal, 'toque')))
      .limit(1);
    if (repetida) return async () => {};
  }
  const para = msg.from;
  const phoneNumberId = msg.phoneNumberId;
  const diaPedido = dia;
  // o toque abre a janela de 24 h (vale pro relatório e pras reservas)
  await registrar({
    organizacaoId: destinos[0]!.organizacaoId,
    dia: diaPedido,
    telefone: destinos[0]!.telefone,
    canal: 'toque',
    origem,
    ok: true,
    waMessageId: msg.id ?? null,
    phoneNumberId,
  });
  return async () => {
    for (const d of destinos) {
      const r = await enviarListaTexto(
        { organizacaoId: d.organizacaoId, telefone: d.telefone, para, phoneNumberId, filialIds: d.filialIds },
        diaPedido,
        origem,
      );
      if (!r.ok) break;
    }
  };
}
