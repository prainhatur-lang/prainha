// Quem fica FORA da trava de dias por semana do ponto (29/10/2026).
//
// A trava (20/10) é pra quem trabalha SEM REGISTRO. O "Travar todos" do
// /rh/horas-regime pega quem não tem contracheque do contador, e isso pegou
// gente registrada: Rivaldo (intermitente com escala, Bar) e 6 da E.B./Lelis.
// Regime do cadastro não separa (quase todo informal está 'intermitente_hora').
//
// Fica fora:
//  - registrado: empresa/CNPJ/matrícula de registro preenchidos no cadastro,
//    ou com contracheque na folha do contador;
//  - quem tem escala salva em /rh/escala-mensal dizendo que TRABALHA no dia
//    (só naquele dia);
//  - quem NÃO é diarista na folha (fornecedor_folha.papel = funcionario/gerente).
//    Regra do dono 29/10: "temos intermitente e diarista. o diarista só pode
//    trabalhar 2 dias na semana". Sem papel na folha continua travado.
// O limite gravado em funcionario.limite_dias_semana não é apagado — quem não
// cai em nenhum dos dois continua travado igual.
import { db, schema } from '@concilia/db';
import { and, eq, inArray, isNotNull, ne, or } from 'drizzle-orm';

export async function isencoesTravaSemana(
  funcionarioIds: string[],
  dia: string,
): Promise<{ registrados: Set<string>; escalaNoDia: Set<string>; naoDiaristas: Set<string> }> {
  const registrados = new Set<string>();
  const escalaNoDia = new Set<string>();
  const naoDiaristas = new Set<string>();
  const ids = [...new Set(funcionarioIds)];
  if (!ids.length) return { registrados, escalaNoDia, naoDiaristas };

  const [cad, folha, escala, papel] = await Promise.all([
    db
      .select({ id: schema.funcionario.id })
      .from(schema.funcionario)
      .where(
        and(
          inArray(schema.funcionario.id, ids),
          or(
            isNotNull(schema.funcionario.empresaRegistro),
            isNotNull(schema.funcionario.cnpjRegistro),
            isNotNull(schema.funcionario.matriculaFolha),
          ),
        ),
      ),
    db
      .selectDistinct({ id: schema.folhaContador.funcionarioId })
      .from(schema.folhaContador)
      .where(inArray(schema.folhaContador.funcionarioId, ids)),
    db
      .select({ id: schema.rhEscalaDia.funcionarioId })
      .from(schema.rhEscalaDia)
      .where(
        and(
          inArray(schema.rhEscalaDia.funcionarioId, ids),
          eq(schema.rhEscalaDia.dia, dia),
          eq(schema.rhEscalaDia.folga, false),
        ),
      ),
    db
      .select({ id: schema.funcionario.id })
      .from(schema.funcionario)
      .innerJoin(
        schema.fornecedorFolha,
        eq(schema.fornecedorFolha.fornecedorId, schema.funcionario.fornecedorId),
      )
      .where(
        and(
          inArray(schema.funcionario.id, ids),
          ne(schema.fornecedorFolha.papel, 'diarista'),
        ),
      ),
  ]);
  for (const r of cad) registrados.add(r.id);
  for (const r of folha) if (r.id) registrados.add(r.id);
  for (const r of escala) escalaNoDia.add(r.id);
  for (const r of papel) naoDiaristas.add(r.id);
  return { registrados, escalaNoDia, naoDiaristas };
}
