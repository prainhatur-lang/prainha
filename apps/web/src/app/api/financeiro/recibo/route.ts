// POST /api/financeiro/recibo — recibo avulso (16/11/2026): quem recebeu não
// tem recibo, a casa faz o dela. Cria a conta a pagar MANUAL
// (codigo_referencia = 'recibo'); se já foi pago, nasce paga com a baixa
// dizendo a forma (dinheiro, Pix...). Se não, fica em aberto no contas a pagar.
//
// Quem recebe: acha pelo CPF/CNPJ nesta casa, copia de outra casa, ou
// cadastra na hora (fornecedor novo só entra com documento que confere).
//
// Body: { filialId, nome, documento, telefone?, valor, descricao,
//         pago, forma?, dataPagamento?, dataVencimento?, categoriaId?, forcar? }

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { ebLiberadaNoFinanceiro } from '@/lib/eb/acesso-financeiro';
import { hojeBr } from '@/lib/datas';
import { validarDocumento } from '@/lib/nfce/documento';
import { resolverFornecedorParaNota } from '@/lib/match-fornecedor';
import { FORMAS_RECIBO, REF_RECIBO, obsBaixaRecibo } from '@/lib/recibo-avulso';

export const dynamic = 'force-dynamic';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const Body = z.object({
  filialId: z.string().uuid(),
  nome: z.string().trim().min(3, 'nome de quem recebeu').max(200),
  documento: z.string().trim().min(11).max(20),
  telefone: z.string().trim().max(30).nullable().optional(),
  valor: z.number().positive(),
  descricao: z.string().trim().min(2, 'diga a que se refere').max(400),
  pago: z.boolean(),
  forma: z.enum(FORMAS_RECIBO).optional(),
  dataPagamento: z.string().regex(YMD).optional(),
  dataVencimento: z.string().regex(YMD).optional(),
  categoriaId: z.string().uuid().nullable().optional(),
  forcar: z.boolean().optional(),
});

export async function POST(req: Request) {
  const { user, error } = await exigirPermApi('conta_pagar.create');
  if (error) return error;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const f = parsed.error.flatten();
    const primeira = Object.values(f.fieldErrors).flat()[0];
    return NextResponse.json({ error: primeira ?? 'dados inválidos', details: f }, { status: 400 });
  }
  const b = parsed.data;

  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, b.filialId)))
    .limit(1);
  if (!acesso && !(await ebLiberadaNoFinanceiro(user.id, b.filialId)))
    return NextResponse.json({ error: 'sem acesso à filial' }, { status: 403 });

  const doc = validarDocumento(b.documento);
  if (!doc) return NextResponse.json({ error: 'CPF/CNPJ não confere — revise os números.' }, { status: 400 });
  if (b.pago && !b.forma) return NextResponse.json({ error: 'Diga como foi pago (dinheiro, Pix...).' }, { status: 400 });

  if (b.categoriaId) {
    const [cat] = await db
      .select({ id: schema.categoriaConta.id })
      .from(schema.categoriaConta)
      .where(and(eq(schema.categoriaConta.id, b.categoriaId), eq(schema.categoriaConta.filialId, b.filialId)))
      .limit(1);
    if (!cat) return NextResponse.json({ error: 'categoria não é da filial' }, { status: 400 });
  }

  const fone = (b.telefone ?? '').replace(/\D/g, '') || null;

  // Quem recebe: desta casa, copiado de outra casa, ou cadastrado agora.
  let fornecedorId = await resolverFornecedorParaNota({ filialId: b.filialId, emitCnpj: doc.doc, emitNome: b.nome });
  if (!fornecedorId) {
    const [novo] = await db
      .insert(schema.fornecedor)
      .values({
        filialId: b.filialId,
        codigoExterno: null,
        cnpjOuCpf: doc.doc,
        nome: b.nome.slice(0, 200),
        razaoSocial: b.nome.slice(0, 200),
        ativoCompras: false,
        foneWhatsapp: fone,
      })
      .returning({ id: schema.fornecedor.id });
    fornecedorId = novo?.id ?? null;
  } else if (fone) {
    // Cadastro que já existia: só preenche o WhatsApp se estava vazio.
    await db
      .update(schema.fornecedor)
      .set({ foneWhatsapp: fone })
      .where(and(eq(schema.fornecedor.id, fornecedorId), isNull(schema.fornecedor.foneWhatsapp)));
  }
  if (!fornecedorId) return NextResponse.json({ error: 'não consegui cadastrar quem recebeu' }, { status: 500 });

  const hoje = hojeBr();
  const dataPagamento = b.pago ? (b.dataPagamento ?? hoje) : null;
  const dataVencimento = b.pago ? dataPagamento! : (b.dataVencimento ?? hoje);

  // Recibo em dobro: mesma pessoa, mesmo valor, mesma data — pergunta antes.
  if (!b.forcar) {
    const [igual] = await db
      .select({ id: schema.contaPagar.id })
      .from(schema.contaPagar)
      .where(
        and(
          eq(schema.contaPagar.filialId, b.filialId),
          eq(schema.contaPagar.fornecedorId, fornecedorId),
          eq(schema.contaPagar.valor, b.valor.toFixed(2)),
          eq(schema.contaPagar.dataVencimento, dataVencimento),
          isNull(schema.contaPagar.dataDelete),
        ),
      )
      .limit(1);
    if (igual) {
      return NextResponse.json(
        {
          error: `Já existe uma conta de ${b.nome} com este valor nesta data. É outro pagamento mesmo?`,
          duplicada: igual.id,
          podeForcar: true,
        },
        { status: 409 },
      );
    }
  }

  const [conta] = await db
    .insert(schema.contaPagar)
    .values({
      filialId: b.filialId,
      fornecedorId,
      categoriaId: b.categoriaId ?? null,
      descricao: `Recibo — ${b.descricao}`,
      valor: b.valor.toFixed(2),
      dataVencimento,
      dataPagamento,
      valorPago: b.pago ? b.valor.toFixed(2) : null,
      competencia: dataVencimento.slice(0, 7),
      codigoReferencia: REF_RECIBO,
      origem: 'MANUAL',
      criadoPor: user.id,
      criadoEm: new Date(),
      dataCadastro: new Date(`${hoje}T12:00:00-03:00`),
    })
    .returning({ id: schema.contaPagar.id });
  if (!conta) return NextResponse.json({ error: 'não consegui lançar a conta' }, { status: 500 });

  if (b.pago) {
    await db.insert(schema.contaPagarBaixa).values({
      filialId: b.filialId,
      contaPagarId: conta.id,
      data: dataPagamento!,
      valor: b.valor.toFixed(2),
      observacao: obsBaixaRecibo(b.forma!),
      criadoPor: user.id,
    });
  }

  return NextResponse.json({ id: conta.id, pago: b.pago }, { status: 201 });
}
