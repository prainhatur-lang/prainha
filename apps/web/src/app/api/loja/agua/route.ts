// ÁGUA DO PRAINHA → NUVEM. O banco da água mora no servidor da loja (Concilia
// Loja): a placa grava lá, a loja avalia os alarmes e funciona sem internet.
// A cada minuto ela manda pra cá as leituras novas e a situação atual (bombas,
// limites, alarmes abertos) — a nuvem é só a cópia, pra ver de fora da loja.
//
// Idempotente: leitura entra por id_local (o id dela na loja); bombas e limites
// são regravados; alarmes são espelhados (abre o que veio, fecha o que saiu).
// O "Estou ciente" dado na loja vem junto; o dado aqui na nuvem não volta.
// Auth: a MESMA assinatura HMAC das outras rotas /api/loja (PAGAR_MESA_SECRET).
// Placa dos filtros (28/11/2026): ela só responde na rede da loja e a API dela
// não tem senha, então a nuvem NUNCA fala com a placa. A loja manda junto o que
// a placa respondeu, o histórico das retrolavagens e o resultado dos pedidos; e
// leva na resposta os pedidos feitos aqui no online (fila em agua_comandos),
// que ela mesma executa. Pedido que a loja não busca em 10 minutos expira.
// Assina [f, 'agua', e]. Só o PRAINHA BAR envia (dono 20/11/2026: esse quadro é
// só do Bar; as outras casas são diferentes e ainda não têm). AGUA_FILIAL_ID troca a casa.
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
  return /^[0-9a-f-]{36}$/i.test(f) && e * 1000 >= Date.now() && confere([f, 'agua', String(e)], s);
}

const N = z.coerce.number().nullable().optional();
const B = z.boolean().nullable().optional();
const Leitura = z.object({
  id: z.coerce.number().int().positive(),
  criado_em: z.string().min(10),
  nivel_terrea: N,
  nivel_intermediaria: N,
  nivel_superior: N,
  pressao_1: N,
  pressao_2: N,
  pressao_3: N,
  corrente_1: N,
  corrente_2: N,
  corrente_3: N,
  corrente_4: N,
  v1_aberta: B,
  v2_aberta: B,
});
const Bomba = z.object({
  id: z.coerce.number().int().min(1).max(4),
  nome: z.string().min(1).max(80),
  fases: z.string().max(20).nullable().optional(),
  corrente_nominal: N,
  limite_corrente_baixa: N,
  tuya_device_id: z.string().max(80).nullable().optional(),
  liberada: z.boolean(),
  modo: z.enum(['auto', 'manual', 'off']),
  falha: z.enum(['poco_seco', 'tubo_fechado', 'sobrecarga']).nullable().optional(),
  tentativas: z.coerce.number().int().min(0).max(999),
  proxima_tentativa: z.string().nullable().optional(),
});
const Config = z.object({
  chave: z.string().min(1).max(60),
  valor: z.coerce.number(),
  descricao: z.string().max(300).nullable().optional(),
});
const Alarme = z.object({
  codigo: z.string().min(1).max(60),
  gravidade: z.enum(['critico', 'aviso']),
  titulo: z.string().min(1).max(200),
  detalhe: z.string().max(1000).nullable().optional(),
  bomba_id: z.coerce.number().int().nullable().optional(),
  aberto_em: z.string().nullable().optional(),
  visto_em: z.string().nullable().optional(),
});
const Placa = z.object({
  // o JSON do /api/estado da placa, já conferido pela loja
  estado: z
    .object({
      reles: z.array(z.coerce.number().int().min(0).max(1)).length(6),
      nomes: z.array(z.string().max(40)).max(6).default([]),
      rssi: z.coerce.number().nullable().optional(),
      ip: z.string().max(40).optional(),
      hora: z.string().max(20).optional(),
      chip: z.boolean().nullable().optional(),
      ultima: z.string().max(120).optional(),
      agenda: z.string().max(60).optional(),
      ciclo: z.object({
        ativo: z.boolean(),
        teste: z.boolean(),
        passo: z.coerce.number().int(),
        total: z.coerce.number().int(),
        nome: z.string().max(80),
        resta: z.coerce.number().int(),
      }),
    })
    .nullable(),
  lido_em: z.string().nullable().optional(),
  erro: z.string().max(300).nullable().optional(),
});
const Retrolavagem = z.object({
  id: z.coerce.number().int().positive(),
  iniciado_em: z.string().min(10),
  terminado_em: z.string().nullable().optional(),
  resultado: z.string().max(300).nullable().optional(),
  teste: z.boolean().default(false),
  origem: z.string().max(20).nullable().optional(),
  solicitado_por: z.string().max(80).nullable().optional(),
});
const ComandoFeito = z.object({
  id_nuvem: z.coerce.number().int().positive(),
  executado_em: z.string().min(10),
  resultado: z.string().max(300).nullable().optional(),
  ok: z.boolean(),
});
const Body = z.object({
  f: z.string(),
  e: z.coerce.number(),
  s: z.string(),
  leituras: z.array(Leitura).max(500).default([]),
  bombas: z.array(Bomba).max(10).default([]),
  config: z.array(Config).max(60).default([]),
  alarmes: z.array(Alarme).max(60).default([]),
  placa: Placa.optional(),
  retrolavagens: z.array(Retrolavagem).max(50).default([]),
  comandos_feitos: z.array(ComandoFeito).max(60).default([]),
});

/** Pedidos do online que a loja executa na placa. Relé avulso e teste não passam. */
const TIPOS_DA_PLACA = ['retrolavar', 'retro_parar', 'filtrar'];
/** Pedido que a loja não buscou nesse tempo não é mais executado. */
const PEDIDO_EXPIRA_MIN = 10;

const str = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? null : String(n));
const data = (s: string | null | undefined) => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};
/** 01 Prainha Bar — a casa que tem o quadro da água. */
const FILIAL_PRAINHA_BAR = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';
/** Chaves que são da nuvem e a loja não regrava. */
const CHAVE_DA_NUVEM = new Set(['ultima_sincronizacao']);
/** Alarme que só a nuvem abre/fecha (cópia desatualizada). */
const ALARME_DA_NUVEM = 'loja_sem_nuvem';

/** POST {f,e,s,leituras,bombas,config,alarmes} — grava a cópia. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, erro: 'corpo inválido' }, { status: 400 });
  const { f, e, s, leituras, bombas, config, alarmes, placa, retrolavagens, comandos_feitos } = parsed.data;
  if (!autoriza(f, e, s)) return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });
  const soEssa = process.env.AGUA_FILIAL_ID || FILIAL_PRAINHA_BAR;
  if (soEssa.toLowerCase() !== f.toLowerCase()) {
    return NextResponse.json({ ok: false, erro: 'o quadro da água é de outra casa' }, { status: 403 });
  }

  const { db, schema } = await import('@concilia/db');
  const { sql } = await import('drizzle-orm');

  try {
    for (const b of bombas) {
      const campos = {
        nome: b.nome,
        fases: b.fases ?? null,
        correnteNominal: str(b.corrente_nominal),
        limiteCorrenteBaixa: str(b.limite_corrente_baixa),
        tuyaDeviceId: b.tuya_device_id ?? null,
        liberada: b.liberada,
        modo: b.modo,
        falha: b.falha ?? null,
        tentativas: b.tentativas,
        proximaTentativa: data(b.proxima_tentativa),
        atualizadoEm: new Date(),
      };
      await db
        .insert(schema.aguaBombas)
        .values({ id: b.id, ...campos })
        .onConflictDoUpdate({ target: schema.aguaBombas.id, set: campos });
    }

    for (const c of config) {
      if (CHAVE_DA_NUVEM.has(c.chave) || !Number.isFinite(c.valor)) continue;
      await db
        .insert(schema.aguaConfig)
        .values({ chave: c.chave, valor: String(c.valor), descricao: c.descricao ?? null })
        .onConflictDoUpdate({
          target: schema.aguaConfig.chave,
          set: { valor: String(c.valor), descricao: c.descricao ?? null },
        });
    }

    const linhas = leituras
      .map((l) => ({ l, quando: data(l.criado_em) }))
      .filter((x): x is { l: (typeof leituras)[number]; quando: Date } => x.quando !== null)
      .map(({ l, quando }) => ({
        idLocal: l.id,
        criadoEm: quando,
        nivelTerrea: str(l.nivel_terrea),
        nivelIntermediaria: str(l.nivel_intermediaria),
        nivelSuperior: str(l.nivel_superior),
        pressao1: str(l.pressao_1),
        pressao2: str(l.pressao_2),
        pressao3: str(l.pressao_3),
        corrente1: str(l.corrente_1),
        corrente2: str(l.corrente_2),
        corrente3: str(l.corrente_3),
        corrente4: str(l.corrente_4),
        v1Aberta: l.v1_aberta ?? null,
        v2Aberta: l.v2_aberta ?? null,
      }));
    if (linhas.length) {
      await db.insert(schema.aguaLeituras).values(linhas).onConflictDoNothing({ target: schema.aguaLeituras.idLocal });
    }

    // Alarmes: espelho do que está aberto na loja.
    const vindos = alarmes.filter((a) => a.codigo !== ALARME_DA_NUVEM);
    const chave = (codigo: string, bomba: number | null | undefined) => `${codigo}|${bomba || 0}`;
    const abertosNaLoja = new Set(vindos.map((a) => chave(a.codigo, a.bomba_id)));
    for (const a of vindos) {
      const bomba = a.bomba_id && a.bomba_id >= 1 && a.bomba_id <= 4 ? a.bomba_id : null;
      await db.execute(
        sql`select agua_abrir_alarme(${a.codigo}, ${a.gravidade}, ${a.titulo}, ${a.detalhe ?? null}, ${bomba}::smallint)`,
      );
      const visto = data(a.visto_em);
      if (visto) {
        await db.execute(sql`
          update agua_alarmes set visto_em = ${visto.toISOString()}::timestamptz
          where codigo = ${a.codigo} and coalesce(bomba_id, 0) = ${bomba ?? 0}
            and resolvido_em is null
            and (visto_em is null or visto_em < ${visto.toISOString()}::timestamptz)`);
      }
    }
    const abertosAqui = await db
      .select({ codigo: schema.aguaAlarmes.codigo, bombaId: schema.aguaAlarmes.bombaId })
      .from(schema.aguaAlarmes)
      .where(sql`${schema.aguaAlarmes.resolvidoEm} is null`);
    for (const a of abertosAqui) {
      if (a.codigo === ALARME_DA_NUVEM || abertosNaLoja.has(chave(a.codigo, a.bombaId))) continue;
      await db.execute(sql`select agua_fechar_alarme(${a.codigo}, ${a.bombaId}::smallint)`);
    }

    // A loja falou agora: marca a hora e fecha o aviso de cópia desatualizada.
    const agora = String(Math.floor(Date.now() / 1000));
    await db
      .insert(schema.aguaConfig)
      .values({ chave: 'ultima_sincronizacao', valor: agora, descricao: 'Último envio do servidor da loja (epoch, em segundos)' })
      .onConflictDoUpdate({ target: schema.aguaConfig.chave, set: { valor: agora } });
    await db.execute(sql`select agua_fechar_alarme(${ALARME_DA_NUVEM}, null::smallint)`);

    // Placa dos filtros. Bloco à parte: se a migration da placa ainda não rodou,
    // a cópia das leituras e dos alarmes acima segue valendo.
    let comandos: { id: number; tipo: string; por: string }[] = [];
    try {
      if (placa) {
        const campos = {
          estado: placa.estado,
          lidoEm: data(placa.lido_em),
          erro: placa.erro ?? null,
          atualizadoEm: new Date(),
        };
        await db
          .insert(schema.aguaPlaca)
          .values({ id: 1, ...campos })
          .onConflictDoUpdate({ target: schema.aguaPlaca.id, set: campos });
      }
      for (const r of retrolavagens) {
        const inicio = data(r.iniciado_em);
        if (!inicio) continue;
        const campos = {
          iniciadoEm: inicio,
          terminadoEm: data(r.terminado_em),
          resultado: r.resultado ?? null,
          teste: r.teste,
          origem: r.origem ?? null,
          pedidoPor: r.solicitado_por ?? null,
        };
        await db
          .insert(schema.aguaRetrolavagens)
          .values({ idLocal: r.id, ...campos })
          .onConflictDoUpdate({ target: schema.aguaRetrolavagens.idLocal, set: campos });
      }
      for (const c of comandos_feitos) {
        await db
          .update(schema.aguaComandos)
          .set({ executadoEm: data(c.executado_em) ?? new Date(), resultado: c.resultado ?? null, ok: c.ok })
          .where(sql`${schema.aguaComandos.id} = ${c.id_nuvem}`);
      }
      // quem não foi buscado a tempo não sai mais: retrolavagem atrasada, na
      // hora errada, é pior que não fazer
      await db.execute(sql`
        update agua_comandos
        set executado_em = now(), ok = false,
            resultado = case when entregue_em is null
              then 'expirou: a loja não buscou o pedido a tempo'
              else 'a loja buscou o pedido e não informou o resultado' end
        where executado_em is null
          and coalesce(entregue_em, criado_em) < now() - make_interval(mins => ${PEDIDO_EXPIRA_MIN})`);
      // entrega UMA vez: marca na mesma instrução que lê
      const entregues = (await db.execute(sql`
        update agua_comandos set entregue_em = now()
        where id in (
          select id from agua_comandos
          where executado_em is null and entregue_em is null
            and tipo in ('retrolavar', 'retro_parar', 'filtrar')
          order by id limit 5
        )
        returning id, tipo, solicitado_nome`)) as unknown as { id: number | string; tipo: string; solicitado_nome: string | null }[];
      comandos = [...entregues]
        .filter((c) => TIPOS_DA_PLACA.includes(c.tipo))
        .map((c) => ({ id: Number(c.id), tipo: c.tipo, por: c.solicitado_nome || 'Concilia online' }))
        .sort((a, b) => a.id - b.id);
    } catch (err) {
      console.error('[agua] placa dos filtros: cópia falhou', err instanceof Error ? err.message : err);
    }

    return NextResponse.json({ ok: true, leituras: linhas.length, comandos });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[agua] cópia da loja falhou', msg);
    return NextResponse.json({ ok: false, erro: 'falha ao gravar' }, { status: 500 });
  }
}
