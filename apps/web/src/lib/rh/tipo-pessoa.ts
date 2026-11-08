// Tipo de cada pessoa (intermitente / CLT / 12x36 / diarista / sem registro).
// Mesma regra do relatório do ponto (/rh/ponto/relatorio): registrado =
// contracheque na folha ou registro no cadastro; vínculo "Intermitente" separa
// intermitente de CLT; 12x36 pelo nome da jornada; diarista pelo papel na folha.
// Usado no selo ao lado do nome em /rh/ponto (pedido do dono 06/11/2026).

import { db, schema } from '@concilia/db';
import { and, inArray, isNotNull, isNull } from 'drizzle-orm';
import { jornadaNoDia } from '@/lib/rh/banco-horas';

import type { TipoPessoa } from '@/lib/rh/tipo-pessoa-rotulo';
export { TIPO_PESSOA_ROTULO, type TipoPessoa } from '@/lib/rh/tipo-pessoa-rotulo';

export async function tiposDasPessoas(ids: string[], dia: string): Promise<Map<string, TipoPessoa>> {
  const out = new Map<string, TipoPessoa>();
  if (!ids.length) return out;
  const f = schema.funcionario;
  const [funcs, folhaRows, vigRows, jornadas] = await Promise.all([
    db
      .select({
        id: f.id,
        regimeSalarial: f.regimeSalarial,
        empresaRegistro: f.empresaRegistro,
        cnpjRegistro: f.cnpjRegistro,
        matriculaFolha: f.matriculaFolha,
        fornecedorId: f.fornecedorId,
      })
      .from(f)
      .where(inArray(f.id, ids)),
    db
      .select({
        funcionarioId: schema.folhaContador.funcionarioId,
        competencia: schema.folhaContador.competencia,
        vinculo: schema.folhaContador.vinculo,
      })
      .from(schema.folhaContador)
      .where(and(inArray(schema.folhaContador.funcionarioId, ids), isNull(schema.folhaContador.demitidoEm))),
    db
      .select({
        funcionarioId: schema.funcionarioJornada.funcionarioId,
        jornadaId: schema.funcionarioJornada.jornadaId,
        vigenteDesde: schema.funcionarioJornada.vigenteDesde,
      })
      .from(schema.funcionarioJornada)
      .where(inArray(schema.funcionarioJornada.funcionarioId, ids)),
    db.select({ id: schema.rhJornada.id, nome: schema.rhJornada.nome, tipo: schema.rhJornada.tipo }).from(schema.rhJornada),
  ]);
  const fornIds = funcs.map((x) => x.fornecedorId).filter((x): x is string => !!x);
  const papelRows = fornIds.length
    ? await db
        .select({ fornecedorId: schema.fornecedorFolha.fornecedorId, papel: schema.fornecedorFolha.papel })
        .from(schema.fornecedorFolha)
        .where(inArray(schema.fornecedorFolha.fornecedorId, fornIds))
    : [];
  const papelPor = new Map(papelRows.map((r) => [r.fornecedorId, r.papel]));
  const vinculoPor = new Map<string, { competencia: string; vinculo: string | null }>();
  for (const r of folhaRows) {
    if (!r.funcionarioId) continue;
    const at = vinculoPor.get(r.funcionarioId);
    if (!at || r.competencia > at.competencia) vinculoPor.set(r.funcionarioId, { competencia: r.competencia, vinculo: r.vinculo });
  }
  const jornadaPorId = new Map(jornadas.map((j) => [j.id, j]));

  // Mudança de regime agendada e já aplicada DEPOIS da última folha do
  // contador (ex.: Tabuará vira CLT em 01/11, folha de out ainda diz
  // "Intermitente"): vale o regime novo até a folha seguinte chegar
  // (dono 08/11/2026).
  const agendaRows = await db
    .select({
      funcionarioId: schema.funcionarioRegimeAgenda.funcionarioId,
      aPartir: schema.funcionarioRegimeAgenda.aPartir,
      regime: schema.funcionarioRegimeAgenda.regimeSalarial,
    })
    .from(schema.funcionarioRegimeAgenda)
    .where(
      and(
        inArray(schema.funcionarioRegimeAgenda.funcionarioId, ids),
        isNotNull(schema.funcionarioRegimeAgenda.aplicadoEm),
        isNull(schema.funcionarioRegimeAgenda.canceladoEm),
      ),
    );
  const agendaPor = new Map<string, { aPartir: string; regime: string }>();
  for (const r of agendaRows) {
    if (r.aPartir > dia) continue;
    const at = agendaPor.get(r.funcionarioId);
    if (!at || r.aPartir > at.aPartir) agendaPor.set(r.funcionarioId, { aPartir: r.aPartir, regime: r.regime });
  }

  for (const p of funcs) {
    const vig = vigRows
      .filter((v) => v.funcionarioId === p.id)
      .flatMap((v) => {
        const j = jornadaPorId.get(v.jornadaId);
        return j ? [{ ...j, vigenteDesde: v.vigenteDesde }] : [];
      });
    const jAtual = jornadaNoDia(vig, dia);
    const folhaC = vinculoPor.get(p.id);
    const registrado = !!folhaC || !!(p.empresaRegistro || p.cnpjRegistro || p.matriculaFolha);
    const tipo: TipoPessoa = /12\s*x\s*36/i.test(jAtual?.nome ?? '')
      ? '12x36'
      : registrado
        ? folhaC
          ? (() => {
              const ag = agendaPor.get(p.id);
              // Competência 'AAAA-MM': agenda de mês posterior manda.
              if (ag && ag.aPartir.slice(0, 7) > folhaC.competencia.slice(0, 7)) {
                return ag.regime === 'intermitente_hora' ? 'intermitente' : 'clt';
              }
              return /intermit/i.test(folhaC.vinculo ?? '') ? 'intermitente' : 'clt';
            })()
          : jAtual?.tipo === 'intermitente' || (jAtual?.tipo !== 'fixa' && p.regimeSalarial === 'intermitente_hora')
            ? 'intermitente'
            : 'clt'
        : p.fornecedorId && papelPor.get(p.fornecedorId) === 'diarista'
          ? 'diarista'
          : 'outros';
    out.set(p.id, tipo);
  }
  return out;
}
