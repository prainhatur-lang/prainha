// Banco de horas e escala (jornada) de cada pessoa da casa.
//
// Mensalista (jornada 'fixa'): saldo que veio do Stelanto na virada + acertos
// + o que o ponto próprio somou/tirou desde a virada (trabalhado − previsto).
// Intermitente: sem banco, só as horas batidas. Conta em lib/rh/banco-horas.ts.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, asc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { hojeBr } from '@/lib/datas';
import { calcularDia } from '@/lib/rh/calcular-ponto';
import { pontoProprioDesde } from '@/lib/rh/ponto-vigencia';
import { somarDias } from '@/lib/rh/dia-operacional';
import { jornadaNoDia, minutosPrevistos, type VigenciaJornada } from '@/lib/rh/banco-horas';
import { BancoHorasManager, type LinhaPessoa } from './manager';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
}

export default async function BancoHorasPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'ponto.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialSelecionada = await escolherFilial(filiais, sp.filialId);

  if (!filialSelecionada) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-3xl px-6 py-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
      </main>
    );
  }
  const filial = filialSelecionada;
  const podeLancar = await podeUsuario(user.id, 'ponto.corrigir');

  const hoje = hojeBr();
  const virada = pontoProprioDesde(filial.id);

  // Banco de horas é do contrato: aparece na casa do cadastro (lotação principal).
  const funcionarios = await db
    .select({
      id: schema.funcionario.id,
      nome: schema.funcionario.nome,
      cargo: schema.funcionario.cargo,
      regime: schema.funcionario.regimeSalarial,
      dataAdmissao: schema.funcionario.dataAdmissao,
    })
    .from(schema.funcionario)
    .where(and(eq(schema.funcionario.filialId, filial.id), eq(schema.funcionario.ativo, true)))
    .orderBy(asc(schema.funcionario.nome));
  const ids = funcionarios.map((f) => f.id);

  const jornadas = await db
    .select({
      id: schema.rhJornada.id,
      nome: schema.rhJornada.nome,
      tipo: schema.rhJornada.tipo,
      minSeg: schema.rhJornada.minSeg,
      minTer: schema.rhJornada.minTer,
      minQua: schema.rhJornada.minQua,
      minQui: schema.rhJornada.minQui,
      minSex: schema.rhJornada.minSex,
      minSab: schema.rhJornada.minSab,
      minDom: schema.rhJornada.minDom,
      origem: schema.rhJornada.origem,
      // "rh_jornada"."id" por extenso: em select de uma tabela só o drizzle
      // escreve a coluna sem o nome da tabela, e "id" solto é ambíguo aqui dentro.
      pessoas: sql<number>`(SELECT count(DISTINCT fj.funcionario_id)::int FROM funcionario_jornada fj
        JOIN funcionario f ON f.id = fj.funcionario_id AND f.ativo
        WHERE fj.jornada_id = "rh_jornada"."id"
          AND fj.vigente_desde = (SELECT max(x.vigente_desde) FROM funcionario_jornada x
            WHERE x.funcionario_id = fj.funcionario_id AND x.vigente_desde <= ${hoje}::date))`,
    })
    .from(schema.rhJornada)
    .where(eq(schema.rhJornada.ativo, true))
    .orderBy(asc(schema.rhJornada.tipo), asc(schema.rhJornada.nome));
  const jornadaPorId = new Map(jornadas.map((j) => [j.id, j]));

  const [vigRows, lancRows, batidas] = ids.length
    ? await Promise.all([
        db
          .select({
            funcionarioId: schema.funcionarioJornada.funcionarioId,
            jornadaId: schema.funcionarioJornada.jornadaId,
            vigenteDesde: schema.funcionarioJornada.vigenteDesde,
          })
          .from(schema.funcionarioJornada)
          .where(inArray(schema.funcionarioJornada.funcionarioId, ids)),
        db
          .select({
            id: schema.bancoHorasLancamento.id,
            funcionarioId: schema.bancoHorasLancamento.funcionarioId,
            dia: schema.bancoHorasLancamento.dia,
            minutos: schema.bancoHorasLancamento.minutos,
            tipo: schema.bancoHorasLancamento.tipo,
            descricao: schema.bancoHorasLancamento.descricao,
          })
          .from(schema.bancoHorasLancamento)
          .where(inArray(schema.bancoHorasLancamento.funcionarioId, ids))
          .orderBy(asc(schema.bancoHorasLancamento.dia), asc(schema.bancoHorasLancamento.criadoEm)),
        // Ponto próprio da virada até ONTEM (hoje ainda está em andamento), em
        // qualquer casa: quem circula entre lojas soma as horas de todas.
        db
          .select({
            funcionarioId: schema.pontoBatida.funcionarioId,
            filialId: schema.pontoBatida.filialId,
            dia: schema.pontoBatida.diaOperacional,
            quando: schema.pontoBatida.quando,
            tipo: schema.pontoBatida.tipo,
          })
          .from(schema.pontoBatida)
          .where(
            and(
              inArray(schema.pontoBatida.funcionarioId, ids),
              gte(schema.pontoBatida.diaOperacional, virada),
              lt(schema.pontoBatida.diaOperacional, hoje),
              isNull(schema.pontoBatida.excluidaEm),
            ),
          ),
      ])
    : [[], [], []];

  // funcionario|dia -> { min trabalhados, tem batida incompleta }
  const porCasaDia = new Map<string, { quando: Date; tipo: 'entrada' | 'saida' }[]>();
  for (const b of batidas) {
    const k = `${b.funcionarioId}|${b.dia}|${b.filialId}`;
    const lista = porCasaDia.get(k) ?? [];
    lista.push({ quando: b.quando, tipo: b.tipo as 'entrada' | 'saida' });
    porCasaDia.set(k, lista);
  }
  const trabalhado = new Map<string, { min: number; incompleto: boolean }>();
  for (const [k, lista] of porCasaDia) {
    const [fid, dia] = k.split('|');
    const calc = calcularDia(lista);
    const chave = `${fid}|${dia}`;
    const at = trabalhado.get(chave) ?? { min: 0, incompleto: false };
    at.min += calc.totalMin;
    if (calc.status === 'incompleto' || calc.orfas > 0) at.incompleto = true;
    trabalhado.set(chave, at);
  }

  const ontem = somarDias(hoje, -1);
  const linhas: LinhaPessoa[] = funcionarios.map((f) => {
    const vigencias: VigenciaJornada[] = vigRows
      .filter((v) => v.funcionarioId === f.id)
      .flatMap((v) => {
        const j = jornadaPorId.get(v.jornadaId);
        return j ? [{ ...j, jornadaId: j.id, vigenteDesde: v.vigenteDesde }] : [];
      });
    const atual = jornadaNoDia(vigencias, hoje);
    const lancamentos = lancRows.filter((l) => l.funcionarioId === f.id);
    const inicial = lancamentos.find((l) => l.tipo === 'saldo_inicial') ?? null;
    const acertosMin = lancamentos.filter((l) => l.tipo !== 'saldo_inicial').reduce((s, l) => s + l.minutos, 0);

    // A conta começa na virada, na primeira escala ou na admissão — o que vier por último.
    const primeiraVigencia = vigencias.map((v) => v.vigenteDesde).sort()[0] ?? null;
    let inicio = virada;
    if (primeiraVigencia && primeiraVigencia > inicio) inicio = primeiraVigencia;
    if (f.dataAdmissao && f.dataAdmissao > inicio) inicio = f.dataAdmissao;

    let previstoMin = 0;
    let trabalhadoMin = 0;
    // Só o que foi batido DEPOIS que a escala passou a valer entra no banco:
    // hora de antes não tem previsto pra comparar e viraria crédito inteiro.
    let trabalhadoNaContaMin = 0;
    let semBatidaDias = 0;
    let semBatidaMin = 0;
    let incompletos = 0;
    for (let dia = virada; dia <= ontem; dia = somarDias(dia, 1)) {
      const t = trabalhado.get(`${f.id}|${dia}`);
      if (t) {
        trabalhadoMin += t.min;
        if (t.incompleto) incompletos++;
      }
      if (dia < inicio) continue;
      if (t) trabalhadoNaContaMin += t.min;
      const j = jornadaNoDia(vigencias, dia);
      const prev = j ? minutosPrevistos(j, dia) : 0;
      previstoMin += prev;
      if (prev > 0 && !t) {
        semBatidaDias++;
        semBatidaMin += prev;
      }
    }

    const temBanco = atual?.tipo === 'fixa';
    const movimentoMin = temBanco ? trabalhadoNaContaMin - previstoMin : 0;
    return {
      id: f.id,
      nome: f.nome,
      cargo: f.cargo,
      regime: f.regime,
      jornadaId: atual?.jornadaId ?? null,
      jornadaNome: atual?.nome ?? null,
      jornadaTipo: atual?.tipo ?? null,
      jornadaDesde: atual?.vigenteDesde ?? null,
      inicialMin: inicial?.minutos ?? null,
      inicialDia: inicial?.dia ?? null,
      inicialDescricao: inicial?.descricao ?? null,
      acertosMin,
      contaDesde: inicio,
      previstoMin,
      trabalhadoMin: temBanco ? trabalhadoNaContaMin : trabalhadoMin,
      semBatidaDias,
      semBatidaMin,
      incompletos,
      movimentoMin,
      saldoMin: (inicial?.minutos ?? 0) + acertosMin + movimentoMin,
      lancamentos: lancamentos.map((l) => ({
        id: l.id,
        dia: l.dia,
        minutos: l.minutos,
        tipo: l.tipo,
        descricao: l.descricao,
      })),
    };
  });

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Banco de horas e escala</h1>
            <p className="mt-1 text-sm text-slate-600">
              {filial.nome} · ponto próprio desde {virada.split('-').reverse().join('/')} · conta até ontem
            </p>
          </div>
          <div className="flex gap-2">
            <a
              href={`/rh/ponto?filialId=${filial.id}`}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              Ponto da semana
            </a>
            <a
              href={`/rh/historico-ponto?filialId=${filial.id}`}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              Histórico do ponto antigo
            </a>
          </div>
        </div>

        {filiais.length > 1 && (
          <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
            <label className="text-xs font-medium text-slate-500">Filial</label>
            <div className="mt-1 flex flex-wrap gap-2">
              {filiais.map((f) => {
                const active = f.id === filial.id;
                return (
                  <a
                    key={f.id}
                    href={`?filialId=${f.id}`}
                    className={`rounded-md border px-3 py-1.5 text-sm ${
                      active
                        ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {f.nome}
                  </a>
                );
              })}
            </div>
          </div>
        )}

        <BancoHorasManager
          hoje={hoje}
          podeLancar={podeLancar}
          linhas={linhas}
          jornadas={jornadas.map((j) => ({
            id: j.id,
            nome: j.nome,
            tipo: j.tipo,
            minSeg: j.minSeg,
            minTer: j.minTer,
            minQua: j.minQua,
            minQui: j.minQui,
            minSex: j.minSex,
            minSab: j.minSab,
            minDom: j.minDom,
            origem: j.origem,
            pessoas: Number(j.pessoas ?? 0),
          }))}
        />
      </section>
    </main>
  );
}
