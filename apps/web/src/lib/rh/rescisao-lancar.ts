// Rescisão → conta a pagar: o miolo do "lançar" (26/10/2026), usado pela rota
// /api/rh/rescisao (botão na ficha) e pela assinatura do TRCT gerado no sistema
// (04/11/2026: a pessoa assinou → a conta entra sozinha e aparece no Pix a pagar).
// Não confere permissão: quem chama confere.

import { db, schema } from '@concilia/db';
import { and, eq, ilike, isNull } from 'drizzle-orm';
import type { RescisaoLida } from '@/lib/rh/rescisao';
import { empregadorEbDoFuncionario, lancarRepasseEb, prepararRepasseEb } from '@/lib/rh/rescisao-empregador';

export interface DocRescisao {
  id: string;
  funcionarioId: string;
  filialId: string;
  nome: string;
  cpf: string | null;
  fornecedorId: string | null;
  dataDesligamento: string | null;
  dados: unknown;
}

export interface ContaRescisaoLancada {
  contaPagarId: string;
  contaEmpregadorId?: string;
  empregador?: 'E.B.';
}

/** Lança a conta da rescisão e liga ao documento. Lança Error('JA_LANCADA') se já virou conta. */
export async function lancarContaRescisao(
  doc: DocRescisao,
  d: { valor: number; vencimento: string; descricao?: string; usuarioId: string },
): Promise<ContaRescisaoLancada> {
  const t = schema.funcionarioDocumento;
  const [cat] = await db
    .select({ id: schema.categoriaConta.id })
    .from(schema.categoriaConta)
    .where(
      and(
        eq(schema.categoriaConta.filialId, doc.filialId),
        ilike(schema.categoriaConta.descricao, '%rescis%'),
        isNull(schema.categoriaConta.excluidaEm),
      ),
    )
    .limit(1);

  const lida = (doc.dados ?? null) as RescisaoLida | null;
  const competencia = (lida?.dataAfastamento ?? doc.dataDesligamento ?? d.vencimento).slice(0, 7);
  const obs = [
    lida?.causa ? `Causa: ${lida.causa}` : null,
    lida?.bruto != null ? `Bruto ${lida.bruto.toFixed(2)}` : null,
    lida?.descontos != null ? `descontos ${lida.descontos.toFixed(2)}` : null,
    `Termo na ficha do funcionário (RH → Funcionários)`,
  ]
    .filter(Boolean)
    .join(' · ');

  // Empregado da E.B. (30/10/2026): casa repassa pra E.B., E.B. paga a pessoa.
  const eb = await empregadorEbDoFuncionario(doc.funcionarioId, doc.cpf);
  if (eb) {
    const prep = await prepararRepasseEb(doc.filialId);
    const [casa] = await db.select({ nome: schema.filial.nome }).from(schema.filial).where(eq(schema.filial.id, doc.filialId)).limit(1);
    const r = await db.transaction((tx) =>
      lancarRepasseEb(
        tx,
        {
          documentoId: doc.id,
          casaFilialId: doc.filialId,
          casaNome: casa?.nome ?? 'casa',
          funcionarioNome: doc.nome,
          cpf: doc.cpf,
          fornecedorFuncionarioId: doc.fornecedorId,
          valor: d.valor,
          vencimento: d.vencimento,
          competencia,
          observacao: obs,
          usuarioId: d.usuarioId,
        },
        prep,
      ),
    );
    return { contaPagarId: r.contaCasaId, contaEmpregadorId: r.contaEbId, empregador: 'E.B.' };
  }

  const contaId = await db.transaction(async (tx) => {
    const [conta] = await tx
      .insert(schema.contaPagar)
      .values({
        filialId: doc.filialId,
        criadoPor: d.usuarioId,
        criadoEm: new Date(),
        codigoExterno: null,
        fornecedorId: doc.fornecedorId,
        categoriaId: cat?.id ?? null,
        dataVencimento: d.vencimento,
        valor: d.valor.toFixed(2),
        descricao: d.descricao || `Rescisão — ${doc.nome}`,
        observacao: obs,
        competencia,
        origem: 'FOLHA',
        folhaSemanaId: null,
      })
      .returning({ id: schema.contaPagar.id });
    const ligou = await tx
      .update(t)
      .set({ contaPagarId: conta!.id })
      .where(and(eq(t.id, doc.id), isNull(t.contaPagarId)))
      .returning({ id: t.id });
    if (!ligou.length) throw new Error('JA_LANCADA');
    return conta!.id;
  });
  return { contaPagarId: contaId };
}
