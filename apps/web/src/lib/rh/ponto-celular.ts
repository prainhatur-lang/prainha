// Ponto pelo celular com GPS + selfie (24/10/2026). O dono viu batidas que
// parecem ajustadas à mão (Claudio, manobrista do Bar, sempre 08:00–20:00) e
// quer prova de ONDE e de QUEM bateu.
//
// Como a pessoa é identificada:
//  - link pessoal /op/ponto/<token> (funcionario.ponto_celular_token), gerado
//    pelo gerente em /rh/ponto. Gerar de novo invalida o anterior;
//  - e a cada batida uma selfie: o celular calcula o descritor do rosto
//    (face-api, o mesmo motor do tablet) e o SERVIDOR compara com o rosto
//    cadastrado no tablet (limiar 0.45, o mesmo PF_LIMIAR da loja). Sem rosto
//    cadastrado, não bate pelo celular — o cadastro do rosto é presencial.
//  Link sozinho (ou CPF+PIN) se passa pro colega; selfie + GPS juntos, não.
//
// Fora do raio = RECUSA (não fica "pendente pro gerente aprovar"): a suspeita
// do dono é justamente de ajuste à mão, e o caminho manual já existe com
// justificativa obrigatória (/rh/ponto → corrigir). Toda tentativa, aceita ou
// não, fica em ponto_celular_tentativa — o gerente vê "tentou a 3,2 km".
//
// Regras iguais às do tablet (vendas-local/server.mjs): tipo pela última
// batida do dia operacional na casa, 5 min entre batidas, trava de dias por
// semana (pontoTravaSemana) e trava antes da hora (pontoTravaCedo), só na
// primeira entrada do dia.
//
// Cerca geográfica (24/10/2026, ponto_cerca): além do círculo da casa, o
// gerente desenha áreas no mapa (/rh/ponto). Vale dentro do círculo OU dentro
// de uma cerca da casa que vale pra pessoa (vazia = todos; com nomes = só
// eles, ex.: motoristas no estacionamento). A casa pode ter só cerca, sem
// círculo. Recusa mostra a distância até a área mais perto.
//
// Intervalo (30/10/2026, pedido do dono): "Sair pro intervalo" e "Voltar do
// intervalo" NÃO cobram a área — só entrada e saída do dia. Continua exigindo
// o rosto e grava onde a pessoa estava. A batida vai com dispositivo
// 'celular_intervalo' (origem continua 'celular'); a volta só vale se a
// última batida do dia foi uma saída pro intervalo, e fica na mesma casa.

import crypto from 'node:crypto';
import { db, schema } from '@concilia/db';
import { and, asc, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { dateToBrYmd } from '@/lib/datas';
import { PONTO_VIRADA_HORA, horaMinutoBr, somarDias } from '@/lib/rh/dia-operacional';
import { projetarPontoEmFolhaHoras } from '@/lib/rh/projetar-horas';
import { avisarLojaRosterPonto } from '@/lib/ponto-loja';
import { distanciaAoPoligonoM, verticesValidos, type Vertice } from '@/lib/rh/geo-cerca';

/** Mesmo limiar do reconhecimento do tablet (PF_LIMIAR). */
export const FACE_LIMIAR = 0.45;
/** GPS com precisão pior que isso não prova nada (sinal de dentro de casa, wi-fi). */
export const GPS_PRECISAO_MAX_M = 200;
/** Mesmo intervalo do tablet (PONTO_COOLDOWN_MS). */
export const COOLDOWN_MS = 5 * 60 * 1000;
/** Marca da batida de intervalo pelo celular (sem cobrar a área). */
export const DISPOSITIVO_INTERVALO = 'celular_intervalo';
/** Mesma tolerância do tablet (PONTO_TOLERANCIA_CEDO_MIN). */
export const TOLERANCIA_CEDO_MIN = 10;

export type ResultadoTentativa =
  | 'aceita'
  | 'fora_do_raio'
  | 'gps_fraco'
  | 'rosto'
  | 'trava_semana'
  | 'antes_da_hora'
  | 'intervalo'
  | 'intervalo_ordem'
  | 'sem_casa';

export const RESULTADO_ROTULO: Record<ResultadoTentativa, string> = {
  aceita: 'aceita',
  fora_do_raio: 'fora do raio',
  gps_fraco: 'GPS fraco',
  rosto: 'rosto não confere',
  trava_semana: 'limite de dias',
  antes_da_hora: 'antes da hora',
  intervalo: 'menos de 5 min',
  intervalo_ordem: 'intervalo fora de ordem',
  sem_casa: 'casa sem local',
};

export function novoTokenPontoCelular(): string {
  return crypto.randomBytes(18).toString('base64url');
}

/** Distância em metros entre dois pontos (haversine). */
export function distanciaM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function distanciaFacial(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return Infinity;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

/** Dia operacional (virada às 05:00 BRT) de um instante. */
export function diaOperacionalDe(quando: Date): string {
  return dateToBrYmd(new Date(quando.getTime() - PONTO_VIRADA_HORA * 3600 * 1000));
}

function segundaDa(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number);
  const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return somarDias(dia, -((dow + 6) % 7));
}

function descritorValido(x: unknown): number[] | null {
  if (!Array.isArray(x) || x.length !== 128) return null;
  const v = x.map(Number);
  return v.every((n) => Number.isFinite(n)) ? v : null;
}

/** Fmt "1,2 km" / "85 m". */
export function fmtDistancia(m: number | null | undefined): string {
  if (m == null) return '—';
  if (m >= 1000) return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
  return `${Math.round(m)} m`;
}

export interface CercaPonto {
  id: string;
  nome: string;
  pontos: Vertice[];
  folgaM: number;
}

export interface CasaPonto {
  id: string;
  nome: string;
  /** Círculo da casa; null = a casa só tem cerca(s). */
  lat: number | null;
  lng: number | null;
  raioM: number;
  /** Cercas ativas da casa que valem pra esta pessoa. */
  cercas: CercaPonto[];
}

/** Pessoa do link + casas dela (principal + extras) que têm local marcado. */
export async function pessoaDoToken(token: string) {
  if (!token || token.length < 16 || token.length > 64) return null;
  const [p] = await db
    .select({
      id: schema.funcionario.id,
      nome: schema.funcionario.nome,
      filialId: schema.funcionario.filialId,
      ativo: schema.funcionario.ativo,
      faceDescriptor: schema.funcionario.faceDescriptor,
      limiteDiasSemana: schema.funcionario.limiteDiasSemana,
      limiteLiberadoDia: schema.funcionario.limiteLiberadoDia,
      pontoHoraEntrada: schema.funcionario.pontoHoraEntrada,
      pontoCedoLiberadoDia: schema.funcionario.pontoCedoLiberadoDia,
    })
    .from(schema.funcionario)
    .where(eq(schema.funcionario.pontoCelularToken, token))
    .limit(1);
  if (!p || !p.ativo) return null;
  const extras = await db
    .select({ filialId: schema.funcionarioFilialExtra.filialId })
    .from(schema.funcionarioFilialExtra)
    .where(eq(schema.funcionarioFilialExtra.funcionarioId, p.id));
  const ids = [...new Set([p.filialId, ...extras.map((e) => e.filialId)])];
  const filiais = await db
    .select({
      id: schema.filial.id,
      nome: schema.filial.nome,
      lat: schema.filial.pontoLat,
      lng: schema.filial.pontoLng,
      raioM: schema.filial.pontoRaioM,
    })
    .from(schema.filial)
    .where(inArray(schema.filial.id, ids));
  const cercas = await db
    .select({
      id: schema.pontoCerca.id,
      filialId: schema.pontoCerca.filialId,
      nome: schema.pontoCerca.nome,
      pontos: schema.pontoCerca.pontos,
      folgaM: schema.pontoCerca.folgaM,
      funcionarioIds: schema.pontoCerca.funcionarioIds,
    })
    .from(schema.pontoCerca)
    .where(and(inArray(schema.pontoCerca.filialId, ids), eq(schema.pontoCerca.ativa, true)));
  const casas: CasaPonto[] = filiais
    .map((f) => ({
      id: f.id,
      nome: f.nome,
      lat: f.lat != null && f.lng != null ? Number(f.lat) : null,
      lng: f.lat != null && f.lng != null ? Number(f.lng) : null,
      raioM: f.raioM,
      cercas: cercas
        .filter((c) => c.filialId === f.id && (!c.funcionarioIds?.length || c.funcionarioIds.includes(p.id)))
        .flatMap((c) => {
          const v = verticesValidos(c.pontos);
          return v ? [{ id: c.id, nome: c.nome, pontos: v, folgaM: c.folgaM }] : [];
        }),
    }))
    .filter((c) => c.lat != null || c.cercas.length > 0);
  return { ...p, casas, temRosto: !!descritorValido(p.faceDescriptor) };
}

export type PessoaToken = NonNullable<Awaited<ReturnType<typeof pessoaDoToken>>>;

/** Batidas válidas da pessoa no dia operacional (todas as casas). */
export async function batidasDoDia(funcionarioId: string, dia: string) {
  return db
    .select({
      id: schema.pontoBatida.id,
      filialId: schema.pontoBatida.filialId,
      quando: schema.pontoBatida.quando,
      tipo: schema.pontoBatida.tipo,
      origem: schema.pontoBatida.origem,
      dispositivo: schema.pontoBatida.dispositivo,
    })
    .from(schema.pontoBatida)
    .where(
      and(
        eq(schema.pontoBatida.funcionarioId, funcionarioId),
        eq(schema.pontoBatida.diaOperacional, dia),
        isNull(schema.pontoBatida.excluidaEm),
      ),
    )
    .orderBy(asc(schema.pontoBatida.quando));
}

export interface PedidoBatida {
  lat: number;
  lng: number;
  precisao: number;
  descriptor: unknown;
  userAgent?: string | null;
  /** Selfie em JPEG (data URL ou base64), opcional — celular antigo sem ela ainda bate. */
  selfie?: string | null;
  /** Intervalo (descanso): 'sair' ou 'voltar' — não cobra a área. Sem isso = entrada/saída normal. */
  intervalo?: 'sair' | 'voltar' | null;
}

/** Selfie do pedido → JPEG/PNG/WebP de até 300 KB; qualquer coisa estranha vira null. */
function selfieDoPedido(raw: string | null | undefined): { buf: Buffer; mime: string } | null {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  const mime = m ? m[1]! : 'image/jpeg';
  try {
    const buf = Buffer.from(m ? m[2]! : raw, 'base64');
    if (buf.length < 500 || buf.length > 300_000) return null;
    return { buf, mime };
  } catch {
    return null;
  }
}

export type RespostaBatida =
  | { ok: true; tipo: 'entrada' | 'saida'; casa: string; quando: string; distanciaM: number | null; intervalo?: 'sair' | 'voltar' }
  | { ok: false; resultado: ResultadoTentativa; erro: string; distanciaM?: number; casa?: string };

/** Bate o ponto (ou recusa). Toda chamada grava uma linha em ponto_celular_tentativa. */
export async function baterPontoCelular(p: PessoaToken, req: PedidoBatida): Promise<RespostaBatida> {
  const agora = new Date();
  const dia = diaOperacionalDe(agora);
  const lat = Number(req.lat);
  const lng = Number(req.lng);
  const precisao = Math.round(Number(req.precisao) || 0);

  // Áreas da pessoa: o círculo de cada casa e as cercas que valem pra ela.
  // "falta" = quanto falta pra entrar (<= 0 = dentro). Dentro de alguma, vale;
  // a cerca tem preferência (fica gravado em qual área bateu). Fora de todas,
  // a mais perto explica a recusa.
  type Area = { casa: CasaPonto; cerca: CercaPonto | null; falta: number; dist: number };
  const areas: Area[] = [];
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    for (const c of p.casas) {
      if (c.lat != null && c.lng != null) {
        const d = distanciaM(lat, lng, c.lat, c.lng);
        areas.push({ casa: c, cerca: null, falta: d - c.raioM, dist: d });
      }
      for (const k of c.cercas) {
        const d = distanciaAoPoligonoM(lat, lng, k.pontos);
        areas.push({ casa: c, cerca: k, falta: d - k.folgaM, dist: d });
      }
    }
  }
  const dentro = areas.filter((a) => a.falta <= 0);
  const area: Area | null =
    dentro.find((a) => a.cerca) ?? dentro[0] ?? [...areas].sort((a, b) => a.falta - b.falta)[0] ?? null;
  const casa: CasaPonto | null = area?.casa ?? p.casas[0] ?? null;
  // Distância gravada: até o ponto da casa quando ela tem círculo; senão até a cerca.
  const dist =
    area && casa?.lat != null && casa.lng != null ? distanciaM(lat, lng, casa.lat, casa.lng) : (area?.dist ?? Infinity);
  const distM = Number.isFinite(dist) ? Math.round(dist) : null;
  const cercaId = area?.cerca?.id ?? null;
  // O que vai na linha da tentativa (o intervalo troca pela casa da última batida).
  let casaTentativa: string | null = casa?.id ?? null;
  let cercaTentativa: string | null = cercaId;
  let distTentativa: number | null = distM;

  const descr = descritorValido(req.descriptor);
  const cadastrado = descritorValido(p.faceDescriptor);
  const fd = descr && cadastrado ? distanciaFacial(descr, cadastrado) : null;
  const faceDist = fd != null && Number.isFinite(fd) ? Math.round(fd * 1000) : null;
  const selfie = selfieDoPedido(req.selfie);

  const registrar = async (
    resultado: ResultadoTentativa,
    motivo: string | null,
    tipo: string | null,
    batidaId: string | null = null,
  ) => {
    try {
      await db.insert(schema.pontoCelularTentativa).values({
        funcionarioId: p.id,
        filialId: casaTentativa,
        quando: agora,
        diaOperacional: dia,
        tipo,
        resultado,
        motivo,
        lat: Number.isFinite(lat) ? lat.toFixed(7) : null,
        lng: Number.isFinite(lng) ? lng.toFixed(7) : null,
        precisaoM: Number.isFinite(precisao) ? Math.min(precisao, 2_000_000_000) : null,
        distanciaM: distTentativa,
        faceDist,
        batidaId,
        userAgent: req.userAgent ? req.userAgent.slice(0, 300) : null,
        cercaId: cercaTentativa,
        selfie: selfie?.buf ?? null,
        selfieMime: selfie?.mime ?? null,
      });
    } catch (err) {
      console.error('[ponto-celular] registrar tentativa:', err instanceof Error ? err.message : err);
    }
  };
  const recusa = async (resultado: ResultadoTentativa, erro: string, tipo: string | null = null): Promise<RespostaBatida> => {
    await registrar(resultado, erro, tipo);
    return { ok: false, resultado, erro, distanciaM: distTentativa ?? undefined, casa: casa?.nome };
  };

  if (req.intervalo === 'sair' || req.intervalo === 'voltar') {
    return baterIntervalo(req.intervalo);
  }

  // Intervalo: rosto obrigatório, área não. Casa = a da última batida do dia.
  async function baterIntervalo(modo: 'sair' | 'voltar'): Promise<RespostaBatida> {
    const tipoInt: 'entrada' | 'saida' = modo === 'sair' ? 'saida' : 'entrada';
    const doDiaInt = await batidasDoDia(p.id, dia);
    const ult = doDiaInt[doDiaInt.length - 1];
    if (ult) {
      casaTentativa = ult.filialId;
      // Distância até a casa da última batida (círculo ou cerca mais perto dela).
      const daCasa = areas.filter((a) => a.casa.id === ult.filialId);
      const c0 = daCasa[0]?.casa;
      const d =
        c0?.lat != null && c0.lng != null
          ? distanciaM(lat, lng, c0.lat, c0.lng)
          : daCasa.length
            ? Math.min(...daCasa.map((a) => a.dist))
            : null;
      distTentativa = d != null && Number.isFinite(d) ? Math.round(d) : null;
      cercaTentativa = daCasa.find((a) => a.cerca && a.falta <= 0)?.cerca?.id ?? null;
    }
    if (!cadastrado) {
      return recusa('rosto', 'Seu rosto ainda não está cadastrado. Bata uma vez no tablet da casa pra cadastrar.', tipoInt);
    }
    if (!descr || fd == null || fd >= FACE_LIMIAR) {
      return recusa('rosto', 'O rosto da selfie não confere com o seu cadastro. Tente de novo, de frente e com luz.', tipoInt);
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return recusa('gps_fraco', 'Não consegui a localização. Ligue o GPS e tente de novo.', tipoInt);
    }
    if (modo === 'sair' && ult?.tipo !== 'entrada') {
      return recusa('intervalo_ordem', 'Pra sair pro intervalo, primeiro bata a entrada do dia.', tipoInt);
    }
    if (modo === 'voltar' && !(ult?.tipo === 'saida' && ult.dispositivo === DISPOSITIVO_INTERVALO)) {
      return recusa('intervalo_ordem', 'Você não está no intervalo. Use o botão de entrada ou saída.', tipoInt);
    }
    if (Math.abs(agora.getTime() - ult!.quando.getTime()) < COOLDOWN_MS) {
      return recusa('intervalo', 'Você bateu o ponto há menos de 5 minutos.', tipoInt);
    }
    const [f] = await db
      .select({ nome: schema.filial.nome })
      .from(schema.filial)
      .where(eq(schema.filial.id, ult!.filialId))
      .limit(1);
    const [nova] = await db
      .insert(schema.pontoBatida)
      .values({
        filialId: ult!.filialId,
        funcionarioId: p.id,
        quando: agora,
        diaOperacional: dia,
        tipo: tipoInt,
        origem: 'celular',
        dispositivo: DISPOSITIVO_INTERVALO,
        geoLat: lat.toFixed(7),
        geoLng: lng.toFixed(7),
        geoPrecisaoM: Number.isFinite(precisao) ? Math.min(precisao, 2_000_000_000) : null,
        geoDistanciaM: distTentativa,
        faceDist,
        geoCercaId: cercaTentativa,
      })
      .returning({ id: schema.pontoBatida.id });
    await registrar('aceita', null, tipoInt, nova.id);
    try {
      await projetarPontoEmFolhaHoras(ult!.filialId, dia, dia);
    } catch (err) {
      console.error('[ponto-celular] projetar folha (intervalo):', err instanceof Error ? err.message : err);
    }
    try {
      const r = await avisarLojaRosterPonto(ult!.filialId);
      if (!r.ok) console.warn(`[ponto-celular] aviso não chegou na loja ${ult!.filialId.slice(0, 8)}: ${r.erro}`);
    } catch (err) {
      console.warn('[ponto-celular] aviso à loja (intervalo):', err instanceof Error ? err.message : err);
    }
    return { ok: true, tipo: tipoInt, casa: f?.nome ?? '', quando: agora.toISOString(), distanciaM: distTentativa, intervalo: modo };
  }

  if (!casa || (casa.lat == null && casa.cercas.length === 0)) {
    return recusa('sem_casa', 'Sua casa ainda não tem o local marcado pro ponto pelo celular. Bata no tablet.');
  }
  if (!cadastrado) {
    return recusa('rosto', 'Seu rosto ainda não está cadastrado. Bata uma vez no tablet da casa pra cadastrar.');
  }
  if (!descr || fd == null || fd >= FACE_LIMIAR) {
    return recusa('rosto', 'O rosto da selfie não confere com o seu cadastro. Tente de novo, de frente e com luz.');
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || precisao <= 0 || precisao > GPS_PRECISAO_MAX_M) {
    return recusa(
      'gps_fraco',
      `O GPS do celular está impreciso (${precisao > 0 ? fmtDistancia(precisao) : 'sem sinal'}). Ligue a localização precisa e tente ao ar livre.`,
    );
  }
  if (!area || area.falta > 0) {
    if (area?.cerca) {
      return recusa(
        'fora_do_raio',
        `Você está a ${fmtDistancia(area.dist)} fora da área “${area.cerca.nome}” da ${casa.nome}. Bata quando estiver dentro, ou no tablet.`,
      );
    }
    return recusa(
      'fora_do_raio',
      `Você está a ${fmtDistancia(dist)} da ${casa.nome} — o ponto pelo celular só vale até ${casa.raioM} m. Bata quando chegar, ou no tablet.`,
    );
  }

  const doDia = await batidasDoDia(p.id, dia);
  // Intervalo de 5 min conta da última batida da pessoa (qualquer casa/dia).
  const [ultima] = await db
    .select({ quando: schema.pontoBatida.quando })
    .from(schema.pontoBatida)
    .where(and(eq(schema.pontoBatida.funcionarioId, p.id), isNull(schema.pontoBatida.excluidaEm)))
    .orderBy(desc(schema.pontoBatida.quando))
    .limit(1);
  if (ultima && Math.abs(agora.getTime() - ultima.quando.getTime()) < COOLDOWN_MS) {
    return recusa('intervalo', 'Você bateu o ponto há menos de 5 minutos.');
  }

  const naCasa = doDia.filter((b) => b.filialId === casa!.id);
  const ultimaNaCasa = naCasa[naCasa.length - 1];
  const tipo: 'entrada' | 'saida' = ultimaNaCasa?.tipo === 'entrada' ? 'saida' : 'entrada';

  if (tipo === 'entrada' && doDia.length === 0) {
    // Trava de dias por semana (pontoTravaSemana).
    let lim = Number(p.limiteDiasSemana) || 0;
    if (lim > 0 && String(p.limiteLiberadoDia ?? '') !== dia) {
      // Registrado ou com escala hoje fica fora (lib/rh/trava-semana, 29/10).
      try {
        const { isencoesTravaSemana } = await import('@/lib/rh/trava-semana');
        const x = await isencoesTravaSemana([p.id], dia);
        if (x.registrados.has(p.id) || x.escalaNoDia.has(p.id) || x.naoDiaristas.has(p.id)) lim = 0;
      } catch {
        /* erro aqui mantém a trava como está gravada */
      }
    }
    if (lim > 0 && String(p.limiteLiberadoDia ?? '') !== dia) {
      const segunda = segundaDa(dia);
      const dias = await db
        .selectDistinct({ dia: schema.pontoBatida.diaOperacional })
        .from(schema.pontoBatida)
        .where(
          and(
            eq(schema.pontoBatida.funcionarioId, p.id),
            gte(schema.pontoBatida.diaOperacional, segunda),
            lt(schema.pontoBatida.diaOperacional, dia),
            isNull(schema.pontoBatida.excluidaEm),
          ),
        );
      if (dias.length >= lim) {
        return recusa(
          'trava_semana',
          `${p.nome}, você já trabalhou ${dias.length} ${dias.length === 1 ? 'dia' : 'dias'} nesta semana (segunda a domingo) — o limite é ${lim}. Fale com o gerente.`,
          tipo,
        );
      }
    }
    // Trava antes da hora (pontoTravaCedo).
    const h = /^(\d{2}):(\d{2})$/.exec(String(p.pontoHoraEntrada ?? ''));
    if (h && String(p.pontoCedoLiberadoDia ?? '') !== dia) {
      const [hh, mm] = horaMinutoBr(agora).split(':').map(Number);
      if (hh >= PONTO_VIRADA_HORA) {
        const abreMin = Number(h[1]) * 60 + Number(h[2]) - TOLERANCIA_CEDO_MIN;
        if (hh * 60 + mm < abreMin) {
          const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
          return recusa(
            'antes_da_hora',
            `${p.nome}, sua entrada é às ${p.pontoHoraEntrada} — o ponto abre às ${hhmm(abreMin)}. Antes disso, só com autorização do gerente.`,
            tipo,
          );
        }
      }
    }
  }

  const [nova] = await db
    .insert(schema.pontoBatida)
    .values({
      filialId: casa.id,
      funcionarioId: p.id,
      quando: agora,
      diaOperacional: dia,
      tipo,
      origem: 'celular',
      dispositivo: 'celular',
      geoLat: lat.toFixed(7),
      geoLng: lng.toFixed(7),
      geoPrecisaoM: precisao,
      geoDistanciaM: Math.round(dist),
      faceDist,
      geoCercaId: cercaId,
    })
    .returning({ id: schema.pontoBatida.id });
  await registrar('aceita', null, tipo, nova.id);

  // Daqui pra baixo nada derruba a batida: já foi gravada.
  try {
    await projetarPontoEmFolhaHoras(casa.id, dia, dia);
  } catch (err) {
    console.error('[ponto-celular] projetar folha:', err instanceof Error ? err.message : err);
  }
  try {
    const r = await avisarLojaRosterPonto(casa.id);
    if (!r.ok) console.warn(`[ponto-celular] aviso não chegou na loja ${casa.id.slice(0, 8)}: ${r.erro}`);
  } catch (err) {
    console.warn('[ponto-celular] aviso à loja:', err instanceof Error ? err.message : err);
  }

  return {
    ok: true,
    tipo,
    casa: area.cerca ? `${casa.nome} (${area.cerca.nome})` : casa.nome,
    quando: agora.toISOString(),
    distanciaM: Math.round(dist),
  };
}
