// PREÇO POR HORÁRIO (30/10/2026): o MESMO produto muda de preço numa faixa de
// dias/hora — happy hour: isca de R$ 60 vira R$ 49 de seg a sex, 12h–20h,
// exceto feriados. Pedido do dono (em vez de um item "- Happy Hour" ao lado).
//
// Na virada, enfileira preco_venda na fila produto_alteracao (a loja aplica no
// PDV e o espelho da nuvem atualiza): dentro = preco_horario, fora =
// preco_normal. Roda no cron /api/cron/combo-horario (5 min), junto do
// horário dos combos. Só age na VIRADA: se alguém mudar o preço na mão no meio
// da faixa, o cron não fica brigando a cada 5 min.
//
// Item já lançado não muda: o preço vai fotografado no item na hora do lançamento.
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { diasAtrasBr } from './datas';
import { normalizaValor } from './produto-campos';
import { proximosFeriados } from './reservas/feriados';
import { valeAgora, type RegraCombo } from './combo-horario-regra';

export type RegraPreco = {
  codigo: number;
  ativa: boolean;
  precoNormal: number;
  precoHorario: number;
  dias: number[];
  horaInicio: string | null;
  horaFim: string | null;
  excetoFeriados: boolean;
};

export type RegraPrecoSalva = RegraPreco & {
  nome: string;
  precoAgora: number | null;
  naFila: boolean;
  estadoAplicado: 'dentro' | 'fora' | null;
  aplicadoEm: string | null;
  atualizadoPor: string | null;
};

type Linha = {
  filial_id: string;
  codigo: number;
  ativa: boolean;
  preco_normal: string;
  preco_horario: string;
  dias: string;
  hora_inicio: string | null;
  hora_fim: string | null;
  exceto_feriados: boolean;
  estado_aplicado: string | null;
  aplicado_em: string | null;
  atualizado_por: string | null;
};

const centavos = (n: number) => Math.round(n * 100);
const igual = (a: number | null, b: number) => a != null && centavos(a) === centavos(b);

function deLinha(l: Linha): RegraPreco & { estadoAplicado: 'dentro' | 'fora' | null } {
  return {
    codigo: Number(l.codigo),
    ativa: l.ativa,
    precoNormal: Number(l.preco_normal),
    precoHorario: Number(l.preco_horario),
    dias: l.dias ? l.dias.split(',').filter(Boolean).map(Number) : [],
    horaInicio: l.hora_inicio,
    horaFim: l.hora_fim,
    excetoFeriados: l.exceto_feriados,
    estadoAplicado: l.estado_aplicado === 'dentro' || l.estado_aplicado === 'fora' ? l.estado_aplicado : null,
  };
}

const SELECT = sql.raw(`
  SELECT filial_id, codigo_variante_externo AS codigo, ativa,
         preco_normal::text AS preco_normal, preco_horario::text AS preco_horario,
         array_to_string(dias_semana, ',') AS dias,
         to_char(hora_inicio, 'HH24:MI') AS hora_inicio, to_char(hora_fim, 'HH24:MI') AS hora_fim,
         exceto_feriados, estado_aplicado,
         to_char(aplicado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS aplicado_em,
         atualizado_por
    FROM preco_horario`);

/** Feriados de ontem até daqui a 2 dias (ontem: faixa que vira a meia-noite). */
async function feriadosPerto(): Promise<string[]> {
  try {
    return (await proximosFeriados(diasAtrasBr(1), 3)).map((f) => f.data);
  } catch {
    return [];
  }
}

/** A regra vale agora? Reaproveita a conta do horário dos combos. */
export function precoHorarioValeAgora(r: RegraPreco, feriados: string[], ms = Date.now()): boolean {
  if (!r.ativa) return false;
  const regra: RegraCombo = {
    ativa: true,
    dias: r.dias,
    horaInicio: r.horaInicio,
    horaFim: r.horaFim,
    dataInicio: null,
    dataFim: null,
    datasFora: r.excetoFeriados ? feriados : [],
    datasExtra: [],
  };
  return valeAgora(regra, ms);
}

/** Preço do tamanho agora: o último preco_venda pendente na fila, senão o espelho. */
async function precoAtual(filialId: string, codigo: number) {
  const [v] = await db.execute<{ produto_id: string; produto_codigo: number | null; nome: string | null; preco: string | null }>(sql`
    SELECT p.id AS produto_id, p.codigo_externo AS produto_codigo, p.nome, v.preco_venda::text AS preco
      FROM produto_variante v JOIN produto p ON p.id = v.produto_id
     WHERE v.filial_id = ${filialId} AND p.filial_id = ${filialId}
       AND v.codigo_externo = ${codigo} AND v.data_delete IS NULL
     LIMIT 1`);
  if (!v) return null;
  const [pend] = await db.execute<{ valor: string | null }>(sql`
    SELECT valor FROM produto_alteracao
     WHERE filial_id = ${filialId} AND status = 'pendente' AND campo = 'preco_venda'
       AND variante_codigo_externo = ${codigo}
     ORDER BY criado_em DESC LIMIT 1`);
  const bruto = pend ? pend.valor : v.preco;
  return { ...v, preco: bruto == null ? null : Number(bruto), naFila: !!pend };
}

async function enfileirarPreco(filialId: string, codigo: number, preco: number, por: string) {
  const atual = await precoAtual(filialId, codigo);
  if (!atual) return 'sem tamanho';
  if (igual(atual.preco, preco)) return 'já estava';
  const n = normalizaValor('preco_venda', preco);
  if (!n.ok) return n.erro;
  await db.execute(sql`
    INSERT INTO produto_alteracao (filial_id, produto_id, produto_codigo_externo, variante_codigo_externo, alvo,
                                   produto_nome, campo, valor, valor_antes, criado_por)
    VALUES (${filialId}, ${atual.produto_id}, ${atual.produto_codigo}, ${codigo}, 'variante',
            ${atual.nome}, 'preco_venda', ${n.valor}, ${atual.preco == null ? null : String(atual.preco)}, ${por})`);
  return `R$ ${preco.toFixed(2).replace('.', ',')}`;
}

export async function listarPrecosHorario(filialId: string): Promise<RegraPrecoSalva[]> {
  const linhas = await db.execute<Linha>(sql`${SELECT} WHERE filial_id = ${filialId} ORDER BY codigo_variante_externo`);
  const out: RegraPrecoSalva[] = [];
  for (const l of linhas) {
    const r = deLinha(l);
    const atual = await precoAtual(filialId, r.codigo);
    out.push({
      ...r,
      nome: atual?.nome ?? `#${r.codigo}`,
      precoAgora: atual?.preco ?? null,
      naFila: atual?.naFila ?? false,
      aplicadoEm: l.aplicado_em,
      atualizadoPor: l.atualizado_por,
    });
  }
  return out;
}

/** Grava a regra e aplica na hora (sem esperar o cron). */
export async function salvarPrecoHorario(filialId: string, r: RegraPreco, por: string | null) {
  const arr = `{${r.dias.join(',')}}`;
  await db.execute(sql`
    INSERT INTO preco_horario (filial_id, codigo_variante_externo, ativa, preco_normal, preco_horario,
                               dias_semana, hora_inicio, hora_fim, exceto_feriados, atualizado_por, atualizado_em)
    VALUES (${filialId}, ${r.codigo}, ${r.ativa}, ${r.precoNormal}, ${r.precoHorario}, ${arr}::smallint[],
            NULLIF(${r.horaInicio ?? ''}, '')::time, NULLIF(${r.horaFim ?? ''}, '')::time,
            ${r.excetoFeriados}, ${por}, now())
    ON CONFLICT (filial_id, codigo_variante_externo) DO UPDATE SET
      ativa = EXCLUDED.ativa, preco_normal = EXCLUDED.preco_normal, preco_horario = EXCLUDED.preco_horario,
      dias_semana = EXCLUDED.dias_semana, hora_inicio = EXCLUDED.hora_inicio, hora_fim = EXCLUDED.hora_fim,
      exceto_feriados = EXCLUDED.exceto_feriados,
      atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()`);
  return aplicarPrecosHorario({ filialId, codigo: r.codigo, forcar: true });
}

/** Apaga a regra; se o preço do horário estava valendo, devolve o normal. */
export async function excluirPrecoHorario(filialId: string, codigo: number) {
  const [l] = await db.execute<Linha>(sql`${SELECT} WHERE filial_id = ${filialId} AND codigo_variante_externo = ${codigo}`);
  if (!l) return false;
  const r = deLinha(l);
  const atual = await precoAtual(filialId, codigo);
  if (atual && igual(atual.preco, r.precoHorario) && !igual(atual.preco, r.precoNormal)) {
    await enfileirarPreco(filialId, codigo, r.precoNormal, 'preço por horário (regra apagada)');
  }
  await db.execute(sql`DELETE FROM preco_horario WHERE filial_id = ${filialId} AND codigo_variante_externo = ${codigo}`);
  return true;
}

/**
 * Passa pelas regras e aplica a VIRADA. `forcar` (ao salvar) reaplica mesmo
 * sem virada — quem salvou quer ver o efeito já.
 */
export async function aplicarPrecosHorario(opts: { filialId?: string; codigo?: number; forcar?: boolean } = {}) {
  const filtro = opts.filialId
    ? opts.codigo != null
      ? sql` WHERE filial_id = ${opts.filialId} AND codigo_variante_externo = ${opts.codigo}`
      : sql` WHERE filial_id = ${opts.filialId}`
    : sql``;
  const linhas = await db.execute<Linha>(sql`${SELECT}${filtro}`);
  if (linhas.length === 0) return [];
  const feriados = await feriadosPerto();

  const feitos: Array<{ filialId: string; codigo: number; estado: string; acao: string }> = [];
  for (const l of linhas) {
    const r = deLinha(l);
    const filialId = l.filial_id;
    const marcar = (estado: string | null) => db.execute(sql`
      UPDATE preco_horario SET estado_aplicado = ${estado}, aplicado_em = now()
       WHERE filial_id = ${filialId} AND codigo_variante_externo = ${r.codigo}`);

    // Regra desligada: se o preço do horário estava valendo, devolve o normal e larga.
    if (!r.ativa) {
      if (r.estadoAplicado === 'dentro' || opts.forcar) {
        const atual = await precoAtual(filialId, r.codigo);
        let acao = 'nada';
        if (atual && igual(atual.preco, r.precoHorario) && !igual(atual.preco, r.precoNormal)) {
          acao = await enfileirarPreco(filialId, r.codigo, r.precoNormal, 'preço por horário (regra desligada)');
        }
        if (r.estadoAplicado !== null) await marcar(null);
        feitos.push({ filialId, codigo: r.codigo, estado: 'desligada', acao });
      }
      continue;
    }

    const estado = precoHorarioValeAgora(r, feriados) ? 'dentro' : 'fora';
    if (estado === r.estadoAplicado && !opts.forcar) continue;
    const atual = await precoAtual(filialId, r.codigo);
    let acao = 'sem tamanho';
    if (atual) {
      if (estado === 'dentro') {
        // Entrando na faixa com um preço cheio diferente do guardado (alguém
        // reajustou o cardápio): guarda o novo cheio pra devolver no fim.
        if (r.estadoAplicado !== 'dentro' && atual.preco != null
            && !igual(atual.preco, r.precoHorario) && !igual(atual.preco, r.precoNormal) && !opts.forcar) {
          await db.execute(sql`UPDATE preco_horario SET preco_normal = ${atual.preco}
                                WHERE filial_id = ${filialId} AND codigo_variante_externo = ${r.codigo}`);
        }
        acao = await enfileirarPreco(filialId, r.codigo, r.precoHorario, 'preço por horário (dentro)');
      } else if (igual(atual.preco, r.precoNormal)) {
        acao = 'já estava';
      } else if (igual(atual.preco, r.precoHorario) || opts.forcar) {
        acao = await enfileirarPreco(filialId, r.codigo, r.precoNormal, 'preço por horário (fora)');
      } else {
        acao = 'preço mudado na mão — não mexi';
      }
    }
    await marcar(estado);
    feitos.push({ filialId, codigo: r.codigo, estado, acao });
  }
  return feitos;
}
