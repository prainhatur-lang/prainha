// HORÁRIO DO COMBO: quando o combo vale (combo_regra).
//
// É o que separa o combo do prato com perguntas: o combo tem dia e hora —
// "almoço executivo de segunda a sexta, das 11h às 15h" — e um calendário
// (vigência de/até, dia fora como feriado, dia extra).
//
// Fora da regra o tamanho do combo é PAUSADO pela fila produto_alteracao, o
// mesmo caminho do botão pausar: a loja confirma a fila, o combo some do
// cardápio da loja e, com ele, do garçom, do caixa e da LIO (todos leem o
// catálogo do servidor da loja) — sem release de loja nem de maquininha.
//
// O cron /api/cron/combo-horario só age na VIRADA (estado_aplicado muda de
// 'dentro' pra 'fora' ou volta): se alguém pausar o combo na mão no meio da
// janela (acabou o prato), o cron não despausa a cada 5 min.
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

import { diaVale, valeAgora, type RegraCombo, type RegraComboSalva } from './combo-horario-regra';
export * from './combo-horario-regra';

type LinhaRegra = {
  codigo: number;
  ativa: boolean;
  dias: string;
  hora_inicio: string | null;
  hora_fim: string | null;
  data_inicio: string | null;
  data_fim: string | null;
  datas_fora: string;
  datas_extra: string;
  estado_aplicado: string | null;
  aplicado_em: string | null;
  atualizado_por: string | null;
};

const lista = (s: string | null) => (s ? s.split(',').filter(Boolean) : []);

function deLinha(l: LinhaRegra): RegraComboSalva {
  return {
    ativa: l.ativa,
    dias: lista(l.dias).map(Number),
    horaInicio: l.hora_inicio,
    horaFim: l.hora_fim,
    dataInicio: l.data_inicio,
    dataFim: l.data_fim,
    datasFora: lista(l.datas_fora),
    datasExtra: lista(l.datas_extra),
    estadoAplicado: l.estado_aplicado === 'dentro' || l.estado_aplicado === 'fora' ? l.estado_aplicado : null,
    aplicadoEm: l.aplicado_em,
    atualizadoPor: l.atualizado_por,
  };
}

const SELECT_REGRA = sql.raw(`
  SELECT codigo_variante_externo AS codigo, ativa,
         array_to_string(dias_semana, ',') AS dias,
         to_char(hora_inicio, 'HH24:MI') AS hora_inicio,
         to_char(hora_fim, 'HH24:MI') AS hora_fim,
         data_inicio::text AS data_inicio, data_fim::text AS data_fim,
         array_to_string(datas_fora, ',') AS datas_fora,
         array_to_string(datas_extra, ',') AS datas_extra,
         estado_aplicado,
         to_char(aplicado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS aplicado_em,
         atualizado_por
    FROM combo_regra`);

export async function carregarRegras(filialId: string): Promise<Map<number, RegraComboSalva>> {
  const linhas = await db.execute<LinhaRegra>(sql`${SELECT_REGRA} WHERE filial_id = ${filialId}`);
  return new Map([...linhas].map((l) => [Number(l.codigo), deLinha(l)]));
}

export async function carregarRegra(filialId: string, codigo: number): Promise<RegraComboSalva | null> {
  const [l] = await db.execute<LinhaRegra>(
    sql`${SELECT_REGRA} WHERE filial_id = ${filialId} AND codigo_variante_externo = ${codigo}`,
  );
  return l ? deLinha(l) : null;
}

const arr = (xs: Array<string | number>) => `{${xs.join(',')}}`;

/** Grava a regra e aplica na hora (pausa ou despausa já, sem esperar o cron). */
export async function salvarRegra(filialId: string, codigo: number, r: RegraCombo, por: string | null) {
  const antes = await carregarRegra(filialId, codigo);
  await db.execute(sql`
    INSERT INTO combo_regra (filial_id, codigo_variante_externo, ativa, dias_semana, hora_inicio, hora_fim,
                             data_inicio, data_fim, datas_fora, datas_extra, estado_aplicado, atualizado_por, atualizado_em)
    VALUES (${filialId}, ${codigo}, ${r.ativa}, ${arr(r.dias)}::smallint[],
            NULLIF(${r.horaInicio ?? ''}, '')::time, NULLIF(${r.horaFim ?? ''}, '')::time,
            NULLIF(${r.dataInicio ?? ''}, '')::date, NULLIF(${r.dataFim ?? ''}, '')::date,
            ${arr(r.datasFora)}::date[], ${arr(r.datasExtra)}::date[], ${antes?.estadoAplicado ?? null}, ${por}, now())
    ON CONFLICT (filial_id, codigo_variante_externo) DO UPDATE SET
      ativa = EXCLUDED.ativa, dias_semana = EXCLUDED.dias_semana,
      hora_inicio = EXCLUDED.hora_inicio, hora_fim = EXCLUDED.hora_fim,
      data_inicio = EXCLUDED.data_inicio, data_fim = EXCLUDED.data_fim,
      datas_fora = EXCLUDED.datas_fora, datas_extra = EXCLUDED.datas_extra,
      atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()`);
  return aplicarHorarios({ filialId, codigo, forcar: true });
}

/** Enfileira pausado=1/0 no tamanho do combo (mesmo modelo de /api/loja/produto-pausa). */
async function enfileirarPausa(filialId: string, codigo: number, pausar: boolean, por: string) {
  const [v] = await db.execute<{ produto_id: string; produto_codigo: number | null; nome: string | null; pausado: boolean }>(sql`
    SELECT p.id AS produto_id, p.codigo_externo AS produto_codigo, p.nome, (v.data_pausado IS NOT NULL) AS pausado
      FROM produto_variante v JOIN produto p ON p.id = v.produto_id
     WHERE v.filial_id = ${filialId} AND p.filial_id = ${filialId}
       AND v.codigo_externo = ${codigo} AND v.data_delete IS NULL
     LIMIT 1`);
  if (!v) return 'sem tamanho';
  const valor = pausar ? '1' : '0';
  const [pendente] = await db.execute<{ valor: string }>(sql`
    SELECT valor FROM produto_alteracao
     WHERE filial_id = ${filialId} AND status = 'pendente' AND campo = 'pausado'
       AND variante_codigo_externo = ${codigo}
     ORDER BY criado_em DESC LIMIT 1`);
  if (pendente) {
    if (pendente.valor === valor) return 'já na fila';
  } else if (v.pausado === pausar) {
    return 'já estava';
  }
  await db.execute(sql`
    INSERT INTO produto_alteracao (filial_id, produto_id, produto_codigo_externo, variante_codigo_externo, alvo,
                                   produto_nome, campo, valor, valor_antes, criado_por)
    VALUES (${filialId}, ${v.produto_id}, ${v.produto_codigo}, ${codigo}, 'variante',
            ${v.nome}, 'pausado', ${valor}, ${v.pausado ? '1' : '0'}, ${por})`);
  return pausar ? 'pausado' : 'voltou';
}

/**
 * Passa pelas regras e aplica a VIRADA. `forcar` (ao salvar) reaplica mesmo
 * sem virada — quem salvou quer ver o efeito já.
 */
export async function aplicarHorarios(opts: { filialId?: string; codigo?: number; forcar?: boolean } = {}) {
  const filtro = opts.filialId
    ? opts.codigo != null
      ? sql` WHERE filial_id = ${opts.filialId} AND codigo_variante_externo = ${opts.codigo}`
      : sql` WHERE filial_id = ${opts.filialId}`
    : sql``;
  const regras = await db.execute<LinhaRegra & { filial_id: string }>(sql`
    SELECT filial_id, codigo_variante_externo AS codigo, ativa,
           array_to_string(dias_semana, ',') AS dias,
           to_char(hora_inicio, 'HH24:MI') AS hora_inicio, to_char(hora_fim, 'HH24:MI') AS hora_fim,
           data_inicio::text AS data_inicio, data_fim::text AS data_fim,
           array_to_string(datas_fora, ',') AS datas_fora, array_to_string(datas_extra, ',') AS datas_extra,
           estado_aplicado, NULL::text AS aplicado_em, atualizado_por
      FROM combo_regra${filtro}`);

  const feitos: Array<{ filialId: string; codigo: number; estado: string; acao: string }> = [];
  for (const l of regras) {
    const r = deLinha(l);
    const codigo = Number(l.codigo);
    // Regra desligada: se fomos nós que pausamos, devolve o combo e larga.
    if (!r.ativa) {
      if (r.estadoAplicado === 'fora') {
        const acao = await enfileirarPausa(l.filial_id, codigo, false, 'horário do combo (regra desligada)');
        await db.execute(sql`UPDATE combo_regra SET estado_aplicado = NULL, aplicado_em = now()
                              WHERE filial_id = ${l.filial_id} AND codigo_variante_externo = ${codigo}`);
        feitos.push({ filialId: l.filial_id, codigo, estado: 'sem regra', acao });
      }
      continue;
    }
    const estado = valeAgora(r) ? 'dentro' : 'fora';
    if (estado === r.estadoAplicado && !opts.forcar) continue;
    const acao = await enfileirarPausa(
      l.filial_id, codigo, estado === 'fora',
      estado === 'fora' ? 'horário do combo (fora)' : 'horário do combo (dentro)',
    );
    await db.execute(sql`UPDATE combo_regra SET estado_aplicado = ${estado}, aplicado_em = now()
                          WHERE filial_id = ${l.filial_id} AND codigo_variante_externo = ${codigo}`);
    feitos.push({ filialId: l.filial_id, codigo, estado, acao });
  }
  return feitos;
}
