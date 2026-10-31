// Pendências da escala (pedido do dono 31/10/2026): "toda vez que tiver uma
// demissão ou uma admissão a gente tem que gerar uma nova escala — quem vai
// cobrir o horário? Tem alguém? Vai faltar? Se adicionou uma pessoa, por quê?
// Qual é o horário?".
//
// A grade de /rh/escala-mensal só mostra quem está ativo, então quem saiu some
// dela e os dias em que estava escalado viram um furo invisível. Aqui:
//   furos     dia ≥ hoje, depois do desligamento, em que a pessoa que saiu
//             ainda está marcada pra trabalhar (rh_escala_dia.folga = false),
//             com quem pode cobrir: mesma função, na casa naquele dia e sem
//             trabalho marcado (de folga ou sem escala). Sem ninguém = vai faltar.
//   entradas  admitido nos últimos 30 dias (ou com admissão marcada pra frente)
//             sem motivo da admissão, sem horário de entrada ou sem escala.
//   saidas    quem saiu nos últimos 30 dias (e trabalhava de fato: tinha ponto
//             ou escala) e quem entrou na mesma função desde então — só informa.

import { db } from '@concilia/db';
import { sql, type SQL } from 'drizzle-orm';
import { somarDias } from '@/lib/rh/dia-operacional';

export interface CandidatoCobertura {
  funcionarioId: string;
  nome: string;
  /** 'folga' = está de folga marcada no dia; 'sem_escala' = sem nada salvo no dia */
  situacao: 'folga' | 'sem_escala';
  intermitente: boolean;
  /** dias de trabalho já marcados na semana (seg–dom) do furo */
  diasNaSemana: number;
}

export interface FuroEscala {
  funcionarioId: string;
  nome: string;
  cargo: string | null;
  desligamento: string | null;
  dia: string;
  candidatos: CandidatoCobertura[];
}

export interface EntradaPendente {
  funcionarioId: string;
  nome: string;
  cargo: string | null;
  admissao: string;
  motivo: string | null;
  horaEntrada: string | null;
  intermitente: boolean;
  /** primeiro mês (YYYY-MM) a partir de hoje sem nenhum dia salvo; null = tem escala */
  mesSemEscala: string | null;
}

export interface SaidaRecente {
  funcionarioId: string;
  nome: string;
  cargo: string | null;
  desligamento: string;
  /** quem entrou na mesma função a partir de 30 dias antes da saída */
  entraram: Array<{ nome: string; admissao: string }>;
}

export interface PendenciasEscala {
  furos: FuroEscala[];
  entradas: EntradaPendente[];
  saidas: SaidaRecente[];
}

/** Quantas pendências pedem ação (furos + entradas sem motivo/horário/escala). */
export function totalPendencias(p: PendenciasEscala | null | undefined): number {
  return p ? p.furos.length + p.entradas.length : 0;
}

/** Segunda-feira da semana do dia (YYYY-MM-DD). */
function segundaDa(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  const dow = d.getUTCDay(); // 0 = dom
  return somarDias(dia, dow === 0 ? -6 : 1 - dow);
}

async function q<T>(query: SQL): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[];
}

export async function pendenciasEscala(filialId: string, hoje: string): Promise<PendenciasEscala> {
  const desde30 = somarDias(hoje, -30);
  const ate14 = somarDias(hoje, 14);

  const [furosRows, entradasRows, saidasRows] = await Promise.all([
    q<{ funcionario_id: string; nome: string; cargo: string | null; dd: string | null; dia: string }>(sql`
      SELECT f.id::text AS funcionario_id, f.nome, f.cargo, f.data_desligamento::text AS dd, e.dia::text AS dia
        FROM funcionario f
        JOIN rh_escala_dia e ON e.funcionario_id = f.id AND e.filial_id = ${filialId}
       WHERE f.filial_id = ${filialId}
         AND (f.data_desligamento IS NOT NULL OR NOT f.ativo)
         AND NOT e.folga
         AND e.dia >= ${hoje}::date
         AND (f.data_desligamento IS NULL OR e.dia > f.data_desligamento)
       ORDER BY e.dia, f.nome
    `),
    q<{
      funcionario_id: string; nome: string; cargo: string | null; da: string; motivo: string | null;
      hora: string | null; regime: string | null; tem_escala: boolean;
    }>(sql`
      SELECT f.id::text AS funcionario_id, f.nome, f.cargo, f.data_admissao::text AS da,
             f.motivo_admissao AS motivo, f.ponto_hora_entrada AS hora, f.regime_salarial AS regime,
             EXISTS (
               SELECT 1 FROM rh_escala_dia e
                WHERE e.funcionario_id = f.id
                  AND e.dia >= GREATEST(${hoje}::date, f.data_admissao)
                  AND e.dia <= GREATEST(${ate14}::date, f.data_admissao + 14)
             ) AS tem_escala
        FROM funcionario f
       WHERE f.filial_id = ${filialId}
         AND f.ativo
         AND f.data_desligamento IS NULL
         AND f.data_admissao >= ${desde30}::date
       ORDER BY f.data_admissao, f.nome
    `),
    q<{ funcionario_id: string; nome: string; cargo: string | null; dd: string }>(sql`
      SELECT f.id::text AS funcionario_id, f.nome, f.cargo, f.data_desligamento::text AS dd
        FROM funcionario f
       WHERE f.filial_id = ${filialId}
         AND f.data_desligamento >= ${desde30}::date
         AND f.data_desligamento <= ${somarDias(hoje, 30)}::date
         AND (
           EXISTS (SELECT 1 FROM ponto_batida b
                    WHERE b.funcionario_id = f.id AND b.excluida_em IS NULL
                      AND b.dia_operacional >= f.data_desligamento - 30)
           OR EXISTS (SELECT 1 FROM rh_escala_dia e
                       WHERE e.funcionario_id = f.id AND e.dia >= f.data_desligamento - 30)
         )
       ORDER BY f.data_desligamento DESC, f.nome
    `),
  ]);

  // --- Furos: quem pode cobrir cada dia -----------------------------------
  const furos: FuroEscala[] = [];
  if (furosRows.length) {
    const inicio = segundaDa(furosRows[0].dia);
    const fim = somarDias(segundaDa(furosRows[furosRows.length - 1].dia), 6);
    const [ativos, linhas] = await Promise.all([
      q<{ id: string; nome: string; cargo: string | null; da: string | null; dd: string | null; regime: string | null }>(sql`
        SELECT f.id::text AS id, f.nome, f.cargo, f.data_admissao::text AS da,
               f.data_desligamento::text AS dd, f.regime_salarial AS regime
          FROM funcionario f
         WHERE f.filial_id = ${filialId} AND f.ativo
      `),
      q<{ fid: string; dia: string; folga: boolean }>(sql`
        SELECT e.funcionario_id::text AS fid, e.dia::text AS dia, e.folga
          FROM rh_escala_dia e
         WHERE e.filial_id = ${filialId}
           AND e.dia >= ${inicio}::date AND e.dia <= ${fim}::date
      `),
    ]);
    const marca = new Map<string, boolean>(); // fid|dia → folga
    for (const l of linhas) marca.set(`${l.fid}|${l.dia}`, l.folga);
    const trabalhoNaSemana = (fid: string, dia: string): number => {
      const seg = segundaDa(dia);
      let n = 0;
      for (let i = 0; i < 7; i++) if (marca.get(`${fid}|${somarDias(seg, i)}`) === false) n++;
      return n;
    };
    for (const r of furosRows) {
      const candidatos: CandidatoCobertura[] = [];
      for (const a of ativos) {
        if (a.id === r.funcionario_id) continue;
        if (r.cargo && a.cargo !== r.cargo) continue;
        if (a.da && a.da > r.dia) continue;
        if (a.dd && a.dd < r.dia) continue;
        const folga = marca.get(`${a.id}|${r.dia}`);
        if (folga === false) continue; // já trabalha no dia
        candidatos.push({
          funcionarioId: a.id,
          nome: a.nome,
          situacao: folga === true ? 'folga' : 'sem_escala',
          intermitente: a.regime === 'intermitente_hora',
          diasNaSemana: trabalhoNaSemana(a.id, r.dia),
        });
      }
      // Quem trabalha menos na semana primeiro (6x1: com 6 dias já não dá).
      candidatos.sort((x, y) => x.diasNaSemana - y.diasNaSemana || x.nome.localeCompare(y.nome, 'pt-BR'));
      furos.push({
        funcionarioId: r.funcionario_id,
        nome: r.nome,
        cargo: r.cargo,
        desligamento: r.dd,
        dia: r.dia,
        candidatos: candidatos.filter((c) => c.diasNaSemana < 6),
      });
    }
  }

  // --- Entradas sem motivo / horário / escala ------------------------------
  const entradas: EntradaPendente[] = [];
  for (const r of entradasRows) {
    const mesSemEscala = r.tem_escala ? null : (r.da > hoje ? r.da : hoje).slice(0, 7);
    if (r.motivo?.trim() && r.hora && !mesSemEscala) continue;
    entradas.push({
      funcionarioId: r.funcionario_id,
      nome: r.nome,
      cargo: r.cargo,
      admissao: r.da,
      motivo: r.motivo?.trim() || null,
      horaEntrada: r.hora,
      intermitente: r.regime === 'intermitente_hora',
      mesSemEscala,
    });
  }

  // --- Saídas recentes e quem entrou no lugar ------------------------------
  const todasEntradas = saidasRows.length
    ? await q<{ nome: string; cargo: string | null; da: string }>(sql`
        SELECT f.nome, f.cargo, f.data_admissao::text AS da
          FROM funcionario f
         WHERE f.filial_id = ${filialId} AND f.ativo
           AND f.data_admissao >= ${somarDias(desde30, -30)}::date
      `)
    : [];
  const saidas: SaidaRecente[] = saidasRows.map((s) => ({
    funcionarioId: s.funcionario_id,
    nome: s.nome,
    cargo: s.cargo,
    desligamento: s.dd,
    entraram: todasEntradas
      .filter((e) => s.cargo && e.cargo === s.cargo && e.da >= somarDias(s.dd, -30))
      .sort((a, b) => a.da.localeCompare(b.da))
      .map((e) => ({ nome: e.nome, admissao: e.da })),
  }));

  return { furos, entradas, saidas };
}
