// Módulo MERCHANT do iFood na NUVEM: loja aberta, fechada ou pausada.
//
// Pausar é a válvula de escape do dia a dia — cozinha afogada, faltou insumo,
// entregador sumiu. Sem isso o pedido continua entrando e a casa leva nota
// ruim por atraso. NÃO mexe no horário de funcionamento: a pausa é temporária
// e o iFood reabre sozinho na hora marcada.
//
// Isto é o irmão de nuvem do que já roda em vendas-local/server.mjs. A versão
// da loja só sabe falar da PRÓPRIA casa; esta fala das três, o que importa
// porque Tabuará e Prainha Mar ainda não rodam vendas-local — pra elas o
// app.prainhabar.com é o único jeito de abrir, fechar e pausar por API.
//
// ⚠️ Este módulo NÃO é o de Pedidos. O app da Prainha (Concilia PDV Central)
// foi homologado em Order + Events; enquanto o Merchant não for liberado no
// Portal do Desenvolvedor, /status responde 403. A resposta honesta nesse caso
// é "não dá pra saber por aqui" — ver `sabe: false` abaixo.

import { ifoodApi, type CredIfood } from '@/lib/ifood-api';

export interface PausaIfood {
  id: string;
  descricao: string;
  inicio: string;
  fim: string;
  ativa: boolean;
}

export interface StatusLojaIfood {
  /** Conseguimos ler o estado da loja no iFood. false = 403/erro. */
  sabe: boolean;
  /** O 403 é falta do módulo Merchant no app, não erro de credencial. */
  semModulo: boolean;
  aberta: boolean | null;
  pausada: boolean;
  titulo: string;
  detalhe: string;
  /** Por que não entra pedido: validações do iFood que não estão OK. */
  motivos: string[];
  pausas: PausaIfood[];
}

function base(merchantId: string): string {
  return '/merchant/v1.0/merchants/' + encodeURIComponent(merchantId);
}

/** Início/fim de interrupção no fuso DA LOJA (BRT), nunca UTC.
 *
 *  ⚠️ FUSO (o erro mais caro deste módulo): o iFood lê start/end no fuso da
 *  loja e `toISOString()` devolve UTC. Mandar UTC fazia a pausa das 12:00 BRT
 *  nascer marcada pras 12:00 no fuso da loja — 3 horas no futuro. A loja
 *  continuava recebendo pedido e ninguém entendia por quê (23/08/2026: pausa
 *  criada, aceita, e sem efeito).
 *
 *  Na nuvem o buraco é ainda mais fundo que no vendas-local: a Vercel roda em
 *  UTC, então `getTimezoneOffset()` vale 0 e o truque do servidor da loja
 *  (subtrair o offset local) não corrigiria nada. Aqui o -3 é explícito. */
function isoBrt(d: Date): string {
  return new Date(d.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 19);
}

/** As lojas que ESTA credencial enxerga no iFood.
 *  É por aqui que se descobre o merchant_id de uma casa recém-autorizada no
 *  Portal do Parceiro — sem precisar catar UUID na mão. Paginado: um app com
 *  mais de 100 lojas perderia as do fim se lesse só a primeira página. */
export async function merchantsDoApp(c: CredIfood): Promise<Array<{ id: string; nome: string; razao: string }>> {
  const TAM = 100;
  const lojas: Array<{ id: string; nome: string; razao: string }> = [];
  for (let pagina = 1; pagina <= 20; pagina++) {
    const r = (await ifoodApi(c, `/merchant/v1.0/merchants?page=${pagina}&size=${TAM}`)) as Array<{
      id?: string; name?: string; corporateName?: string;
    }>;
    if (!Array.isArray(r) || r.length === 0) break;
    lojas.push(...r.map((m) => ({ id: m.id ?? '', nome: m.name ?? '', razao: m.corporateName ?? '' })));
    if (r.length < TAM) break;
  }
  return lojas;
}

export interface DetalhesLojaIfood {
  id: string;
  nome: string;
  razao: string;
  /** RESTAURANT | STORE | GROUP */
  tipo: string;
  /** AVAILABLE | UNAVAILABLE | DISABLED — cadastro, não "aberta agora". */
  situacao: string;
  ticketMedio: number | null;
  criadaEm: string;
  endereco: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  operacoes: Array<{ nome: string; canais: Array<{ nome: string; ativo: boolean }> }>;
}

/** Cadastro da loja no iFood: razão social, endereço e operações (delivery,
 *  salão) com os canais de venda de cada uma. Serve pra conferir que o
 *  merchant_id apontado é MESMO desta casa — endereço errado aqui é o sinal de
 *  UUID trocado entre filiais. */
export async function detalhesLoja(c: CredIfood, merchantId: string): Promise<DetalhesLojaIfood> {
  const m = (await ifoodApi(c, base(merchantId))) as Record<string, unknown>;
  const a = (m.address ?? {}) as Record<string, unknown>;
  const lista = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v ? [v as T] : []);
  return {
    id: String(m.id ?? merchantId),
    nome: String(m.name ?? ''),
    razao: String(m.corporateName ?? ''),
    tipo: String(m.type ?? ''),
    situacao: String(m.status ?? ''),
    ticketMedio: typeof m.averageTicket === 'number' ? m.averageTicket : null,
    criadaEm: String(m.createdAt ?? ''),
    endereco: [a.street, a.number].filter((x) => x != null && x !== '').join(', '),
    bairro: String(a.district ?? ''),
    cidade: String(a.city ?? ''),
    uf: String(a.state ?? ''),
    cep: String(a.postalCode ?? ''),
    operacoes: lista<{ name?: string; salesChannel?: unknown }>(m.operations).map((o) => ({
      nome: String(o.name ?? ''),
      canais: lista<{ name?: string; enabled?: boolean }>(o.salesChannel).map((sc) => ({
        nome: String(sc.name ?? ''),
        ativo: sc.enabled !== false,
      })),
    })),
  };
}

export async function statusLoja(c: CredIfood, merchantId: string): Promise<StatusLojaIfood> {
  const b = base(merchantId);
  // ⚠️ NÃO ENGOLIR O ERRO (10/09/2026): a versão anterior devolvia null/[] nos
  // dois .catch() e a tela dizia "Loja fechada" com a integração funcionando.
  // Mandar a loja caçar um problema que não existe é pior do que admitir que
  // não dá pra saber — quem prova que o recebimento está vivo é o polling.
  // Guarda em objeto e não em `let`: o TS zera o narrowing de variável
  // atribuída dentro de callback e depois trata `erro` como never.
  const falha: { e: Error | null } = { e: null };
  const [st, itr] = await Promise.all([
    ifoodApi(c, b + '/status').catch((e: Error) => { falha.e = e; return null; }),
    ifoodApi(c, b + '/interruptions').catch((e: Error) => { falha.e = falha.e ?? e; return []; }),
  ]);

  type Linha = {
    operation?: string; available?: boolean; state?: string;
    validations?: Array<{ state?: string; code?: string; message?: { title?: string } }>;
    message?: { title?: string };
  };
  const lista = Array.isArray(st) ? (st as Linha[]) : null;
  const linha = lista ? (lista.find((x) => (x.operation ?? '').toUpperCase() === 'DELIVERY') ?? lista[0]) : (st as Linha | null);

  if (!linha && falha.e) {
    const msg = String(falha.e.message ?? falha.e);
    const semModulo = /→ 403/.test(msg);
    return {
      sabe: false,
      semModulo,
      aberta: null,
      pausada: false,
      titulo: semModulo ? 'não dá pra saber por aqui' : 'não consegui consultar a loja',
      detalhe: semModulo
        ? 'este app tem só os módulos Order + Events — abrir, fechar e pausar seguem no app iFood Gestor de Pedidos. Não é erro: o recebimento de pedido não depende disso.'
        : msg.slice(0, 240),
      motivos: [],
      pausas: [],
    };
  }

  // Uma pausa ATIVA agora é o sinal confiável de "não está recebendo": o
  // /status não reflete a interrupção (conferido em 23/08/2026 — pausa criada
  // e listada, status seguiu "Loja aberta"). Confiar só no status faria a tela
  // dizer que está aberta com a loja pausada de verdade.
  const agora = Date.now();
  const brutas = Array.isArray(itr) ? (itr as Array<{ id?: string; description?: string; start?: string; end?: string }>) : [];
  const pausas: PausaIfood[] = brutas.map((i) => {
    const ini = Date.parse(String(i.start));
    const fim = Date.parse(String(i.end));
    return {
      id: String(i.id ?? ''),
      descricao: i.description ?? '',
      inicio: String(i.start ?? ''),
      fim: String(i.end ?? ''),
      ativa: Number.isFinite(ini) && Number.isFinite(fim) && ini <= agora && agora <= fim,
    };
  });
  const pausada = pausas.some((p) => p.ativa);

  return {
    sabe: true,
    semModulo: false,
    aberta: !!linha?.available && !pausada,
    pausada,
    titulo: pausada ? 'Pausada pela loja' : (linha?.message?.title || (linha?.available ? 'Loja aberta' : 'Loja fechada')),
    detalhe: '',
    motivos: (linha?.validations ?? [])
      .filter((v) => v.state !== 'OK')
      .map((v) => v.message?.title || v.code || '')
      .filter(Boolean),
    pausas,
  };
}

/** Pausa o recebimento por N minutos. 5 min é o mínimo que faz sentido no
 *  caixa; 24h é o teto pra ninguém pausar a loja e esquecer. */
export async function pausarLoja(
  c: CredIfood,
  merchantId: string,
  minutos: number,
  motivo: string,
): Promise<{ minutos: number }> {
  const min = Math.min(24 * 60, Math.max(5, Number(minutos) || 30));
  const agora = new Date();
  // 1 min de folga no início: relógio adiantado fazia o iFood recusar a pausa
  // por "start no passado".
  const inicio = new Date(agora.getTime() - 60 * 1000);
  const fim = new Date(agora.getTime() + min * 60 * 1000);
  await ifoodApi(c, base(merchantId) + '/interruptions', {
    metodo: 'POST',
    corpo: {
      description: String(motivo || 'Pausa pela loja').slice(0, 100),
      start: isoBrt(inicio),
      end: isoBrt(fim),
    },
  });
  return { minutos: min };
}

/** Volta a receber. Sem `id` remove TODAS as pausas — é o que "voltar a
 *  receber" quer dizer pra quem está no caixa; duas pausas sobrepostas
 *  manteriam a loja fechada mesmo depois de apagar uma. */
export async function retomarLoja(
  c: CredIfood,
  merchantId: string,
  id?: string,
): Promise<{ removidas: number }> {
  const b = base(merchantId) + '/interruptions';
  const alvos = id
    ? [id]
    : ((await ifoodApi(c, b).catch(() => [])) as Array<{ id?: string }>)
        .map((i) => String(i.id ?? ''))
        .filter(Boolean);
  let n = 0;
  for (const a of alvos) {
    try {
      await ifoodApi(c, b + '/' + encodeURIComponent(a), { metodo: 'DELETE' });
      n++;
    } catch (e) {
      console.error('[ifood] retomar', a, (e as Error).message);
    }
  }
  return { removidas: n };
}

export interface TurnoIfood {
  id: string;
  dia: string;
  inicio: string;
  /** Minutos a partir de `inicio`. */
  duracao: number;
}

/** Horário de funcionamento cadastrado no iFood. */
export async function horariosLoja(c: CredIfood, merchantId: string): Promise<TurnoIfood[]> {
  const r = (await ifoodApi(c, base(merchantId) + '/opening-hours')) as
    | { shifts?: Array<{ id?: string; dayOfWeek?: string; start?: string; duration?: number }> }
    | Array<{ shifts?: Array<{ id?: string; dayOfWeek?: string; start?: string; duration?: number }> }>;
  const shifts = Array.isArray(r) ? (r[0]?.shifts ?? []) : (r?.shifts ?? []);
  return shifts.map((s) => ({
    id: String(s.id ?? ''),
    dia: String(s.dayOfWeek ?? ''),
    inicio: String(s.start ?? ''),
    duracao: Number(s.duration ?? 0),
  }));
}

export const DIAS_IFOOD = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;

const DIA_PT: Record<string, string> = {
  MONDAY: 'segunda', TUESDAY: 'terça', WEDNESDAY: 'quarta', THURSDAY: 'quinta',
  FRIDAY: 'sexta', SATURDAY: 'sábado', SUNDAY: 'domingo',
};

function minutos(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Confere a semana ANTES de mandar pro iFood. O iFood devolve 400 pra turno
 *  encavalado, mas a mensagem dele não diz qual dia — aqui diz. `null` = ok. */
export function validarTurnos(turnos: Array<{ dia: string; inicio: string; duracao: number }>): string | null {
  if (!Array.isArray(turnos)) return 'lista de turnos inválida';
  for (const t of turnos) {
    if (!(DIAS_IFOOD as readonly string[]).includes(t.dia)) return `dia inválido: ${t.dia}`;
    if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(t.inicio))) {
      return `hora de início inválida na ${DIA_PT[t.dia]}: ${t.inicio}`;
    }
    if (!Number.isInteger(t.duracao) || t.duracao < 1 || t.duracao > 24 * 60) {
      return `duração inválida na ${DIA_PT[t.dia]}: precisa ser entre 1 minuto e 24 horas`;
    }
  }
  for (const d of DIAS_IFOOD) {
    const doDia = turnos.filter((t) => t.dia === d).sort((a, b) => minutos(a.inicio) - minutos(b.inicio));
    for (let i = 1; i < doDia.length; i++) {
      const ant = doDia[i - 1];
      if (minutos(ant.inicio) + ant.duracao > minutos(doDia[i].inicio)) {
        return `dois turnos se sobrepõem na ${DIA_PT[d]} (${ant.inicio.slice(0, 5)} e ${doDia[i].inicio.slice(0, 5)})`;
      }
    }
  }
  return null;
}

/** Grava a semana inteira de horário no iFood.
 *
 *  ⚠️ O PUT SUBSTITUI tudo: dia que não vier na lista fica FECHADO. Por isso a
 *  tela sempre parte do que o iFood devolveu e manda a semana completa, e a
 *  rota relê depois — quem prova que gravou é o GET, não o 201. */
export async function salvarHorarios(
  c: CredIfood,
  merchantId: string,
  turnos: Array<{ dia: string; inicio: string; duracao: number }>,
): Promise<TurnoIfood[]> {
  await ifoodApi(c, base(merchantId) + '/opening-hours', {
    metodo: 'PUT',
    corpo: {
      storeId: merchantId,
      shifts: turnos.map((t) => ({
        dayOfWeek: t.dia,
        start: t.inicio.length === 5 ? t.inicio + ':00' : t.inicio,
        duration: t.duracao,
      })),
    },
  });
  return horariosLoja(c, merchantId);
}
