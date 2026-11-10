// Custo REAL da equipe no mês (10/11/2026, pedido do dono: "nós temos a folha,
// bonificação, diárias, 10% — nessa conta está tudo? No Prainha tem muita gente
// que recebe por fora, só diária; no Tabuará todos são registrados").
//
// O estudo de equipe estimava o custo pelo cadastro (salário × encargos ou valor
// da hora). Aqui entra o que a casa realmente lançou pra cada pessoa:
//   - folha SEMANAL (conta_pagar com folha_semana_id): 10% (comissão / pró-labore
//     do gerente), diária, gratificação/premiação e transporte — a semana que
//     cruza o mês entra proporcional aos dias dentro do período;
//   - folha MENSAL (lib/rh/nossa-folha): proventos de quem é registrado, rateado
//     pelas horas em cada casa; encargos = estimativa pelo fator do regime;
//   - vale transporte e diária avulsa paga pelo caixa (conta_pagar sem folha);
//   - salário pago por fora ("quinzenal", lançamento manual) de quem NÃO é
//     registrado — o do registrado já vem da folha do mês.
// O fornecedor é por casa (a mesma pessoa tem um em cada), então o lançamento
// acha a pessoa pelo vínculo do cadastro, pelo CPF ou pelo nome.
// E separa REGISTRADO (tem empresa de registro no cadastro e não é diarista no
// mês) de NÃO REGISTRADO (só diária / por fora).
//
// Os 10% são pagos pelo cliente: aparecem como ganho da pessoa, mas NÃO entram
// no custo da casa.

import { db } from '@concilia/db';
import { sql, type SQL } from 'drizzle-orm';
import { nossaFolhaDoMes } from '@/lib/rh/nossa-folha';
import { FATOR_CLT, FATOR_INTERMITENTE } from '@/lib/rh/horas-regime';

async function q<T>(query: SQL): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[];
}
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export interface Pago {
  /** Proventos da folha do mês (parte desta casa) ou salário pago por fora de quem não é registrado. */
  salario: number;
  /** Estimativa: FGTS + provisões (férias, 13º) sobre o salário. */
  encargos: number;
  diaria: number;
  /** Gratificação, bônus e premiação de meta. */
  bonificacao: number;
  transporte: number;
  /** Parte dos 10% (pago pelo cliente — fora do custo da casa). */
  dezPct: number;
}

export const PAGO_ZERO: Pago = { salario: 0, encargos: 0, diaria: 0, bonificacao: 0, transporte: 0, dezPct: 0 };

/** O que sai do bolso da casa (sem os 10%). */
export const custoCasa = (p: Pago) => p.salario + p.encargos + p.diaria + p.bonificacao + p.transporte;
/** O que a pessoa recebe (sem encargos, com os 10%). */
export const ganhoPessoa = (p: Pago) => p.salario + p.diaria + p.bonificacao + p.transporte + p.dezPct;

export interface PessoaHorasCasa {
  id: string;
  hCasa: number;
  hTotal: number;
}

export interface PagoSemPonto {
  nome: string;
  registrado: boolean;
  pago: Pago;
}

export interface CustoRealCasa {
  /** funcionarioId → pago nesta casa no período. */
  porPessoa: Map<string, Pago>;
  /** funcionarioId → registrado no mês. */
  registrado: Map<string, boolean>;
  /** Recebeu da casa no período e não bateu ponto nela. */
  semPonto: PagoSemPonto[];
}

type Tipo = keyof Pago;

function tipoSemanal(descricao: string): Tipo {
  const d = descricao.toLowerCase();
  if (d.startsWith('diária') || d.startsWith('diaria')) return 'diaria';
  if (d.startsWith('transporte') || d.startsWith('aux')) return 'transporte';
  if (d.startsWith('gratifica') || d.startsWith('premia') || d.startsWith('bônus') || d.startsWith('bonus')) return 'bonificacao';
  return 'dezPct'; // Comissão semana / Pró-labore semana (gerente)
}

const normNome = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

const somar = (m: Map<string, Pago>, k: string, t: Tipo, v: number) => {
  if (!v) return;
  const p = m.get(k) ?? { ...PAGO_ZERO };
  p[t] += v;
  m.set(k, p);
};

export async function custoRealDaCasa(
  filialId: string,
  mes: string,
  ini: string,
  fim: string,
  pessoas: PessoaHorasCasa[],
): Promise<CustoRealCasa> {
  const [a, m] = mes.split('-').map(Number);
  const diasMes = new Date(Date.UTC(a!, m!, 0)).getUTCDate();
  const fimMes = `${mes}-${String(diasMes).padStart(2, '0')}`;
  const diasPeriodo = Math.round((Date.parse(fim) - Date.parse(ini)) / 86400000) + 1;
  const fracMes = Math.min(1, diasPeriodo / diasMes);

  const [cads, semanal, avulso] = await Promise.all([
    q<{
      id: string;
      nome: string;
      filial_id: string;
      fornecedor_id: string | null;
      cpf: string | null;
      reg: boolean;
      papel: string | null;
      diarista_ate: string | null;
    }>(sql`
      SELECT f.id, f.nome, f.filial_id, f.fornecedor_id, f.cpf,
             (coalesce(f.cnpj_registro,'') <> '' OR coalesce(f.empresa_registro,'') <> '' OR coalesce(f.matricula_folha,'') <> '') AS reg,
             ff.papel, ff.diarista_ate::text AS diarista_ate
        FROM funcionario f LEFT JOIN fornecedor_folha ff ON ff.fornecedor_id = f.fornecedor_id`),
    // Folha semanal: proporcional aos dias da semana dentro do período.
    q<{ fornecedor_id: string; nome: string; doc: string | null; descricao: string | null; valor: string; dias: number }>(sql`
      SELECT cp.fornecedor_id, fo.nome, fo.cnpj_ou_cpf AS doc, cp.descricao, cp.valor,
             (LEAST(fs.data_fim, ${fim}::date) - GREATEST(fs.data_inicio, ${ini}::date) + 1)::int AS dias
        FROM conta_pagar cp
        JOIN folha_semana fs ON fs.id = cp.folha_semana_id
        JOIN fornecedor fo ON fo.id = cp.fornecedor_id
       WHERE fs.filial_id = ${filialId} AND fs.status <> 'cancelada' AND cp.data_delete IS NULL
         AND fs.data_inicio <= ${fim}::date AND fs.data_fim >= ${ini}::date`),
    // Fora da folha semanal: vale transporte e diária/passagem paga pelo caixa.
    q<{ fornecedor_id: string; nome: string; doc: string | null; descricao: string | null; cat: string | null; valor: string }>(sql`
      SELECT cp.fornecedor_id, fo.nome, fo.cnpj_ou_cpf AS doc, cp.descricao, c.descricao AS cat, cp.valor
        FROM conta_pagar cp
        JOIN fornecedor_folha ff ON ff.fornecedor_id = cp.fornecedor_id
        JOIN fornecedor fo ON fo.id = cp.fornecedor_id
        LEFT JOIN categoria_conta c ON c.id = cp.categoria_id
       WHERE cp.filial_id = ${filialId} AND cp.folha_semana_id IS NULL AND cp.data_delete IS NULL
         AND cp.data_vencimento BETWEEN ${ini}::date AND ${fim}::date
         AND coalesce(cp.origem, '') <> 'FOLHA'
         AND coalesce(c.descricao, '') !~* 'rescis' AND coalesce(cp.descricao, '') !~* 'rescis'
         AND (c.descricao ILIKE '%transporte%' OR c.descricao ~* 'sal[aá]rio' OR cp.descricao ~* 'di[aá]ria|passagem|transporte|quinzen|sal[aá]rio')`),
  ]);

  const cadPorId = new Map(cads.map((c) => [c.id, c]));
  const registradoDe = (c: (typeof cads)[number]) =>
    c.reg && c.papel !== 'diarista' && !(c.diarista_ate && c.diarista_ate >= fimMes);
  const registrado = new Map(cads.map((c) => [c.id, registradoDe(c)]));

  // fornecedor → funcionário: vínculo do cadastro, CPF ou nome; prefere quem bateu ponto nesta casa.
  const comPonto = new Set(pessoas.filter((p) => p.hCasa > 0).map((p) => p.id));
  const porChave = new Map<string, string[]>();
  const indexar = (k: string | null | undefined | false, id: string) => {
    if (!k) return;
    const l = porChave.get(k);
    if (l) l.push(id);
    else porChave.set(k, [id]);
  };
  for (const c of cads) {
    indexar(c.fornecedor_id && `f:${c.fornecedor_id}`, c.id);
    indexar(c.cpf && c.cpf.length === 11 && `c:${c.cpf}`, c.id);
    indexar(`n:${normNome(c.nome)}`, c.id);
  }
  const funcDoFornecedor = new Map<string, string>();
  const resolver = (fid: string, doc: string | null, nome: string) => {
    if (funcDoFornecedor.has(fid)) return;
    const cpf = (doc ?? '').replace(/\D/g, '');
    const cand = [...(porChave.get(`f:${fid}`) ?? []), ...(cpf.length === 11 ? porChave.get(`c:${cpf}`) ?? [] : []), ...(porChave.get(`n:${normNome(nome)}`) ?? [])];
    const escolhido = cand.find((id) => comPonto.has(id)) ?? cand[0];
    if (escolhido) funcDoFornecedor.set(fid, escolhido);
  };

  const porFornecedor = new Map<string, Pago>();
  const salarioFora = new Map<string, number>();
  const nomeFornecedor = new Map<string, string>();
  for (const r of semanal) {
    nomeFornecedor.set(r.fornecedor_id, r.nome);
    resolver(r.fornecedor_id, r.doc, r.nome);
    somar(porFornecedor, r.fornecedor_id, tipoSemanal(r.descricao ?? ''), (num(r.valor) * Math.max(0, r.dias)) / 7);
  }
  for (const r of avulso) {
    nomeFornecedor.set(r.fornecedor_id, r.nome);
    resolver(r.fornecedor_id, r.doc, r.nome);
    const d = `${r.cat ?? ''} ${r.descricao ?? ''}`;
    if (/transporte|passagem/i.test(d)) somar(porFornecedor, r.fornecedor_id, 'transporte', num(r.valor));
    else if (/di[aá]ria/i.test(d)) somar(porFornecedor, r.fornecedor_id, 'diaria', num(r.valor));
    else salarioFora.set(r.fornecedor_id, (salarioFora.get(r.fornecedor_id) ?? 0) + num(r.valor));
  }
  // Salário por fora só conta pra quem não é registrado (o do registrado vem da folha do mês).
  for (const [fid, v] of salarioFora) {
    const func = funcDoFornecedor.get(fid);
    if (!(func && registrado.get(func))) somar(porFornecedor, fid, 'salario', v);
  }

  const porPessoa = new Map<string, Pago>();
  const semPontoMap = new Map<string, PagoSemPonto>();
  const juntar = (alvo: Pago, p: Pago) => {
    for (const k of Object.keys(PAGO_ZERO) as Tipo[]) alvo[k] += p[k];
  };
  for (const [fid, pago] of porFornecedor) {
    const func = funcDoFornecedor.get(fid);
    if (func && comPonto.has(func)) {
      const alvo = porPessoa.get(func) ?? { ...PAGO_ZERO };
      juntar(alvo, pago);
      porPessoa.set(func, alvo);
    } else {
      const chave = func ?? `f:${fid}`;
      const x = semPontoMap.get(chave) ?? {
        nome: (func && cadPorId.get(func)?.nome) || nomeFornecedor.get(fid) || '—',
        registrado: func ? registrado.get(func) ?? false : false,
        pago: { ...PAGO_ZERO },
      };
      juntar(x.pago, pago);
      semPontoMap.set(chave, x);
    }
  }

  // Folha mensal: das casas de cadastro de quem bateu aqui (+ esta casa).
  const horas = new Map(pessoas.map((p) => [p.id, p]));
  const casas = new Set<string>([filialId]);
  for (const p of pessoas) {
    const c = cadPorId.get(p.id);
    if (c && p.hCasa > 0) casas.add(c.filial_id);
  }
  const folhas = await Promise.all([...casas].map((c) => nossaFolhaDoMes(c, mes).then((l) => ({ casa: c, l })).catch(() => ({ casa: c, l: [] }))));
  for (const { casa, l } of folhas) {
    for (const x of l) {
      if (!(x.proventos > 0) || !registrado.get(x.funcionarioId)) continue;
      const h = horas.get(x.funcionarioId);
      // Sem ponto em casa nenhuma: fica na casa do cadastro. Com ponto: pela parte das horas aqui.
      const parte = h && h.hTotal > 0 ? h.hCasa / h.hTotal : casa === filialId ? 1 : 0;
      if (parte <= 0) continue;
      const salario = x.proventos * parte * (x.regime === 'clt_mensal' ? fracMes : 1);
      const encargos = salario * ((x.regime === 'clt_mensal' ? FATOR_CLT : FATOR_INTERMITENTE) - 1);
      if (h && h.hCasa > 0) {
        const alvo = porPessoa.get(x.funcionarioId) ?? { ...PAGO_ZERO };
        alvo.salario += salario;
        alvo.encargos += encargos;
        porPessoa.set(x.funcionarioId, alvo);
      } else {
        const s = semPontoMap.get(x.funcionarioId) ?? { nome: x.nome, registrado: true, pago: { ...PAGO_ZERO } };
        s.pago.salario += salario;
        s.pago.encargos += encargos;
        semPontoMap.set(x.funcionarioId, s);
      }
    }
  }

  const semPonto = [...semPontoMap.values()].filter((x) => custoCasa(x.pago) + x.pago.dezPct >= 1).sort((x, y) => custoCasa(y.pago) + y.pago.dezPct - custoCasa(x.pago) - x.pago.dezPct);
  return { porPessoa, registrado, semPonto };
}
