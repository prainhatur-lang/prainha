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
//    (só naquele dia).
// O limite gravado em funcionario.limite_dias_semana não é apagado — quem não
// cai em nenhum dos dois continua travado igual.
import { db, schema } from '@concilia/db';
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';

export async function isencoesTravaSemana(
  funcionarioIds: string[],
  dia: string,
): Promise<{ registrados: Set<string>; escalaNoDia: Set<string> }> {
  const registrados = new Set<string>();
  const escalaNoDia = new Set<string>();
  const ids = [...new Set(funcionarioIds)];
  if (!ids.length) return { registrados, escalaNoDia };

  const [cad, folha, escala] = await Promise.all([
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
  ]);
  for (const r of cad) registrados.add(r.id);
  for (const r of folha) if (r.id) registrados.add(r.id);
  for (const r of escala) escalaNoDia.add(r.id);
  return { registrados, escalaNoDia };
}
