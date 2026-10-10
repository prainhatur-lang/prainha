// Traz o histórico do Stelanto (ponto antigo) pro Concilia.
// Ver packages/db/src/schema/rh-escala.ts.
//
// Lê dois arquivos tirados da API do Stelanto em 10/10/2026 (cópia em
// ~/Downloads/concilia-backups/stelanto-2026-10-10):
//   stelanto-completo.json  { usuarios[], jornadas[], hist{ userId: [dia...] } }
//   usuarios-extra.json     [[userId, desligamento, fimSistema, nascimento, ...]]
//
// Uso (sem --aplicar só MOSTRA o que faria, não grava nada):
//   pnpm --filter @concilia/db importar:stelanto <pasta>
//   pnpm --filter @concilia/db importar:stelanto <pasta> --aplicar
//   ... --so=arquivo,jornadas,saldo,cadastro   (escolhe os passos)
//
// Passos, todos idempotentes:
//   arquivo   stelanto_colaborador + stelanto_dia (todo mundo, todos os dias)
//   jornadas  rh_jornada (as do Stelanto) + funcionario_jornada (quem está ativo)
//   saldo     banco_horas_lancamento 'saldo_inicial' = saldo do Stelanto no
//             último dia antes do ponto próprio (só mensalista ativo)
//   cadastro  preenche campo VAZIO do funcionário (admissão, telefone,
//             nascimento, desligamento de quem já está inativo, regime).
//             Nunca troca valor que já existe.

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const args = process.argv.slice(2);
const pasta = args.find((a) => !a.startsWith('--'));
const aplicar = args.includes('--aplicar');
const so = (args.find((a) => a.startsWith('--so='))?.slice(5) ?? 'arquivo,jornadas,saldo,cadastro').split(',');
if (!pasta) throw new Error('faltou a pasta dos arquivos do Stelanto');

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

const BAR = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';
const TABUARA = 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7';
const MAR = 'e899dae2-38bf-4f3f-9149-7effd059fab8';
const FILIAL_POR_EQUIPE: Record<string, string> = { PRAINHA: BAR, TABUARA, 'PRAINHA MAR E GRIL': MAR };

// Mesmas datas de apps/web/src/lib/rh/ponto-vigencia.ts (primeiro dia do
// ponto próprio por casa). O saldo do Stelanto vale até a véspera.
const PONTO_PROPRIO_DESDE: Record<string, string> = { [MAR]: '2026-09-28' };
const pontoProprioDesde = (filialId: string | null) => (filialId && PONTO_PROPRIO_DESDE[filialId]) || '2026-10-01';

interface Usuario {
  uid: string; n: string; cpf?: string; em?: string; ph?: string; adm?: string;
  st: string; team?: string; bu?: string; sh?: string; tr?: string;
}
type Batida = [string, 'I' | 'O', string, string, number, number | null, number | null, string];
interface Dia {
  d: string; sh?: string; st?: string; e?: number; w?: number; lb?: number; mt?: number;
  xt?: number; ln?: number; b?: number; bd?: number; o?: unknown; t?: Batida[]; r?: unknown;
}
interface Funcionario {
  id: string; filial_id: string; cpf: string | null; nome: string; telefone: string | null;
  adm: string | null; desl: string | null; nasc: string | null; ativo: boolean; reg: string | null;
}

const soDigitos = (s?: string | null) => (s ?? '').replace(/\D/g, '');
function cpfValido(c: string): boolean {
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(c[i]) * (10 - i);
  if (((s * 10) % 11) % 10 !== Number(c[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += Number(c[i]) * (11 - i);
  return ((s * 10) % 11) % 10 === Number(c[10]);
}
const nomeChave = (n: string) =>
  n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)/g, ' ').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
const hhmm = (seg: number) => {
  const a = Math.abs(Math.round(seg / 60));
  return `${seg < 0 ? '−' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
};
const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const vespera = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);

async function main() {
  const completo = JSON.parse(readFileSync(resolve(pasta!, 'stelanto-completo.json'), 'utf8')) as {
    usuarios: Usuario[];
    jornadas: { name: string; type: string; days?: { weekDay: number; totalWorkDay: number }[] }[];
    hist: Record<string, Dia[]>;
  };
  const extra = JSON.parse(readFileSync(resolve(pasta!, 'usuarios-extra.json'), 'utf8')) as (string | null)[][];
  const extraPorUid = new Map(extra.map((e) => [e[0] as string, { desl: e[1], nasc: e[3] }]));
  const tipoJornada = new Map(completo.jornadas.map((j) => [j.name, j.type]));

  // tr NONE = o relógio de ponto e a conta de administração (não são gente da escala)
  const pessoas = completo.usuarios.filter((u) => u.tr !== 'NONE');
  const funcionarios = await sql<Funcionario[]>`
    SELECT id, filial_id, cpf, nome, telefone, data_admissao::text AS adm, data_desligamento::text AS desl,
           data_nascimento::text AS nasc, ativo, regime_salarial AS reg
    FROM funcionario`;
  const porCpf = new Map(funcionarios.filter((f) => f.cpf).map((f) => [f.cpf as string, f]));
  const porNome = new Map<string, Funcionario[]>();
  for (const f of funcionarios) porNome.set(nomeChave(f.nome), [...(porNome.get(nomeChave(f.nome)) ?? []), f]);

  // Vínculo: CPF. Pelo nome só quando o CPF do Stelanto é inválido (cadastro
  // feito com número inventado) e existe UM funcionário com o nome igual.
  const vinculo = new Map<string, Funcionario>();
  for (const u of pessoas) {
    const cpf = soDigitos(u.cpf);
    let f = cpfValido(cpf) ? porCpf.get(cpf) : undefined;
    if (!f && !cpfValido(cpf)) {
      const mesmos = porNome.get(nomeChave(u.n)) ?? [];
      if (mesmos.length === 1) f = mesmos[0];
    }
    if (f) vinculo.set(u.uid, f);
  }
  const resumoDias = (uid: string) => {
    const comBatida = (completo.hist[uid] ?? []).filter((d) => d.t?.length);
    return { n: comBatida.length, pri: comBatida[0]?.d ?? null, ult: comBatida[comBatida.length - 1]?.d ?? null };
  };
  console.log(`${aplicar ? 'GRAVANDO' : 'SIMULAÇÃO (nada é gravado)'} — passos: ${so.join(', ')}`);
  console.log(`pessoas no Stelanto: ${pessoas.length} · com cadastro no Concilia: ${vinculo.size}`);

  // ---------- arquivo ----------
  if (so.includes('arquivo')) {
    const linhas = pessoas.map((u) => {
      const r = resumoDias(u.uid);
      const ex = extraPorUid.get(u.uid);
      const cpf = soDigitos(u.cpf);
      return {
        stelanto_user_id: u.uid,
        funcionario_id: vinculo.get(u.uid)?.id ?? null,
        filial_id: FILIAL_POR_EQUIPE[(u.team ?? '').trim().toUpperCase()] ?? null,
        nome: u.n.replace(/\s+/g, ' ').trim(),
        cpf: cpf.length === 11 ? cpf : null,
        email: u.em ?? null,
        telefone: soDigitos(u.ph) || null,
        data_nascimento: ex?.nasc ?? null,
        data_admissao: u.adm ?? null,
        data_desligamento: u.st === 'DISABLED' ? ex?.desl ?? null : null,
        status: u.st,
        equipe: u.team ?? null,
        unidade: u.bu ?? null,
        jornada: u.sh ?? null,
        dias_trabalhados: r.n,
        primeiro_dia: r.pri,
        ultimo_dia: r.ult,
      };
    });
    const totalDias = pessoas.reduce((s, u) => s + (completo.hist[u.uid]?.length ?? 0), 0);
    console.log(`[arquivo] ${linhas.length} colaboradores, ${totalDias} dias`);
    if (aplicar) {
      const ids = await sql<{ id: string; stelanto_user_id: string }[]>`
        INSERT INTO stelanto_colaborador (stelanto_user_id, funcionario_id, filial_id, nome, cpf, email, telefone,
          data_nascimento, data_admissao, data_desligamento, status, equipe, unidade, jornada,
          dias_trabalhados, primeiro_dia, ultimo_dia)
        SELECT x.stelanto_user_id, x.funcionario_id, x.filial_id, x.nome, x.cpf, x.email, x.telefone,
          x.data_nascimento, x.data_admissao, x.data_desligamento, x.status, x.equipe, x.unidade, x.jornada,
          x.dias_trabalhados, x.primeiro_dia, x.ultimo_dia
        FROM jsonb_to_recordset(${JSON.stringify(linhas)}::text::jsonb) AS x(
          stelanto_user_id text, funcionario_id uuid, filial_id uuid, nome text, cpf text, email text, telefone text,
          data_nascimento date, data_admissao date, data_desligamento date, status text, equipe text, unidade text,
          jornada text, dias_trabalhados int, primeiro_dia date, ultimo_dia date)
        ON CONFLICT (stelanto_user_id) DO UPDATE SET
          funcionario_id = excluded.funcionario_id, filial_id = excluded.filial_id, nome = excluded.nome,
          cpf = excluded.cpf, email = excluded.email, telefone = excluded.telefone,
          data_nascimento = excluded.data_nascimento, data_admissao = excluded.data_admissao,
          data_desligamento = excluded.data_desligamento, status = excluded.status, equipe = excluded.equipe,
          unidade = excluded.unidade, jornada = excluded.jornada, dias_trabalhados = excluded.dias_trabalhados,
          primeiro_dia = excluded.primeiro_dia, ultimo_dia = excluded.ultimo_dia, importado_em = now()
        RETURNING id, stelanto_user_id`;
      const idPorUid = new Map(ids.map((r) => [r.stelanto_user_id, r.id]));

      const dias: Record<string, unknown>[] = [];
      for (const u of pessoas) {
        for (const d of completo.hist[u.uid] ?? []) {
          dias.push({
            colaborador_id: idPorUid.get(u.uid),
            dia: d.d,
            status: d.st ?? null,
            jornada: d.sh?.trim() || null,
            previsto_seg: d.e ?? 0,
            trabalhado_seg: d.w ?? 0,
            intervalo_seg: d.lb ?? 0,
            falta_seg: d.mt ?? 0,
            extra_seg: d.xt ?? 0,
            noturno_seg: d.ln ?? 0,
            saldo_dia_seg: d.bd ?? 0,
            saldo_acumulado_seg: d.b ?? 0,
            batidas: d.t?.length
              ? d.t.map(([h, t, disp, reg, ed, lat, lng, fl]) => ({
                  h, t: t === 'I' ? 'E' : 'S',
                  ...(disp ? { disp } : {}), ...(reg ? { reg } : {}), ...(ed ? { ed: 1 } : {}),
                  ...(lat ? { lat, lng } : {}), ...(fl ? { fl } : {}),
                }))
              : null,
            pedido: d.r ?? null,
            outros: d.o ?? null,
          });
        }
      }
      for (let i = 0; i < dias.length; i += 2000) {
        await sql`
          INSERT INTO stelanto_dia (colaborador_id, dia, status, jornada, previsto_seg, trabalhado_seg, intervalo_seg,
            falta_seg, extra_seg, noturno_seg, saldo_dia_seg, saldo_acumulado_seg, batidas, pedido, outros)
          SELECT x.colaborador_id, x.dia, x.status, x.jornada, x.previsto_seg, x.trabalhado_seg, x.intervalo_seg,
            x.falta_seg, x.extra_seg, x.noturno_seg, x.saldo_dia_seg, x.saldo_acumulado_seg, x.batidas, x.pedido, x.outros
          FROM jsonb_to_recordset(${JSON.stringify(dias.slice(i, i + 2000))}::text::jsonb) AS x(
            colaborador_id uuid, dia date, status text, jornada text, previsto_seg int, trabalhado_seg int,
            intervalo_seg int, falta_seg int, extra_seg int, noturno_seg int, saldo_dia_seg int,
            saldo_acumulado_seg int, batidas jsonb, pedido jsonb, outros jsonb)
          ON CONFLICT (colaborador_id, dia) DO UPDATE SET
            status = excluded.status, jornada = excluded.jornada, previsto_seg = excluded.previsto_seg,
            trabalhado_seg = excluded.trabalhado_seg, intervalo_seg = excluded.intervalo_seg,
            falta_seg = excluded.falta_seg, extra_seg = excluded.extra_seg, noturno_seg = excluded.noturno_seg,
            saldo_dia_seg = excluded.saldo_dia_seg, saldo_acumulado_seg = excluded.saldo_acumulado_seg,
            batidas = excluded.batidas, pedido = excluded.pedido, outros = excluded.outros`;
        process.stdout.write(`\r[arquivo] dias gravados: ${Math.min(i + 2000, dias.length)}/${dias.length}`);
      }
      console.log('');
    }
  }

  // Quem vale pra escala/saldo/cadastro: o registro "principal" de cada
  // funcionário (o ATIVO; se não houver, o que bateu ponto por último).
  const principal = new Map<string, Usuario>();
  for (const u of pessoas) {
    const f = vinculo.get(u.uid);
    if (!f) continue;
    const atual = principal.get(f.id);
    const melhor =
      !atual ||
      (u.st === 'ACTIVE' && atual.st !== 'ACTIVE') ||
      (u.st === atual.st && (resumoDias(u.uid).ult ?? '') > (resumoDias(atual.uid).ult ?? ''));
    if (melhor) principal.set(f.id, u);
  }
  const fPorId = new Map(funcionarios.map((f) => [f.id, f]));

  // ---------- jornadas ----------
  if (so.includes('jornadas')) {
    const jornadas = completo.jornadas
      .filter((j) => j.name.trim().length > 1) // "." é teste
      .map((j) => {
        const min = (wd: number) =>
          j.type === 'INTERMITTENT' ? 0 : Math.round((j.days?.find((d) => d.weekDay === wd)?.totalWorkDay ?? 0) / 60);
        return {
          nome: j.name.trim(), tipo: j.type === 'INTERMITTENT' ? 'intermitente' : 'fixa',
          min_seg: min(1), min_ter: min(2), min_qua: min(3), min_qui: min(4), min_sex: min(5), min_sab: min(6), min_dom: min(7),
        };
      });
    for (const j of jornadas) {
      console.log(`[jornadas] ${j.nome} (${j.tipo}) seg..dom = ${[j.min_seg, j.min_ter, j.min_qua, j.min_qui, j.min_sex, j.min_sab, j.min_dom].join('/')} min`);
    }
    const atribuir: { funcionario_id: string; nome: string; jornada: string; desde: string }[] = [];
    const semJornada: string[] = [];
    for (const [fid, u] of principal) {
      const f = fPorId.get(fid)!;
      if (u.st !== 'ACTIVE' || !f.ativo || !u.sh) continue;
      // CLT mensal no Concilia mas ainda em jornada intermitente no Stelanto:
      // a escala fixa dela não está em lugar nenhum — fica pra escolher na tela.
      if (f.reg === 'clt_mensal' && tipoJornada.get(u.sh) === 'INTERMITTENT') { semJornada.push(f.nome); continue; }
      atribuir.push({ funcionario_id: fid, nome: f.nome, jornada: u.sh.trim(), desde: pontoProprioDesde(f.filial_id) });
    }
    console.log(`[jornadas] ${atribuir.length} pessoas recebem jornada; CLT sem escala definida: ${semJornada.join(', ') || '—'}`);
    if (aplicar) {
      await sql`
        INSERT INTO rh_jornada (nome, tipo, min_seg, min_ter, min_qua, min_qui, min_sex, min_sab, min_dom, origem)
        SELECT x.nome, x.tipo, x.min_seg, x.min_ter, x.min_qua, x.min_qui, x.min_sex, x.min_sab, x.min_dom, 'stelanto'
        FROM jsonb_to_recordset(${JSON.stringify(jornadas)}::text::jsonb) AS x(
          nome text, tipo text, min_seg int, min_ter int, min_qua int, min_qui int, min_sex int, min_sab int, min_dom int)
        ON CONFLICT (nome) DO NOTHING`;
      await sql`
        INSERT INTO funcionario_jornada (funcionario_id, jornada_id, vigente_desde)
        SELECT x.funcionario_id, j.id, x.desde
        FROM jsonb_to_recordset(${JSON.stringify(atribuir)}::text::jsonb) AS x(funcionario_id uuid, jornada text, desde date)
        JOIN rh_jornada j ON j.nome = x.jornada
        ON CONFLICT (funcionario_id, vigente_desde) DO NOTHING`;
    }
  }

  // ---------- saldo ----------
  if (so.includes('saldo')) {
    const saldos: { funcionario_id: string; dia: string; minutos: number; descricao: string }[] = [];
    for (const [fid, u] of principal) {
      const f = fPorId.get(fid)!;
      if (u.st !== 'ACTIVE' || !f.ativo || tipoJornada.get(u.sh ?? '') === 'INTERMITTENT') continue;
      const ate = vespera(pontoProprioDesde(f.filial_id));
      const dias = (completo.hist[u.uid] ?? []).filter((d) => d.d <= ate);
      const ultimo = dias[dias.length - 1];
      if (!ultimo) continue;
      const semBatida = dias.filter((d) => (d.e ?? 0) > 0 && !d.t?.length && !(d.w ?? 0) && (d.bd ?? 0) < 0);
      const segSemBatida = semBatida.reduce((s, d) => s + (d.bd ?? 0), 0);
      const seg = ultimo.b ?? 0;
      const minutos = Math.sign(seg) * Math.round(Math.abs(seg) / 60);
      const descricao =
        `Saldo do banco de horas no Stelanto em ${br(ultimo.d)} (${u.sh?.trim()}).` +
        (semBatida.length
          ? ` Inclui ${hhmm(segSemBatida)} de ${semBatida.length} dia(s) com jornada prevista e nenhuma batida.`
          : '');
      saldos.push({ funcionario_id: fid, dia: ultimo.d, minutos, descricao });
      console.log(`[saldo] ${f.nome.padEnd(42)} ${hhmm(seg).padStart(8)}  em ${br(ultimo.d)}  sem batida: ${semBatida.length}d ${hhmm(segSemBatida)}`);
    }
    if (aplicar) {
      await sql`
        INSERT INTO banco_horas_lancamento (funcionario_id, dia, minutos, tipo, origem, descricao)
        SELECT x.funcionario_id, x.dia, x.minutos, 'saldo_inicial', 'stelanto', x.descricao
        FROM jsonb_to_recordset(${JSON.stringify(saldos)}::text::jsonb) AS x(funcionario_id uuid, dia date, minutos int, descricao text)
        ON CONFLICT (funcionario_id) WHERE tipo = 'saldo_inicial' DO NOTHING`;
    }
  }

  // ---------- cadastro ----------
  if (so.includes('cadastro')) {
    const mudancas: { id: string; nome: string; campo: string; valor: string }[] = [];
    const admissaoDuvidosa: string[] = [];
    for (const [fid, u] of principal) {
      const f = fPorId.get(fid)!;
      const ex = extraPorUid.get(u.uid);
      const fone = soDigitos(u.ph);
      // Admissão até jan/2024 é só o dia em que a pessoa foi cadastrada no
      // Stelanto (a casa começou a usar em 12/2023) — quem já trabalhava antes
      // ficaria com data errada. Essas não entram; saem na lista pra conferir.
      if (!f.adm && u.adm && u.adm > '2024-01-31') mudancas.push({ id: fid, nome: f.nome, campo: 'data_admissao', valor: u.adm });
      else if (!f.adm && u.adm) admissaoDuvidosa.push(`${f.nome} (${br(u.adm)})`);
      // Celular de verdade: DDD + 9 + 8 dígitos (tem cadastro com 79 00000-1000).
      if (!f.telefone && /^[1-9]\d9\d{8}$/.test(fone) && !/0{5}/.test(fone)) mudancas.push({ id: fid, nome: f.nome, campo: 'telefone', valor: fone });
      if (!f.nasc && ex?.nasc) mudancas.push({ id: fid, nome: f.nome, campo: 'data_nascimento', valor: ex.nasc });
      if (!f.ativo && !f.desl && u.st === 'DISABLED' && ex?.desl) mudancas.push({ id: fid, nome: f.nome, campo: 'data_desligamento', valor: ex.desl });
      if (f.ativo && !f.reg && u.st === 'ACTIVE' && u.sh) {
        mudancas.push({ id: fid, nome: f.nome, campo: 'regime_salarial', valor: tipoJornada.get(u.sh) === 'INTERMITTENT' ? 'intermitente_hora' : 'clt_mensal' });
      }
    }
    for (const campo of ['data_admissao', 'telefone', 'data_nascimento', 'data_desligamento', 'regime_salarial']) {
      const dele = mudancas.filter((m) => m.campo === campo);
      console.log(`[cadastro] ${campo}: ${dele.length} preenchimento(s)`);
      for (const m of dele) console.log(`    ${m.nome.padEnd(42)} ${m.valor}`);
    }
    console.log(`[cadastro] admissão NÃO preenchida (data é a do cadastro no Stelanto): ${admissaoDuvidosa.join(', ') || '—'}`);
    if (aplicar) {
      // Um UPDATE por campo, sempre com "ainda está vazio" no WHERE.
      const de = (campo: string) => JSON.stringify(mudancas.filter((m) => m.campo === campo));
      await sql`UPDATE funcionario f SET data_admissao = x.valor::date, atualizado_em = now()
        FROM jsonb_to_recordset(${de('data_admissao')}::text::jsonb) AS x(id uuid, valor text) WHERE f.id = x.id AND f.data_admissao IS NULL`;
      await sql`UPDATE funcionario f SET telefone = x.valor, atualizado_em = now()
        FROM jsonb_to_recordset(${de('telefone')}::text::jsonb) AS x(id uuid, valor text) WHERE f.id = x.id AND coalesce(f.telefone, '') = ''`;
      await sql`UPDATE funcionario f SET data_nascimento = x.valor::date, atualizado_em = now()
        FROM jsonb_to_recordset(${de('data_nascimento')}::text::jsonb) AS x(id uuid, valor text) WHERE f.id = x.id AND f.data_nascimento IS NULL`;
      await sql`UPDATE funcionario f SET data_desligamento = x.valor::date, atualizado_em = now()
        FROM jsonb_to_recordset(${de('data_desligamento')}::text::jsonb) AS x(id uuid, valor text) WHERE f.id = x.id AND f.data_desligamento IS NULL AND f.ativo = false`;
      await sql`UPDATE funcionario f SET regime_salarial = x.valor, atualizado_em = now()
        FROM jsonb_to_recordset(${de('regime_salarial')}::text::jsonb) AS x(id uuid, valor text) WHERE f.id = x.id AND f.regime_salarial IS NULL`;
    }
  }

  await sql.end();
  console.log(aplicar ? '[ok] gravado' : '[ok] simulação — rode de novo com --aplicar pra gravar');
}
main().catch((e) => { console.error(e); process.exit(1); });
