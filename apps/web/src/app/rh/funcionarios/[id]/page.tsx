// Ficha do funcionário — tudo de UMA pessoa numa tela só: cadastro, registro em
// carteira, folha do contador, folha semanal, ponto, banco de horas e o ponto
// antigo (Stelanto). Abre clicando no nome em /rh/funcionarios.
//
// Só leitura: cada bloco tem o link pra tela onde aquilo se edita. As contas
// são as mesmas das telas de origem (banco de horas = /rh/banco-horas; folha
// semanal fechada = as conta_pagar geradas no fechamento, como lib/folha/snapshot).
//
// Quem vê o quê: a ficha abre com `funcionario.read` (a mesma da lista, que já
// mostra salário e acordo); holerite e folha semanal só com `folha_equipe.read`;
// ponto, banco de horas e Stelanto só com `ponto.read`. O descritor do rosto
// nunca sai do banco — a ficha só diz se a pessoa tem rosto cadastrado.

import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import type { RubricaFolhaContador } from '@concilia/db/schema';
import { and, asc, desc, eq, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, formatFone } from '@/lib/format';
import { diasAtrasBr, hojeBr } from '@/lib/datas';
import { calcularDia } from '@/lib/rh/calcular-ponto';
import { pontoProprioDesde } from '@/lib/rh/ponto-vigencia';
import { horaMinutoBr, somarDias } from '@/lib/rh/dia-operacional';
import {
  fmtHoras,
  fmtSaldo,
  folgasDaJornada,
  jornadaNoDia,
  minutosPrevistos,
  minutosSemana,
  type VigenciaJornada,
} from '@/lib/rh/banco-horas';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESES = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const REGIME_LABEL: Record<string, string> = { clt_mensal: 'CLT mensal', intermitente_hora: 'Intermitente' };
const PAPEL_LABEL: Record<string, string> = { funcionario: 'Funcionário', diarista: 'Diarista', gerente: 'Gerente' };
const LANCAMENTO_LABEL: Record<string, string> = {
  saldo_inicial: 'Saldo do Stelanto',
  ajuste: 'Acerto',
  pagamento: 'Horas pagas',
  folga: 'Folga compensada',
};
const STELANTO_STATUS: Record<string, string> = { ACTIVE: 'ativo', DISABLED: 'desativado' };

const num = (v: string | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

function fmtData(iso: string | null): string {
  if (!iso) return '—';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}
function diaCurto(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')} ${SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()]}`;
}
function fmtCpf(cpf: string | null): string {
  if (!cpf) return '—';
  if (cpf.length !== 11) return cpf;
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}
function fmtCnpj(d: string | null): string {
  if (!d) return '—';
  if (d.length !== 14) return d;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
function nomeComp(comp: string): string {
  const [a, m] = comp.split('-');
  return `${MESES[Number(m)] ?? m}/${a}`;
}
function mesCurto(ym: string): string {
  const [a, m] = ym.split('-');
  return `${MESES_CURTOS[Number(m) - 1] ?? m}/${a.slice(2)}`;
}
/** '2 anos e 3 meses' entre duas datas de calendário. */
function tempoEntre(de: string, ate: string): string {
  const [a1, m1, d1] = de.split('-').map(Number);
  const [a2, m2, d2] = ate.split('-').map(Number);
  let meses = (a2 - a1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  if (meses < 0) meses = 0;
  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  const partes: string[] = [];
  if (anos > 0) partes.push(`${anos} ano${anos > 1 ? 's' : ''}`);
  if (resto > 0) partes.push(`${resto} ${resto > 1 ? 'meses' : 'mês'}`);
  return partes.length ? partes.join(' e ') : 'menos de 1 mês';
}
function corSaldo(min: number): string {
  if (min > 0) return 'text-emerald-700';
  if (min < 0) return 'text-rose-700';
  return 'text-slate-900';
}

interface Acordo {
  papel: string | null;
  gerenteModelo: string | null;
  gerenteValorFixoDia: string | null;
  diaristaModelo: string | null;
  diaristaTaxaHoraOverride: string | null;
  diaristaValorFixoDia: string | null;
  bonusFixoSemanal: string | null;
  bonusPorDia: string | null;
}
/** Mesma leitura do "resumo do acordo" da lista de funcionários. */
function resumoAcordo(pg: Acordo): string {
  if (!pg.papel) return 'sem acordo na folha semanal';
  const partes = [PAPEL_LABEL[pg.papel] ?? pg.papel];
  if (pg.papel === 'gerente') {
    partes.push(pg.gerenteModelo === 'fixo_por_dia' ? `${brl(pg.gerenteValorFixoDia)}/dia` : '1pp do 10%');
  }
  if (pg.papel === 'diarista') {
    if (pg.diaristaModelo === 'fixo_por_dia' && pg.diaristaValorFixoDia) partes.push(`${brl(pg.diaristaValorFixoDia)}/dia`);
    else if (pg.diaristaTaxaHoraOverride) partes.push(`${brl(pg.diaristaTaxaHoraOverride)}/h`);
    else partes.push('R$/h padrão');
  }
  if (num(pg.bonusPorDia) > 0) partes.push(`bônus ${brl(pg.bonusPorDia)}/dia`);
  if (num(pg.bonusFixoSemanal) > 0) partes.push(`bônus ${brl(pg.bonusFixoSemanal)}/semana`);
  return partes.join(' · ');
}

function Bloco({
  titulo,
  sub,
  link,
  children,
}: {
  titulo: string;
  sub?: React.ReactNode;
  link?: { href: string; texto: string };
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{titulo}</h2>
          {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
        </div>
        {link && (
          <a href={link.href} className="text-xs font-medium text-blue-700 hover:underline">
            {link.texto} →
          </a>
        )}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{rotulo}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{children}</dd>
    </div>
  );
}

function KPI({ label, valor, sub, cor }: { label: string; valor: string; sub?: string; cor?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${cor ?? 'text-slate-900'}`}>{valor}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

function Selo({ cor, children }: { cor: 'green' | 'red' | 'amber' | 'slate'; children: React.ReactNode }) {
  const classe =
    cor === 'green'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : cor === 'red'
        ? 'border-red-200 bg-red-50 text-red-700'
        : cor === 'amber'
          ? 'border-amber-200 bg-amber-50 text-amber-800'
          : 'border-slate-200 bg-slate-50 text-slate-600';
  return <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] ${classe}`}>{children}</span>;
}

export default async function FichaFuncionarioPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'funcionario.read');
  if (!UUID.test(id)) notFound();

  const [pessoa] = await db
    .select({
      id: schema.funcionario.id,
      filialId: schema.funcionario.filialId,
      nome: schema.funcionario.nome,
      cpf: schema.funcionario.cpf,
      dataNascimento: schema.funcionario.dataNascimento,
      telefone: schema.funcionario.telefone,
      endereco: schema.funcionario.endereco,
      cargo: schema.funcionario.cargo,
      setor: schema.funcionario.setor,
      dataAdmissao: schema.funcionario.dataAdmissao,
      dataDesligamento: schema.funcionario.dataDesligamento,
      motivoDesligamento: schema.funcionario.motivoDesligamento,
      ativo: schema.funcionario.ativo,
      regimeSalarial: schema.funcionario.regimeSalarial,
      salarioBase: schema.funcionario.salarioBase,
      empresaRegistro: schema.funcionario.empresaRegistro,
      cnpjRegistro: schema.funcionario.cnpjRegistro,
      cargoRegistro: schema.funcionario.cargoRegistro,
      cbo: schema.funcionario.cbo,
      matriculaFolha: schema.funcionario.matriculaFolha,
      loginLocal: schema.funcionario.loginLocal,
      fornecedorId: schema.funcionario.fornecedorId,
      gemeoDeId: schema.funcionario.gemeoDeId,
      precisaRevisao: schema.funcionario.precisaRevisao,
      observacao: schema.funcionario.observacao,
      // Só o sim/não: o descritor em si não sai do banco.
      temRosto: sql<boolean>`${schema.funcionario.faceDescriptor} IS NOT NULL`,
    })
    .from(schema.funcionario)
    .where(eq(schema.funcionario.id, id))
    .limit(1);
  if (!pessoa) notFound();
  const f = pessoa;

  // Só abre a ficha de quem é de uma casa que o usuário enxerga (lotação
  // principal ou casa onde a pessoa circula) — a mesma régua da lista.
  const filiais = await filiaisDoUsuario(user.id);
  const idsFiliais = filiais.map((x) => x.id);
  const extras = await db
    .select({ filialId: schema.funcionarioFilialExtra.filialId })
    .from(schema.funcionarioFilialExtra)
    .where(eq(schema.funcionarioFilialExtra.funcionarioId, f.id));
  const casasDaPessoa = [f.filialId, ...extras.map((e) => e.filialId)];
  if (!casasDaPessoa.some((c) => idsFiliais.includes(c))) notFound();

  const nomeFilial = new Map(filiais.map((x) => [x.id, x.nome]));
  const casa = (filialId: string | null) => (filialId ? nomeFilial.get(filialId) ?? 'outra loja' : '—');
  // Casa pra onde os links apontam: a da lotação se o usuário a enxerga.
  const filialLink = idsFiliais.includes(f.filialId) ? f.filialId : casasDaPessoa.find((c) => idsFiliais.includes(c))!;

  const [veFolha, vePonto] = await Promise.all([
    podeUsuario(user.id, 'folha_equipe.read'),
    podeUsuario(user.id, 'ponto.read'),
  ]);

  const hoje = hojeBr();

  const [gemeo] = f.gemeoDeId
    ? await db.select({ nome: schema.funcionario.nome }).from(schema.funcionario).where(eq(schema.funcionario.id, f.gemeoDeId)).limit(1)
    : [];

  // ---- Folha semanal: o "fornecedor" da pessoa em cada casa (pelo vínculo do
  // cadastro e pelo CPF, como a lista faz) e o acordo daquela casa.
  const cpfFornecedor = sql`regexp_replace(coalesce(${schema.fornecedor.cnpjOuCpf}, ''), '[^0-9]', '', 'g')`;
  const filtroForn = [
    ...(f.fornecedorId ? [eq(schema.fornecedor.id, f.fornecedorId)] : []),
    ...(f.cpf ? [and(isNull(schema.fornecedor.dataDelete), sql`${cpfFornecedor} = ${f.cpf}`)] : []),
  ];
  const fornecedores = filtroForn.length
    ? await db
        .select({
          id: schema.fornecedor.id,
          filialId: schema.fornecedor.filialId,
          chavePix: schema.fornecedor.chavePix,
          bancoNome: schema.fornecedor.bancoNome,
          bancoAgencia: schema.fornecedor.bancoAgencia,
          bancoConta: schema.fornecedor.bancoConta,
          papel: schema.fornecedorFolha.papel,
          naFolha: schema.fornecedorFolha.ativo,
          gerenteModelo: schema.fornecedorFolha.gerenteModelo,
          gerenteValorFixoDia: schema.fornecedorFolha.gerenteValorFixoDia,
          diaristaModelo: schema.fornecedorFolha.diaristaModelo,
          diaristaTaxaHoraOverride: schema.fornecedorFolha.diaristaTaxaHoraOverride,
          diaristaValorFixoDia: schema.fornecedorFolha.diaristaValorFixoDia,
          bonusFixoSemanal: schema.fornecedorFolha.bonusFixoSemanal,
          bonusPorDia: schema.fornecedorFolha.bonusPorDia,
        })
        .from(schema.fornecedor)
        .leftJoin(schema.fornecedorFolha, eq(schema.fornecedorFolha.fornecedorId, schema.fornecedor.id))
        .where(and(inArray(schema.fornecedor.filialId, idsFiliais), or(...filtroForn)))
    : [];
  const fornIds = fornecedores.map((x) => x.id);
  const acordos = fornecedores.filter((x) => x.papel);
  const pix = fornecedores.find((x) => x.chavePix) ?? null;
  const banco = fornecedores.find((x) => x.bancoNome || x.bancoConta) ?? null;

  // Folhas FECHADAS: o retrato do que foi fechado são as contas geradas no
  // fechamento (folha aberta ainda não tem conta; cancelada não conta).
  const contasFolha =
    veFolha && fornIds.length
      ? await db
          .select({
            folhaId: schema.folhaSemana.id,
            filialId: schema.folhaSemana.filialId,
            inicio: schema.folhaSemana.dataInicio,
            fim: schema.folhaSemana.dataFim,
            descricao: schema.contaPagar.descricao,
            observacao: schema.contaPagar.observacao,
            valor: schema.contaPagar.valor,
            descontos: schema.contaPagar.descontos,
            baixadaEm: schema.contaPagar.dataPagamento,
          })
          .from(schema.contaPagar)
          .innerJoin(schema.folhaSemana, eq(schema.folhaSemana.id, schema.contaPagar.folhaSemanaId))
          .where(
            and(
              inArray(schema.contaPagar.fornecedorId, fornIds),
              isNull(schema.contaPagar.dataDelete),
              ne(schema.folhaSemana.status, 'cancelada'),
            ),
          )
          .orderBy(desc(schema.folhaSemana.dataInicio), asc(schema.contaPagar.descricao))
      : [];
  interface SemanaFolha {
    folhaId: string;
    filialId: string;
    inicio: string;
    fim: string;
    total: number;
    baixadaEm: string | null;
    semBaixa: number;
    itens: { rotulo: string; valor: number; obs: string | null }[];
  }
  const semanas: SemanaFolha[] = [];
  const semanaPorId = new Map<string, SemanaFolha>();
  for (const c of contasFolha) {
    let s = semanaPorId.get(c.folhaId);
    if (!s) {
      s = { folhaId: c.folhaId, filialId: c.filialId, inicio: c.inicio, fim: c.fim, total: 0, baixadaEm: null, semBaixa: 0, itens: [] };
      semanaPorId.set(c.folhaId, s);
      semanas.push(s);
    }
    const liquido = Math.round((num(c.valor) - num(c.descontos)) * 100) / 100;
    s.total += liquido;
    if (c.baixadaEm) {
      if (!s.baixadaEm || c.baixadaEm > s.baixadaEm) s.baixadaEm = c.baixadaEm;
    } else {
      s.semBaixa++;
    }
    // "Diária semana — FULANO DE TAL" → "Diária semana"
    s.itens.push({ rotulo: (c.descricao ?? 'Lançamento').split(' — ')[0], valor: liquido, obs: c.observacao });
  }
  const anoAtual = hoje.slice(0, 4);
  const totalAno = semanas.filter((s) => s.fim.slice(0, 4) === anoAtual).reduce((t, s) => t + s.total, 0);
  const ultimas4 = semanas.slice(0, 4);
  const total4 = ultimas4.reduce((t, s) => t + s.total, 0);

  // ---- Folha do contador (holerite), todas as competências da pessoa.
  const holerites = veFolha
    ? await db
        .select({
          id: schema.folhaContador.id,
          filialId: schema.folhaContador.filialId,
          competencia: schema.folhaContador.competencia,
          empresa: schema.folhaContador.empresa,
          departamento: schema.folhaContador.departamento,
          situacao: schema.folhaContador.situacao,
          vinculo: schema.folhaContador.vinculo,
          cargo: schema.folhaContador.cargo,
          horasMes: schema.folhaContador.horasMes,
          salario: schema.folhaContador.salario,
          proventos: schema.folhaContador.proventos,
          descontos: schema.folhaContador.descontos,
          liquido: schema.folhaContador.liquido,
          valorFgts: schema.folhaContador.valorFgts,
          demitidoEm: schema.folhaContador.demitidoEm,
          motivoDemissao: schema.folhaContador.motivoDemissao,
          rubricas: schema.folhaContador.rubricas,
        })
        .from(schema.folhaContador)
        .where(and(eq(schema.folhaContador.funcionarioId, f.id), inArray(schema.folhaContador.filialId, idsFiliais)))
        .orderBy(desc(schema.folhaContador.competencia))
    : [];

  // ---- Ponto próprio, escala e banco de horas (mesma conta de /rh/banco-horas).
  const virada = pontoProprioDesde(f.filialId);
  const desde30 = diasAtrasBr(30);
  const [batidas, vigRows, lancamentos] = vePonto
    ? await Promise.all([
        db
          .select({
            filialId: schema.pontoBatida.filialId,
            dia: schema.pontoBatida.diaOperacional,
            quando: schema.pontoBatida.quando,
            tipo: schema.pontoBatida.tipo,
          })
          .from(schema.pontoBatida)
          .where(
            and(
              eq(schema.pontoBatida.funcionarioId, f.id),
              gte(schema.pontoBatida.diaOperacional, virada < desde30 ? virada : desde30),
              isNull(schema.pontoBatida.excluidaEm),
            ),
          )
          .orderBy(asc(schema.pontoBatida.quando)),
        db
          .select({
            jornadaId: schema.rhJornada.id,
            vigenteDesde: schema.funcionarioJornada.vigenteDesde,
            nome: schema.rhJornada.nome,
            tipo: schema.rhJornada.tipo,
            minSeg: schema.rhJornada.minSeg,
            minTer: schema.rhJornada.minTer,
            minQua: schema.rhJornada.minQua,
            minQui: schema.rhJornada.minQui,
            minSex: schema.rhJornada.minSex,
            minSab: schema.rhJornada.minSab,
            minDom: schema.rhJornada.minDom,
          })
          .from(schema.funcionarioJornada)
          .innerJoin(schema.rhJornada, eq(schema.rhJornada.id, schema.funcionarioJornada.jornadaId))
          .where(and(eq(schema.funcionarioJornada.funcionarioId, f.id), eq(schema.rhJornada.ativo, true))),
        db
          .select({
            id: schema.bancoHorasLancamento.id,
            dia: schema.bancoHorasLancamento.dia,
            minutos: schema.bancoHorasLancamento.minutos,
            tipo: schema.bancoHorasLancamento.tipo,
            descricao: schema.bancoHorasLancamento.descricao,
          })
          .from(schema.bancoHorasLancamento)
          .where(eq(schema.bancoHorasLancamento.funcionarioId, f.id))
          .orderBy(asc(schema.bancoHorasLancamento.dia), asc(schema.bancoHorasLancamento.criadoEm)),
      ])
    : [[], [], []];

  // dia|casa -> batidas; depois o total do dia somando as casas.
  const porCasaDia = new Map<string, { quando: Date; tipo: 'entrada' | 'saida' }[]>();
  for (const b of batidas) {
    const k = `${b.dia}|${b.filialId}`;
    const lista = porCasaDia.get(k) ?? [];
    lista.push({ quando: b.quando, tipo: b.tipo as 'entrada' | 'saida' });
    porCasaDia.set(k, lista);
  }
  const trabalhado = new Map<string, { min: number; incompleto: boolean }>();
  const diasPonto: { dia: string; filialId: string; min: number; incompleto: boolean; batidas: string }[] = [];
  for (const [k, lista] of porCasaDia) {
    const [dia, filialId] = k.split('|');
    const calc = calcularDia(lista);
    const incompleto = calc.status === 'incompleto' || calc.orfas > 0;
    const at = trabalhado.get(dia) ?? { min: 0, incompleto: false };
    at.min += calc.totalMin;
    if (incompleto) at.incompleto = true;
    trabalhado.set(dia, at);
    diasPonto.push({
      dia,
      filialId,
      min: calc.totalMin,
      incompleto,
      batidas: lista.map((b) => `${b.tipo === 'entrada' ? 'E' : 'S'} ${horaMinutoBr(b.quando)}`).join(' · '),
    });
  }
  const recentes = diasPonto.filter((d) => d.dia >= desde30).sort((a, b) => (a.dia < b.dia ? 1 : -1));
  const min30 = recentes.reduce((t, d) => t + d.min, 0);
  const dias30 = new Set(recentes.map((d) => d.dia)).size;
  const incompletos30 = recentes.filter((d) => d.incompleto).length;

  const vigencias: VigenciaJornada[] = vigRows.map((v) => ({ ...v }));
  const jornadaAtual = jornadaNoDia(vigencias, hoje);
  const inicial = lancamentos.find((l) => l.tipo === 'saldo_inicial') ?? null;
  const acertosMin = lancamentos.filter((l) => l.tipo !== 'saldo_inicial').reduce((t, l) => t + l.minutos, 0);
  // A conta começa na virada, na primeira escala ou na admissão — o que vier por último.
  const primeiraVigencia = vigencias.map((v) => v.vigenteDesde).sort()[0] ?? null;
  let contaDesde = virada;
  if (primeiraVigencia && primeiraVigencia > contaDesde) contaDesde = primeiraVigencia;
  if (f.dataAdmissao && f.dataAdmissao > contaDesde) contaDesde = f.dataAdmissao;
  const ontem = somarDias(hoje, -1);
  let previstoMin = 0;
  let trabalhadoViradaMin = 0;
  let trabalhadoNaContaMin = 0;
  let semBatidaDias = 0;
  let semBatidaMin = 0;
  // Desligado não tem previsto correndo: o banco para de contar.
  if (f.ativo) {
    for (let dia = virada; dia <= ontem; dia = somarDias(dia, 1)) {
      const t = trabalhado.get(dia);
      if (t) trabalhadoViradaMin += t.min;
      if (dia < contaDesde) continue;
      if (t) trabalhadoNaContaMin += t.min;
      const j = jornadaNoDia(vigencias, dia);
      const prev = j ? minutosPrevistos(j, dia) : 0;
      previstoMin += prev;
      if (prev > 0 && !t) {
        semBatidaDias++;
        semBatidaMin += prev;
      }
    }
  }
  const temBanco = f.ativo && jornadaAtual?.tipo === 'fixa';
  const movimentoMin = temBanco ? trabalhadoNaContaMin - previstoMin : 0;
  const saldoMin = (inicial?.minutos ?? 0) + acertosMin + movimentoMin;

  // ---- Ponto antigo (Stelanto): o arquivo importado, por mês.
  const stelanto = vePonto
    ? await db
        .select({
          id: schema.stelantoColaborador.id,
          filialId: schema.stelantoColaborador.filialId,
          status: schema.stelantoColaborador.status,
          equipe: schema.stelantoColaborador.equipe,
          jornada: schema.stelantoColaborador.jornada,
          primeiroDia: schema.stelantoColaborador.primeiroDia,
          ultimoDia: schema.stelantoColaborador.ultimoDia,
          diasTrabalhados: schema.stelantoColaborador.diasTrabalhados,
        })
        .from(schema.stelantoColaborador)
        .where(eq(schema.stelantoColaborador.funcionarioId, f.id))
    : [];
  const stelantoMeses = stelanto.length
    ? await db
        .select({
          colaboradorId: schema.stelantoDia.colaboradorId,
          mes: sql<string>`to_char(${schema.stelantoDia.dia}, 'YYYY-MM')`,
          trabalhadoSeg: sql<number>`sum(${schema.stelantoDia.trabalhadoSeg})::int`,
          dias: sql<number>`count(*) FILTER (WHERE ${schema.stelantoDia.batidas} IS NOT NULL)::int`,
        })
        .from(schema.stelantoDia)
        .where(inArray(schema.stelantoDia.colaboradorId, stelanto.map((s) => s.id)))
        .groupBy(sql`1, 2`)
        .orderBy(sql`1, 2`)
    : [];

  const salarioTxt = f.salarioBase
    ? `${brl(f.salarioBase)}${f.regimeSalarial === 'intermitente_hora' ? ' por hora' : ' por mês'}`
    : '—';
  const fimDoVinculo = f.ativo ? hoje : f.dataDesligamento ?? hoje;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        <div>
          <a href={`/rh/funcionarios?filialId=${filialLink}`} className="text-xs font-medium text-blue-700 hover:underline">
            ← Funcionários
          </a>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{f.nome}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-slate-600">
                {f.ativo ? <Selo cor="green">ativo</Selo> : <Selo cor="red">desligado em {fmtData(f.dataDesligamento)}</Selo>}
                {f.precisaRevisao && <Selo cor="amber">cadastro pra revisar</Selo>}
                <span>
                  {[f.cargo, f.setor, casa(f.filialId)].filter(Boolean).join(' · ')}
                </span>
              </p>
            </div>
            <a
              href={`/rh/funcionarios?filialId=${filialLink}${f.ativo ? `&editar=${f.id}#f-${f.id}` : ''}`}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              {f.ativo ? 'Editar cadastro' : 'Ver na lista (desligados)'}
            </a>
          </div>
        </div>

        <Bloco titulo="Cadastro">
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Campo rotulo="CPF">{fmtCpf(f.cpf)}</Campo>
            <Campo rotulo="Telefone">{f.telefone ? formatFone(f.telefone) : '—'}</Campo>
            <Campo rotulo="Nascimento">{fmtData(f.dataNascimento)}</Campo>
            <Campo rotulo="Cargo na casa">{f.cargo ?? '—'}</Campo>
            <Campo rotulo="Setor">{f.setor ?? '—'}</Campo>
            <Campo rotulo="Casa">
              {casa(f.filialId)}
              {extras.length > 0 && (
                <span className="text-slate-500"> · também em {extras.map((e) => casa(e.filialId)).join(', ')}</span>
              )}
            </Campo>
            <Campo rotulo="Admissão">
              {fmtData(f.dataAdmissao)}
              {f.dataAdmissao && (
                <span className="text-slate-500"> · {tempoEntre(f.dataAdmissao, fimDoVinculo)}{f.ativo ? ' de casa' : ''}</span>
              )}
            </Campo>
            {!f.ativo && (
              <Campo rotulo="Desligamento">
                {fmtData(f.dataDesligamento)}
                {f.motivoDesligamento && <span className="text-slate-500"> · {f.motivoDesligamento}</span>}
              </Campo>
            )}
            <Campo rotulo="Ponto facial">
              {f.temRosto ? 'rosto cadastrado' : 'sem rosto cadastrado'}
              {gemeo && <span className="text-slate-500"> · gêmeo(a) de {gemeo.nome}</span>}
            </Campo>
            <Campo rotulo="Login no PDV">{f.loginLocal ?? '—'}</Campo>
            <div className="sm:col-span-2 lg:col-span-3">
              <Campo rotulo="Endereço">{f.endereco ?? '—'}</Campo>
            </div>
            {f.observacao && (
              <div className="sm:col-span-2 lg:col-span-3">
                <Campo rotulo="Observação">{f.observacao}</Campo>
              </div>
            )}
          </dl>
        </Bloco>

        <Bloco titulo="Registro em carteira" sub="Como está na folha do contador — a empresa que assina a carteira pode não ser a da casa.">
          {f.empresaRegistro || f.regimeSalarial || f.salarioBase ? (
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <Campo rotulo="Empresa">{f.empresaRegistro ?? '—'}</Campo>
              <Campo rotulo="CNPJ">{fmtCnpj(f.cnpjRegistro)}</Campo>
              <Campo rotulo="Código na folha">{f.matriculaFolha ?? '—'}</Campo>
              <Campo rotulo="Cargo na carteira">
                {f.cargoRegistro ?? '—'}
                {f.cbo && <span className="text-slate-500"> · CBO {f.cbo}</span>}
              </Campo>
              <Campo rotulo="Regime">{f.regimeSalarial ? REGIME_LABEL[f.regimeSalarial] ?? f.regimeSalarial : '—'}</Campo>
              <Campo rotulo="Salário">{salarioTxt}</Campo>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">Sem registro em carteira no cadastro (não apareceu em nenhuma folha do contador importada).</p>
          )}
        </Bloco>

        {veFolha && (
          <Bloco
            titulo="Folha do contador"
            sub="O holerite de cada mês, do jeito que veio no extrato do contador."
            link={{ href: `/rh/folha-contador?filialId=${filialLink}`, texto: 'Folha do contador' }}
          >
            {holerites.length === 0 ? (
              <p className="text-sm text-slate-500">Não está em nenhuma folha do contador importada.</p>
            ) : (
              <div className="space-y-2">
                {holerites.map((h, i) => (
                  <details key={h.id} open={i === 0} className="rounded-lg border border-slate-200">
                    <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-sm">
                      <span>
                        <b className="text-slate-900">{nomeComp(h.competencia)}</b>
                        <span className="text-slate-500">
                          {' '}· {h.empresa}
                          {h.departamento ? ` — ${h.departamento}` : ''}
                          {h.situacao ? ` · ${h.situacao}` : ''}
                        </span>
                      </span>
                      <span className="text-slate-900">
                        líquido <b>{brl(h.liquido)}</b>
                      </span>
                    </summary>
                    <div className="border-t border-slate-100 px-4 py-3">
                      <p className="text-xs text-slate-500">
                        {[
                          h.vinculo,
                          h.cargo,
                          h.salario ? `salário ${brl(h.salario)}${(h.vinculo ?? '').includes('Intermitente') ? '/h' : ''}` : null,
                          num(h.horasMes) > 0 ? `${num(h.horasMes)} h no mês` : null,
                          num(h.valorFgts) > 0 ? `FGTS ${brl(h.valorFgts)}` : null,
                          h.demitidoEm ? `demitido em ${fmtData(h.demitidoEm)}${h.motivoDemissao ? ` (${h.motivoDemissao})` : ''}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      <table className="mt-2 w-full text-sm">
                        <tbody className="divide-y divide-slate-100">
                          {(h.rubricas as RubricaFolhaContador[]).map((r, k) => (
                            <tr key={k}>
                              <td className="py-1 text-slate-700">{r.descricao}</td>
                              <td className="py-1 text-right text-xs text-slate-400">{r.referencia ? r.referencia.toLocaleString('pt-BR') : ''}</td>
                              <td className={`py-1 text-right tabular-nums ${r.tipo === 'D' ? 'text-rose-700' : 'text-slate-900'}`}>
                                {r.tipo === 'D' ? '−' : ''}
                                {brl(r.valor)}
                              </td>
                            </tr>
                          ))}
                          <tr className="font-medium">
                            <td className="py-1.5 text-slate-900">
                              Proventos {brl(h.proventos)} − descontos {brl(h.descontos)}
                            </td>
                            <td />
                            <td className="py-1.5 text-right tabular-nums text-slate-900">{brl(h.liquido)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </Bloco>
        )}

        <Bloco
          titulo="Folha semanal da casa"
          sub="Diária, rateio dos 10% e bônus — o acordo é por casa."
          link={veFolha ? { href: '/folha-equipe/folhas', texto: 'Folhas semanais' } : undefined}
        >
          {acordos.length === 0 ? (
            <p className="text-sm text-slate-500">Sem acordo na folha semanal de nenhuma casa.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {acordos.map((a) => (
                <li key={a.id} className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium text-slate-900">{casa(a.filialId)}</span>
                  <span className="text-slate-700">{resumoAcordo(a)}</span>
                  {a.naFolha === false && <Selo cor="slate">fora da folha</Selo>}
                </li>
              ))}
            </ul>
          )}
          {(pix || banco) && (
            <p className="mt-2 text-xs text-slate-500">
              {pix && <>PIX {pix.chavePix}</>}
              {pix && banco && ' · '}
              {banco && <>{[banco.bancoNome, banco.bancoAgencia && `ag. ${banco.bancoAgencia}`, banco.bancoConta && `conta ${banco.bancoConta}`].filter(Boolean).join(' ')}</>}
            </p>
          )}

          {veFolha && semanas.length > 0 && (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <KPI label="Últimas 4 folhas" valor={brl(total4)} sub={`média ${brl(total4 / ultimas4.length)} por semana`} />
                <KPI label={`Em ${anoAtual}`} valor={brl(totalAno)} sub="folhas fechadas no ano" />
                <KPI label="Folhas fechadas" valor={String(semanas.length)} sub={`desde ${fmtData(semanas[semanas.length - 1].inicio)}`} />
              </div>
              <TabelaSemanas semanas={semanas.slice(0, 8)} casa={casa} />
              {semanas.length > 8 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-blue-700">
                    ver as {semanas.length - 8} folhas anteriores
                  </summary>
                  <TabelaSemanas semanas={semanas.slice(8)} casa={casa} />
                </details>
              )}
            </>
          )}
          {veFolha && semanas.length === 0 && acordos.length > 0 && (
            <p className="mt-3 text-sm text-slate-500">Ainda não entrou em nenhuma folha semanal fechada.</p>
          )}
        </Bloco>

        {vePonto && (
          <Bloco
            titulo="Banco de horas e escala"
            link={{ href: `/rh/banco-horas?filialId=${filialLink}`, texto: 'Banco de horas' }}
          >
            {!jornadaAtual ? (
              <p className="text-sm text-slate-500">
                Sem escala definida — sem escala não há previsto pra comparar. Defina em Banco de horas.
              </p>
            ) : (
              <p className="text-sm text-slate-700">
                <b className="text-slate-900">{jornadaAtual.nome}</b>
                {jornadaAtual.tipo === 'fixa' && <> · {fmtHoras(minutosSemana(jornadaAtual))}/semana</>} · {folgasDaJornada(jornadaAtual)}
                <span className="text-slate-500"> · vale desde {fmtData(jornadaAtual.vigenteDesde)}</span>
              </p>
            )}
            {!f.ativo ? (
              <p className="mt-2 text-sm text-slate-500">Desligado: o banco de horas parou de contar.</p>
            ) : temBanco ? (
              <>
                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <KPI label="Saldo hoje" valor={fmtSaldo(saldoMin)} cor={corSaldo(saldoMin)} sub="contado até ontem" />
                  <KPI
                    label="Veio do Stelanto"
                    valor={inicial ? fmtSaldo(inicial.minutos) : '—'}
                    sub={inicial ? `saldo em ${fmtData(inicial.dia)}` : 'sem saldo de virada'}
                  />
                  <KPI label="Acertos" valor={fmtSaldo(acertosMin)} sub="ajuste, horas pagas, folga" />
                  <KPI
                    label={`Desde ${fmtData(contaDesde).slice(0, 5)}`}
                    valor={fmtSaldo(movimentoMin)}
                    sub={`${fmtHoras(trabalhadoNaContaMin)} trabalhadas − ${fmtHoras(previstoMin)} previstas`}
                  />
                </div>
                {semBatidaDias > 0 && (
                  <p className="mt-2 text-xs text-amber-700">
                    {fmtHoras(semBatidaMin)} do que falta são {semBatidaDias} dia(s) de escala sem nenhuma batida (folga trocada,
                    falta ou esqueceu de bater — conferir no ponto).
                  </p>
                )}
              </>
            ) : jornadaAtual ? (
              <p className="mt-2 text-sm text-slate-500">
                Intermitente não tem banco: recebe pelas horas trabalhadas. Desde {fmtData(virada)} foram{' '}
                <b className="text-slate-700">{fmtHoras(trabalhadoViradaMin)}</b> no ponto.
              </p>
            ) : null}
            {lancamentos.length > 0 && (
              <table className="mt-3 w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {lancamentos.map((l) => (
                    <tr key={l.id}>
                      <td className="py-1 text-slate-500">{fmtData(l.dia)}</td>
                      <td className="py-1 text-slate-700">{LANCAMENTO_LABEL[l.tipo] ?? l.tipo}</td>
                      <td className="py-1 text-slate-500">{l.tipo === 'saldo_inicial' ? '' : l.descricao}</td>
                      <td className={`py-1 text-right tabular-nums ${corSaldo(l.minutos)}`}>{fmtSaldo(l.minutos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Bloco>
        )}

        {vePonto && (
          <Bloco
            titulo="Ponto — últimos 30 dias"
            sub="Batidas do ponto próprio, em qualquer casa."
            link={{ href: `/rh/ponto?filialId=${filialLink}`, texto: 'Ponto da semana' }}
          >
            {recentes.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhuma batida nos últimos 30 dias.</p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <KPI label="Horas" valor={fmtHoras(min30)} sub="só batida com entrada e saída" />
                  <KPI label="Dias com ponto" valor={String(dias30)} />
                  <KPI
                    label="Dias incompletos"
                    valor={String(incompletos30)}
                    cor={incompletos30 > 0 ? 'text-amber-700' : undefined}
                    sub="entrada sem saída (ou o contrário)"
                  />
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="py-1.5 font-medium">Dia</th>
                        <th className="py-1.5 font-medium">Casa</th>
                        <th className="py-1.5 font-medium">Batidas</th>
                        <th className="py-1.5 text-right font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {recentes.map((d) => (
                        <tr key={`${d.dia}|${d.filialId}`}>
                          <td className="whitespace-nowrap py-1.5 text-slate-700">
                            {diaCurto(d.dia)}
                            {d.dia === hoje && <span className="ml-1 text-[11px] text-slate-400">hoje</span>}
                          </td>
                          <td className="py-1.5 text-slate-500">{casa(d.filialId)}</td>
                          <td className="py-1.5 text-slate-700">
                            {d.batidas}
                            {d.incompleto && d.dia !== hoje && (
                              <span className="ml-1.5">
                                <Selo cor="amber">incompleto</Selo>
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-slate-900">{d.min > 0 ? fmtHoras(d.min) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Bloco>
        )}

        {vePonto && stelanto.length > 0 && (
          <Bloco
            titulo="Ponto antigo (Stelanto)"
            sub="O arquivo importado do sistema anterior, até a virada pro ponto próprio. Clique no mês pra ver dia a dia."
          >
            <div className="space-y-4">
              {stelanto.map((s) => {
                const meses = stelantoMeses.filter((m) => m.colaboradorId === s.id && m.dias > 0);
                const totalSeg = meses.reduce((t, m) => t + m.trabalhadoSeg, 0);
                const filialHist = s.filialId && idsFiliais.includes(s.filialId) ? s.filialId : filialLink;
                return (
                  <div key={s.id}>
                    <p className="text-sm text-slate-700">
                      {[
                        s.equipe,
                        s.jornada,
                        STELANTO_STATUS[s.status] ? `${STELANTO_STATUS[s.status]} no Stelanto` : null,
                        s.primeiroDia ? `ponto de ${fmtData(s.primeiroDia)} a ${fmtData(s.ultimoDia)}` : 'sem batida no arquivo',
                        s.diasTrabalhados > 0 ? `${s.diasTrabalhados} dias trabalhados` : null,
                        totalSeg > 0 ? `${fmtHoras(totalSeg / 60)} no total` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {meses.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {meses.map((m) => (
                          <a
                            key={m.mes}
                            href={`/rh/historico-ponto?filialId=${filialHist}&pessoa=${s.id}&mes=${m.mes}`}
                            className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                            title={`${m.dias} dia(s) com batida`}
                          >
                            {mesCurto(m.mes)} <b className="text-slate-900">{fmtHoras(m.trabalhadoSeg / 60)}</b>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Bloco>
        )}
      </section>
    </main>
  );
}

function TabelaSemanas({
  semanas,
  casa,
}: {
  semanas: {
    folhaId: string;
    filialId: string;
    inicio: string;
    fim: string;
    total: number;
    baixadaEm: string | null;
    semBaixa: number;
    itens: { rotulo: string; valor: number; obs: string | null }[];
  }[];
  casa: (filialId: string | null) => string;
}) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-1.5 font-medium">Semana</th>
            <th className="py-1.5 font-medium">Casa</th>
            <th className="py-1.5 font-medium">O que entrou</th>
            <th className="py-1.5 text-right font-medium">Total</th>
            <th className="py-1.5 text-right font-medium">Baixa</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {semanas.map((s) => (
            <tr key={s.folhaId} className="align-top">
              <td className="whitespace-nowrap py-1.5">
                <a href={`/folha-equipe/folhas/${s.folhaId}`} className="text-blue-700 hover:underline">
                  {fmtData(s.inicio).slice(0, 5)} a {fmtData(s.fim).slice(0, 5)}
                </a>
                <span className="text-slate-400">/{s.fim.slice(2, 4)}</span>
              </td>
              <td className="py-1.5 text-slate-500">{casa(s.filialId)}</td>
              <td className="py-1.5 text-slate-700">
                {s.itens.map((it, i) => (
                  <span key={i} className="block">
                    {it.rotulo} <span className="tabular-nums">{brl(it.valor)}</span>
                    {it.obs && <span className="text-xs text-slate-400"> · {it.obs}</span>}
                  </span>
                ))}
              </td>
              <td className="py-1.5 text-right font-medium tabular-nums text-slate-900">{brl(s.total)}</td>
              <td className="whitespace-nowrap py-1.5 text-right text-slate-500">
                {s.semBaixa > 0 ? 'em aberto' : fmtData(s.baixadaEm).slice(0, 5)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
