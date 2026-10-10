// Lê os PDFs "Extrato Mensal" da folha do contador e grava em
// `folha_contador` (uma linha por pessoa por competência) e
// `folha_contador_resumo` (o fechamento de cada PDF). Também preenche o
// registro em carteira no cadastro (`funcionario.empresa_registro`,
// `cnpj_registro`, `cargo_registro`, `cbo`, `matricula_folha`).
// Ver packages/db/src/schema/folha-contador.ts.
//
// Uso (sem --aplicar só MOSTRA o que faria, não grava nada):
//   pnpm --filter @concilia/db importar:folha-contador "/caminho/a.pdf" "/caminho/b.pdf"
//   pnpm --filter @concilia/db importar:folha-contador "/caminho/a.pdf" ... --aplicar
//
// Precisa do `pdftotext` (poppler) na máquina. Idempotente: reimportar o
// mesmo mês troca os valores pelo que está no PDF.
//
// Antes de gravar confere cada PDF com ele mesmo — nº de empregados, total
// de proventos, de descontos e líquido do resumo, e a soma das rubricas de
// cada pessoa contra o provento/desconto dela. Qualquer diferença aborta.
//
// NÃO mexe em salário, regime, admissão nem desligamento do cadastro: só
// mostra onde a folha e o cadastro discordam, pra alguém decidir.

import { config as loadEnv } from 'dotenv';
import { resolve, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const args = process.argv.slice(2);
const pdfs = args.filter((a) => !a.startsWith('--'));
const aplicar = args.includes('--aplicar');
if (pdfs.length === 0) throw new Error('faltou o caminho dos PDFs da folha');

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

const BAR = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';
const TABUARA = 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7';
const MAR = 'e899dae2-38bf-4f3f-9149-7effd059fab8';
const NOME_CASA: Record<string, string> = { [BAR]: 'Prainha Bar', [TABUARA]: 'Tabuará', [MAR]: 'Prainha Mar' };

interface Rubrica { codigo: string; descricao: string; referencia: number; valor: number; tipo: 'P' | 'D' }
interface Pessoa {
  matricula: string; nome: string; situacao: string; cpf: string; admissao: string | null;
  vinculo: string | null; horasMes: number | null; cargo: string | null; cbo: string | null; salario: number | null;
  proventos: number; descontos: number; liquido: number;
  baseInss: number | null; baseFgts: number | null; valorFgts: number | null; baseIrrf: number | null;
  demitidoEm: string | null; motivoDemissao: string | null; rubricas: Rubrica[];
}
interface Resumo {
  empregados: number; trabalhando: number; demitidos: number;
  proventos: number; descontos: number; liquido: number;
  inssSegurados: number; inssEmpresa: number; inssRat: number; inssTerceiros: number;
  fgts: number; fgtsRescisorio: number; irrf: number;
}
interface Arquivo {
  arquivo: string; empresa: string; cnpj: string; competencia: string; departamento: string;
  pessoas: Pessoa[]; resumo: Resumo; filialId?: string;
}

const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
const iso = (br: string) => {
  const m = br.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) throw new Error('data fora do padrão: ' + br);
  return `${m[3]}-${m[2]}-${m[1]}`;
};
const centavos = (v: number) => Math.round(v * 100);
const VALOR = String.raw`-?[\d.]*\d,\d{2}`;
const RE_RUBRICA = new RegExp(String.raw`(?<=^|\s)(\d{1,5})\s+(\S.*?)\s{2,}(${VALOR})\s+(${VALOR})\s+([PD])(?=\s|$)`, 'g');

function lerPdf(caminho: string): Arquivo {
  const texto = execFileSync('pdftotext', ['-layout', caminho, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const linhas = texto.split('\n');
  let empresa = '', cnpj = '', competencia = '', departamento = '';
  const pessoas: Pessoa[] = [];
  const achados: Partial<Record<keyof Resumo, number>> = {};
  let cur: Pessoa | null = null;

  const nova = (matricula: string, nome: string, situacao: string, cpf: string, adm: string): Pessoa => ({
    matricula, nome: nome.replace(/\s+/g, ' ').trim(), situacao: situacao.trim(), cpf: cpf.replace(/\D/g, ''),
    admissao: iso(adm), vinculo: null, horasMes: null, cargo: null, cbo: null, salario: null,
    proventos: 0, descontos: 0, liquido: 0, baseInss: null, baseFgts: null, valorFgts: null, baseIrrf: null,
    demitidoEm: null, motivoDemissao: null, rubricas: [],
  });
  // O resumo se repete no PDF (do departamento e geral) — vale o primeiro.
  const guardar = (k: keyof Resumo, v: number) => { if (achados[k] === undefined) achados[k] = v; };

  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^Empresa:\s+\d+ - (.+?)\s{3,}/))) { empresa = m[1].trim(); continue; }
    if ((m = l.match(/^CNPJ:\s+([\d./-]+)/))) { cnpj = m[1].replace(/\D/g, ''); continue; }
    if ((m = l.match(/^Competência:\s+(\d{2})\/(\d{4})/))) { competencia = `${m[2]}-${m[1]}`; continue; }
    if ((m = l.match(/^Departamento:\s+\d+ - (.+)$/))) { departamento = m[1].trim(); continue; }

    if ((m = l.match(/^Empr\.:\s+(\d+)\s+(.+?)\s+Situação:\s+(.+?)\s+CPF:\s+([\d.-]+)\s+Adm:\s+(\S+)/))) {
      cur = nova(m[1], m[2], m[3], m[4], m[5]);
      pessoas.push(cur);
      continue;
    }
    // Nome comprido empurra situação, CPF e admissão pra linha de baixo.
    if ((m = l.match(/^Empr\.:\s+(\d+)\s+(.+?)Situação:\s*$/))) {
      const m2 = (linhas[i + 1] ?? '').match(/^\s+(.*?)\s*(Trabalhando|Demitido|Férias|Afastad.*?|Transferido|Aposentad.*?)\s+CPF:\s+([\d.-]+)\s+Adm:\s+(\S+)/);
      if (!m2) throw new Error(`${basename(caminho)}: linha "Empr." quebrada sem continuação: ${l.trim()}`);
      cur = nova(m[1], `${m[2]} ${m2[1]}`, m2[2], m2[3], m2[4]);
      pessoas.push(cur);
      i++;
      continue;
    }
    if (/^Empr\.:/.test(l)) throw new Error(`${basename(caminho)}: linha "Empr." não reconhecida: ${l.trim()}`);

    // Fim das pessoas: o que vem depois é resumo (as rubricas se repetem lá).
    if (/^Resumo por Rubrica/.test(l) || /Total Geral Proventos/.test(l)) cur = null;

    if (cur) {
      if ((m = l.match(/^Vínculo:\s+(.+?)\s+CC:\s+\S+\s+Depto:\s+\S+\s+Horas Mês:\s+([\d.,]+)/))) {
        cur.vinculo = m[1].trim(); cur.horasMes = num(m[2]); continue;
      }
      if ((m = l.match(/^Cargo:\s+\d+\s+(.+?)\s+C\.B\.O:\s+(\S+)\s+Filial:\s+\S+\s+Salário:\s+([\d.,]+)/))) {
        cur.cargo = m[1].trim(); cur.cbo = m[2]; cur.salario = num(m[3]); continue;
      }
      if ((m = l.match(new RegExp(String.raw`^ND:.*Proventos:\s+(${VALOR})\s+Descontos:\s+(${VALOR}).*Líquido:\s+(${VALOR})`)))) {
        cur.proventos = num(m[1]); cur.descontos = num(m[2]); cur.liquido = num(m[3]); continue;
      }
      if ((m = l.match(new RegExp(String.raw`^NF:.*Base INSS:\s+(${VALOR}).*Base FGTS:\s+(${VALOR})\s+Valor FGTS:\s+(${VALOR})\s+Base IRRF:\s+(${VALOR})`)))) {
        cur.baseInss = num(m[1]); cur.baseFgts = num(m[2]); cur.valorFgts = num(m[3]); cur.baseIrrf = num(m[4]); continue;
      }
      if ((m = l.match(/^DEMITIDO EM (\d{2}\/\d{2}\/\d{4})\s*-\s*MOTIVO\s*(.+)$/))) {
        cur.demitidoEm = iso(m[1]); cur.motivoDemissao = m[2].trim(); continue;
      }
      for (const r of l.matchAll(RE_RUBRICA)) {
        cur.rubricas.push({ codigo: r[1], descricao: r[2].trim(), referencia: num(r[3]), valor: num(r[4]), tipo: r[5] as 'P' | 'D' });
      }
      continue;
    }

    if ((m = l.match(/No\. Empregados:\s+(\d+)\s+Demitido:\s+(\d+)/))) { guardar('empregados', Number(m[1])); guardar('demitidos', Number(m[2])); }
    if ((m = l.match(/^Trabalhando:\s+(\d+)/))) guardar('trabalhando', Number(m[1]));
    if ((m = l.match(new RegExp(String.raw`Total Geral Proventos:\s+(${VALOR})\s+Total Geral Descontos:\s+(${VALOR})`)))) {
      guardar('proventos', num(m[1])); guardar('descontos', num(m[2]));
    }
    if ((m = l.match(new RegExp(String.raw`Líquido Geral:\s+(${VALOR})`)))) guardar('liquido', num(m[1]));
    if ((m = l.match(new RegExp(String.raw`^Segurados:\s+(${VALOR})`)))) guardar('inssSegurados', num(m[1]));
    if ((m = l.match(new RegExp(String.raw`^Empresa:\s+(${VALOR})(\s|$)`)))) guardar('inssEmpresa', num(m[1]));
    if ((m = l.match(new RegExp(String.raw`^RAT:\s+(${VALOR})`)))) guardar('inssRat', num(m[1]));
    if ((m = l.match(new RegExp(String.raw`^Terceiros:\s+(${VALOR})`)))) guardar('inssTerceiros', num(m[1]));
    if ((m = l.match(new RegExp(String.raw`Valor do FGTS:\s+(${VALOR})`)))) guardar('fgts', num(m[1]));
    if ((m = l.match(new RegExp(String.raw`Valor FGTS Rescisório:\s+(${VALOR})`)))) guardar('fgtsRescisorio', num(m[1]));
    if ((m = l.match(new RegExp(String.raw`Valor Total do IRRF:\s+(${VALOR})`)))) guardar('irrf', num(m[1]));
  }

  const arq = basename(caminho);
  if (!empresa || !/^\d{14}$/.test(cnpj) || !/^\d{4}-\d{2}$/.test(competencia)) {
    throw new Error(`${arq}: não achei empresa, CNPJ ou competência no cabeçalho`);
  }
  const campos: (keyof Resumo)[] = [
    'empregados', 'trabalhando', 'demitidos', 'proventos', 'descontos', 'liquido',
    'inssSegurados', 'inssEmpresa', 'inssRat', 'inssTerceiros', 'fgts', 'fgtsRescisorio', 'irrf',
  ];
  const faltou = campos.filter((k) => achados[k] === undefined);
  if (faltou.length) throw new Error(`${arq}: resumo incompleto, faltou ${faltou.join(', ')}`);
  const resumo = achados as Resumo;

  // Confere o PDF com ele mesmo.
  const erros: string[] = [];
  const soma = (f: (p: Pessoa) => number) => pessoas.reduce((a, p) => a + centavos(f(p)), 0);
  if (pessoas.length !== resumo.empregados) erros.push(`li ${pessoas.length} pessoas, o resumo diz ${resumo.empregados}`);
  if (soma((p) => p.proventos) !== centavos(resumo.proventos)) erros.push(`proventos somam ${soma((p) => p.proventos) / 100}, o resumo diz ${resumo.proventos}`);
  if (soma((p) => p.descontos) !== centavos(resumo.descontos)) erros.push(`descontos somam ${soma((p) => p.descontos) / 100}, o resumo diz ${resumo.descontos}`);
  if (soma((p) => p.liquido) !== centavos(resumo.liquido)) erros.push(`líquido soma ${soma((p) => p.liquido) / 100}, o resumo diz ${resumo.liquido}`);
  for (const p of pessoas) {
    const tot = (t: 'P' | 'D') => p.rubricas.filter((r) => r.tipo === t).reduce((a, r) => a + centavos(r.valor), 0);
    if (tot('P') !== centavos(p.proventos)) erros.push(`${p.nome}: rubricas de provento somam ${tot('P') / 100}, a folha diz ${p.proventos}`);
    if (tot('D') !== centavos(p.descontos)) erros.push(`${p.nome}: rubricas de desconto somam ${tot('D') / 100}, a folha diz ${p.descontos}`);
    if (!p.vinculo || !p.cargo || p.salario === null) erros.push(`${p.nome}: faltou vínculo, cargo ou salário`);
    if (p.cpf.length !== 11) erros.push(`${p.nome}: CPF fora do padrão`);
  }
  if (erros.length) throw new Error(`${arq}: a leitura não fecha com o PDF\n  - ${erros.join('\n  - ')}`);

  return { arquivo: arq, empresa, cnpj, competencia, departamento, pessoas, resumo };
}

const brl = (v: number | null) => (v === null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

async function main() {
  const arquivos = pdfs.map(lerPdf);

  const cpfs = [...new Set(arquivos.flatMap((a) => a.pessoas.map((p) => p.cpf)))];
  const cadastro = await sql<{
    id: string; filial_id: string; cpf: string; nome: string; ativo: boolean; regime: string | null; salario: string | null;
    adm: string | null; desl: string | null; empresa_registro: string | null; cnpj_registro: string | null;
    cargo_registro: string | null; cbo: string | null; matricula_folha: string | null;
  }[]>`
    SELECT id, filial_id, cpf, nome, ativo, regime_salarial AS regime, salario_base::text AS salario,
           data_admissao::text AS adm, data_desligamento::text AS desl,
           empresa_registro, cnpj_registro, cargo_registro, cbo, matricula_folha
    FROM funcionario WHERE cpf IN ${sql(cpfs)}
  `;
  const porCpf = new Map(cadastro.map((f) => [f.cpf, f]));
  const filiais = await sql<{ id: string; cnpj: string | null }[]>`SELECT id, cnpj FROM filial`;

  // Casa do PDF: pelo nome do departamento; sem departamento, pelo CNPJ da
  // casa; sem os dois (empresa de fora, tipo a Lelis), a casa do cadastro
  // de quem está na folha.
  for (const a of arquivos) {
    const d = a.departamento.toUpperCase();
    if (/\bMAR\b/.test(d)) a.filialId = MAR;
    else if (/TABUAR/.test(d)) a.filialId = TABUARA;
    else if (/PRAINHA/.test(d)) a.filialId = BAR;
    else {
      const casa = filiais.find((f) => f.cnpj === a.cnpj);
      const doCadastro = [...new Set(a.pessoas.map((p) => porCpf.get(p.cpf)?.filial_id).filter(Boolean))];
      if (casa) a.filialId = casa.id;
      else if (doCadastro.length === 1) a.filialId = doCadastro[0] as string;
      else throw new Error(`${a.arquivo}: não sei de que casa é a folha de ${a.empresa} (sem departamento, CNPJ não é de nenhuma casa)`);
    }
  }

  const chaves = new Set<string>();
  for (const a of arquivos) {
    for (const p of a.pessoas) {
      const k = `${a.cnpj}|${a.competencia}|${p.matricula}`;
      if (chaves.has(k)) throw new Error(`${a.arquivo}: código ${p.matricula} repetido na mesma empresa e competência`);
      chaves.add(k);
    }
  }

  let semCadastro = 0;
  for (const a of arquivos) {
    const r = a.resumo;
    console.log(`\n== ${a.arquivo}`);
    console.log(`   ${a.empresa} (${a.cnpj})${a.departamento ? ' · depto ' + a.departamento : ''} · ${a.competencia} → ${NOME_CASA[a.filialId!] ?? a.filialId}`);
    console.log(`   ${r.empregados} empregados (${r.trabalhando} trabalhando, ${r.demitidos} demitidos) · proventos ${brl(r.proventos)} · descontos ${brl(r.descontos)} · líquido ${brl(r.liquido)}`);
    console.log(`   FGTS ${brl(r.fgts)} + rescisório ${brl(r.fgtsRescisorio)} · INSS empresa ${brl(r.inssEmpresa)} · RAT ${brl(r.inssRat)} · terceiros ${brl(r.inssTerceiros)} · leitura confere com o resumo`);
    for (const p of a.pessoas) {
      const f = porCpf.get(p.cpf);
      const avisos: string[] = [];
      if (!f) { avisos.push('SEM CADASTRO'); semCadastro++; }
      else {
        if (f.filial_id !== a.filialId) avisos.push(`cadastro na ${NOME_CASA[f.filial_id] ?? 'outra casa'}`);
        const regime = /intermitente/i.test(p.vinculo ?? '') ? 'intermitente_hora' : 'clt_mensal';
        if (f.regime !== regime) avisos.push(`regime no cadastro: ${f.regime ?? 'vazio'}`);
        if (f.salario === null || centavos(Number(f.salario)) !== centavos(p.salario ?? 0)) avisos.push(`salário no cadastro: ${f.salario ?? 'vazio'}`);
        if (p.demitidoEm && f.desl !== p.demitidoEm) avisos.push(`desligamento no cadastro: ${f.desl ?? 'vazio'}`);
        if (!p.demitidoEm && !f.ativo) avisos.push('cadastro inativo');
      }
      console.log(
        `   ${p.matricula.padStart(4)} ${p.nome.padEnd(46).slice(0, 46)} ${(p.cargo ?? '').padEnd(22).slice(0, 22)} ${brl(p.salario).padStart(9)} ` +
        `prov ${brl(p.proventos).padStart(9)} líq ${brl(p.liquido).padStart(9)}${p.demitidoEm ? ' demitido ' + p.demitidoEm : ''}${avisos.length ? '  ← ' + avisos.join('; ') : ''}`,
      );
    }
  }
  const total = arquivos.reduce((a, x) => a + x.pessoas.length, 0);
  console.log(`\n${total} pessoas em ${arquivos.length} PDF(s); ${semCadastro} sem cadastro no RH.`);

  if (!aplicar) {
    console.log('\nNada foi gravado. Rode de novo com --aplicar pra gravar.');
    await sql.end();
    return;
  }

  let registros = 0;
  await sql.begin(async (tx) => {
    for (const a of arquivos) {
      const r = a.resumo;
      await tx`
        INSERT INTO folha_contador_resumo (
          filial_id, competencia, empresa, cnpj, departamento, empregados, trabalhando, demitidos,
          proventos, descontos, liquido, inss_segurados, inss_empresa, inss_rat, inss_terceiros,
          fgts, fgts_rescisorio, irrf, arquivo, importado_em
        ) VALUES (
          ${a.filialId!}, ${a.competencia}, ${a.empresa}, ${a.cnpj}, ${a.departamento}, ${r.empregados}, ${r.trabalhando}, ${r.demitidos},
          ${r.proventos}, ${r.descontos}, ${r.liquido}, ${r.inssSegurados}, ${r.inssEmpresa}, ${r.inssRat}, ${r.inssTerceiros},
          ${r.fgts}, ${r.fgtsRescisorio}, ${r.irrf}, ${a.arquivo}, now()
        )
        ON CONFLICT (cnpj, competencia, departamento) DO UPDATE SET
          filial_id = excluded.filial_id, empresa = excluded.empresa, empregados = excluded.empregados,
          trabalhando = excluded.trabalhando, demitidos = excluded.demitidos, proventos = excluded.proventos,
          descontos = excluded.descontos, liquido = excluded.liquido, inss_segurados = excluded.inss_segurados,
          inss_empresa = excluded.inss_empresa, inss_rat = excluded.inss_rat, inss_terceiros = excluded.inss_terceiros,
          fgts = excluded.fgts, fgts_rescisorio = excluded.fgts_rescisorio, irrf = excluded.irrf,
          arquivo = excluded.arquivo, importado_em = now()
      `;
      for (const p of a.pessoas) {
        const f = porCpf.get(p.cpf);
        await tx`
          INSERT INTO folha_contador (
            filial_id, funcionario_id, competencia, empresa, cnpj, departamento, matricula, nome, cpf,
            situacao, vinculo, cargo, cbo, data_admissao, horas_mes, salario, proventos, descontos, liquido,
            base_inss, base_fgts, valor_fgts, base_irrf, demitido_em, motivo_demissao, rubricas, arquivo, importado_em
          ) VALUES (
            ${a.filialId!}, ${f?.id ?? null}, ${a.competencia}, ${a.empresa}, ${a.cnpj}, ${a.departamento || null}, ${p.matricula}, ${p.nome}, ${p.cpf},
            ${p.situacao}, ${p.vinculo}, ${p.cargo}, ${p.cbo}, ${p.admissao}, ${p.horasMes}, ${p.salario}, ${p.proventos}, ${p.descontos}, ${p.liquido},
            ${p.baseInss}, ${p.baseFgts}, ${p.valorFgts}, ${p.baseIrrf}, ${p.demitidoEm}, ${p.motivoDemissao},
            ${JSON.stringify(p.rubricas)}::text::jsonb, ${a.arquivo}, now()
          )
          ON CONFLICT (cnpj, competencia, matricula) DO UPDATE SET
            filial_id = excluded.filial_id, funcionario_id = excluded.funcionario_id, empresa = excluded.empresa,
            departamento = excluded.departamento, nome = excluded.nome, cpf = excluded.cpf, situacao = excluded.situacao,
            vinculo = excluded.vinculo, cargo = excluded.cargo, cbo = excluded.cbo, data_admissao = excluded.data_admissao,
            horas_mes = excluded.horas_mes, salario = excluded.salario, proventos = excluded.proventos,
            descontos = excluded.descontos, liquido = excluded.liquido, base_inss = excluded.base_inss,
            base_fgts = excluded.base_fgts, valor_fgts = excluded.valor_fgts, base_irrf = excluded.base_irrf,
            demitido_em = excluded.demitido_em, motivo_demissao = excluded.motivo_demissao, rubricas = excluded.rubricas,
            arquivo = excluded.arquivo, importado_em = now()
        `;
        // Registro em carteira no cadastro: vale a folha mais recente da pessoa.
        if (f) {
          const mudou = await tx`
            UPDATE funcionario SET
              empresa_registro = ${a.empresa}, cnpj_registro = ${a.cnpj}, cargo_registro = ${p.cargo},
              cbo = ${p.cbo}, matricula_folha = ${p.matricula}, atualizado_em = now()
            WHERE id = ${f.id}
              AND NOT EXISTS (
                SELECT 1 FROM folha_contador fc WHERE fc.funcionario_id = ${f.id} AND fc.competencia > ${a.competencia}
              )
              AND (empresa_registro, cnpj_registro, cargo_registro, cbo, matricula_folha)
                  IS DISTINCT FROM (${a.empresa}::varchar, ${a.cnpj}::varchar, ${p.cargo}::varchar, ${p.cbo}::varchar, ${p.matricula}::varchar)
            RETURNING id
          `;
          registros += mudou.length;
        }
      }
    }
  });
  console.log(`\nGravado: ${total} linhas em folha_contador, ${arquivos.length} em folha_contador_resumo, registro em carteira atualizado em ${registros} cadastros.`);
  await sql.end();
}
main().catch(async (e) => { console.error(e.message ?? e); await sql.end({ timeout: 2 }).catch(() => {}); process.exit(1); });
