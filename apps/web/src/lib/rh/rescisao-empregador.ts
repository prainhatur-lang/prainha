// Rescisão de quem é empregado da E.B. Serviços (pedido do dono 30/10/2026:
// "quem vai pagar é E.B., mas a Prainha tem que pagar pra E.B. e a E.B. pagar
// pra ele").
//
// O empregador sai da última folha do contador da pessoa (folha_contador.cnpj).
// Sendo a E.B.:
//   - casa da lotação: conta "Repasse E.B. — Rescisão — Fulano", favorecido E.B.
//     (é o Pix real casa → E.B.; fica em funcionario_documento.conta_pagar_id);
//   - filial da E.B.: conta "Rescisão — Fulano", favorecido o funcionário
//     (a E.B. paga a pessoa; fica em conta_pagar_empregador_id).
// Quem não é da E.B. (Prainha Turismo, Lelis, sem folha) continua igual: a casa
// paga o funcionário direto.

import { db, schema } from '@concilia/db';
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { EB_CNPJ } from '@/lib/eb/faturas';
import { filialDoCnpj, fornecedorPagadorNaCasa } from '@/lib/impostos/guia';

export interface EmpregadorEb {
  cnpj: string;
  empresa: string;
  competencia: string;
}

/** A pessoa é empregada da E.B.? (pela última folha do contador). */
export async function empregadorEbDoFuncionario(funcionarioId: string, cpf: string | null): Promise<EmpregadorEb | null> {
  const fc = schema.folhaContador;
  const cpfDig = (cpf ?? '').replace(/\D/g, '');
  const [u] = await db
    .select({ cnpj: fc.cnpj, empresa: fc.empresa, competencia: fc.competencia })
    .from(fc)
    .where(cpfDig.length === 11 ? or(eq(fc.funcionarioId, funcionarioId), eq(fc.cpf, cpfDig)) : eq(fc.funcionarioId, funcionarioId))
    .orderBy(desc(fc.competencia))
    .limit(1);
  if (!u) return null;
  const cnpj = (u.cnpj ?? '').replace(/\D/g, '');
  if (cnpj !== EB_CNPJ) return null;
  return { cnpj, empresa: u.empresa ?? 'E.B. Serviços', competencia: u.competencia };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Cadastro do funcionário na filial da E.B. (pelo CPF); cria copiando a chave/banco do cadastro da casa. */
async function fornecedorFuncionarioNaEb(
  tx: Tx,
  ebFilialId: string,
  nome: string,
  cpf: string | null,
  fornecedorCasaId: string | null,
): Promise<string | null> {
  const f = schema.fornecedor;
  const cpfDig = (cpf ?? '').replace(/\D/g, '');
  if (cpfDig.length === 11) {
    const [ja] = await tx
      .select({ id: f.id })
      .from(f)
      .where(and(eq(f.filialId, ebFilialId), isNull(f.dataDelete), sql`regexp_replace(coalesce(${f.cnpjOuCpf}, ''), '\\D', '', 'g') = ${cpfDig}`))
      .limit(1);
    if (ja) return ja.id;
  }
  const [casa] = fornecedorCasaId
    ? await tx
        .select({
          chavePix: f.chavePix,
          pixFavorecido: f.pixFavorecido,
          bancoNome: f.bancoNome,
          bancoAgencia: f.bancoAgencia,
          bancoConta: f.bancoConta,
        })
        .from(f)
        .where(eq(f.id, fornecedorCasaId))
        .limit(1)
    : [];
  const [novo] = await tx
    .insert(f)
    .values({
      filialId: ebFilialId,
      codigoExterno: null,
      cnpjOuCpf: cpfDig.length === 11 ? cpfDig : null,
      nome,
      razaoSocial: nome,
      ativoCompras: false,
      chavePix: casa?.chavePix ?? null,
      pixFavorecido: casa?.pixFavorecido ?? null,
      bancoNome: casa?.bancoNome ?? null,
      bancoAgencia: casa?.bancoAgencia ?? null,
      bancoConta: casa?.bancoConta ?? null,
    })
    .returning({ id: f.id });
  return novo?.id ?? null;
}

async function categoriaRescisao(tx: Tx, filialId: string): Promise<string | null> {
  const [cat] = await tx
    .select({ id: schema.categoriaConta.id })
    .from(schema.categoriaConta)
    .where(
      and(
        eq(schema.categoriaConta.filialId, filialId),
        ilike(schema.categoriaConta.descricao, '%rescis%'),
        isNull(schema.categoriaConta.excluidaEm),
      ),
    )
    .limit(1);
  return cat?.id ?? null;
}

export interface LancarRepasseEb {
  documentoId: string;
  casaFilialId: string;
  casaNome: string;
  funcionarioNome: string;
  cpf: string | null;
  fornecedorFuncionarioId: string | null;
  valor: number;
  vencimento: string;
  competencia: string;
  observacao: string;
  usuarioId: string;
  /** Conta já lançada pra pessoa na casa (converter). Sem ela, cria a conta da casa. */
  contaCasaExistenteId?: string | null;
}

/** Prepara fora da transação o que pode criar cadastro (filial e fornecedor E.B. na casa). */
export async function prepararRepasseEb(casaFilialId: string) {
  const eb = await filialDoCnpj(EB_CNPJ);
  if (!eb) throw new Error('Filial da E.B. não encontrada no sistema.');
  const fornecedorEbNaCasa = await fornecedorPagadorNaCasa(casaFilialId, EB_CNPJ);
  return { ebFilialId: eb.id, fornecedorEbNaCasa };
}

/** Cria (ou converte) a conta da casa como repasse pra E.B. e a conta da E.B. pro funcionário. */
export async function lancarRepasseEb(
  tx: Tx,
  p: LancarRepasseEb,
  prep: { ebFilialId: string; fornecedorEbNaCasa: string },
): Promise<{ contaCasaId: string; contaEbId: string }> {
  const descEb = `Rescisão — ${p.funcionarioNome}`;
  const descCasa = `Repasse E.B. — Rescisão — ${p.funcionarioNome}`;
  const catCasa = await categoriaRescisao(tx, p.casaFilialId);
  const catEb = await categoriaRescisao(tx, prep.ebFilialId);
  const fornFuncEb = await fornecedorFuncionarioNaEb(tx, prep.ebFilialId, p.funcionarioNome, p.cpf, p.fornecedorFuncionarioId);
  const valor = p.valor.toFixed(2);
  const valorBr = valor.replace('.', ',');

  const [contaEb] = await tx
    .insert(schema.contaPagar)
    .values({
      filialId: prep.ebFilialId,
      criadoPor: p.usuarioId,
      criadoEm: new Date(),
      codigoExterno: null,
      fornecedorId: fornFuncEb,
      categoriaId: catEb,
      dataVencimento: p.vencimento,
      valor,
      descricao: descEb,
      observacao: `${p.observacao}\nEmpregado da E.B. lotado na ${p.casaNome}: a E.B. paga a pessoa com o repasse de R$ ${valorBr} da casa.`,
      competencia: p.competencia,
      origem: 'FOLHA',
      folhaSemanaId: null,
    })
    .returning({ id: schema.contaPagar.id });

  const obsCasa = `${p.observacao}\nEmpregado da E.B.: Pix pra E.B. Serviços, que paga a rescisão de ${p.funcionarioNome}. Não pagar o funcionário direto.`;
  let contaCasaId: string;
  if (p.contaCasaExistenteId) {
    await tx
      .update(schema.contaPagar)
      .set({
        fornecedorId: prep.fornecedorEbNaCasa,
        descricao: descCasa,
        observacao: obsCasa,
        categoriaId: sql`coalesce(${schema.contaPagar.categoriaId}, ${catCasa}::uuid)`,
      })
      .where(eq(schema.contaPagar.id, p.contaCasaExistenteId));
    contaCasaId = p.contaCasaExistenteId;
  } else {
    const [c] = await tx
      .insert(schema.contaPagar)
      .values({
        filialId: p.casaFilialId,
        criadoPor: p.usuarioId,
        criadoEm: new Date(),
        codigoExterno: null,
        fornecedorId: prep.fornecedorEbNaCasa,
        categoriaId: catCasa,
        dataVencimento: p.vencimento,
        valor,
        descricao: descCasa,
        observacao: obsCasa,
        competencia: p.competencia,
        origem: 'FOLHA',
        folhaSemanaId: null,
      })
      .returning({ id: schema.contaPagar.id });
    contaCasaId = c!.id;
  }

  const t = schema.funcionarioDocumento;
  const ligou = await tx
    .update(t)
    .set({ contaPagarId: contaCasaId, contaPagarEmpregadorId: contaEb!.id })
    .where(
      and(
        eq(t.id, p.documentoId),
        isNull(t.contaPagarEmpregadorId),
        p.contaCasaExistenteId ? eq(t.contaPagarId, p.contaCasaExistenteId) : isNull(t.contaPagarId),
      ),
    )
    .returning({ id: t.id });
  if (!ligou.length) throw new Error('JA_LANCADA');
  return { contaCasaId, contaEbId: contaEb!.id };
}
