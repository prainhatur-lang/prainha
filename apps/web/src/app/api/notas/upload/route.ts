// POST /api/notas/upload
// Body: multipart/form-data com campo 'xml' (arquivo) + 'filialId'
// Ou: JSON { filialId, xml: string }
//
// Parseia XML da NFe e cria nota_compra + nota_compra_item.
// Idempotente: se chave já existe, retorna a existente.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { parseNfeXml } from '@/lib/nfe-parser';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const contentType = req.headers.get('content-type') ?? '';

  let filialId: string | null = null;
  let xml: string | null = null;

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    filialId = (form.get('filialId') as string | null) ?? null;
    const file = form.get('xml');
    if (file instanceof File) xml = await file.text();
  } else {
    const json = await req.json().catch(() => null);
    filialId = json?.filialId ?? null;
    xml = json?.xml ?? null;
  }

  if (!filialId || !xml) {
    return NextResponse.json({ error: 'filialId e xml sao obrigatorios' }, { status: 400 });
  }

  if (!/^[0-9a-f-]{36}$/i.test(filialId)) {
    return NextResponse.json({ error: 'filialId invalido' }, { status: 400 });
  }

  // RBAC
  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  // Parse
  let nfe;
  try {
    nfe = parseNfeXml(xml);
  } catch (e) {
    return NextResponse.json(
      { error: `XML nao e NFe valida: ${(e as Error).message}` },
      { status: 400 },
    );
  }

  // Hash pra dedupe
  const xmlHash = createHash('sha256').update(xml).digest('hex');

  // Já existe?
  const [existente] = await db
    .select({ id: schema.notaCompra.id })
    .from(schema.notaCompra)
    .where(and(eq(schema.notaCompra.filialId, filialId), eq(schema.notaCompra.chave, nfe.chave)))
    .limit(1);
  if (existente) {
    return NextResponse.json({ ok: true, id: existente.id, duplicada: true, chave: nfe.chave });
  }

  // Tenta associar fornecedor existente por CNPJ
  let fornecedorId: string | null = null;
  if (nfe.emitCnpj) {
    const [forn] = await db
      .select({ id: schema.fornecedor.id })
      .from(schema.fornecedor)
      .where(
        and(
          eq(schema.fornecedor.filialId, filialId),
          eq(schema.fornecedor.cnpjOuCpf, nfe.emitCnpj),
        ),
      )
      .limit(1);
    fornecedorId = forn?.id ?? null;
  }

  // Insere cabeçalho
  const [nova] = await db
    .insert(schema.notaCompra)
    .values({
      filialId,
      chave: nfe.chave,
      modelo: nfe.modelo,
      serie: nfe.serie,
      numero: nfe.numero,
      tipoOperacao: nfe.tipoOperacao,
      naturezaOperacao: nfe.naturezaOperacao,
      emitCnpj: nfe.emitCnpj,
      emitNome: nfe.emitNome,
      emitFantasia: nfe.emitFantasia,
      emitIe: nfe.emitIe,
      emitUf: nfe.emitUf,
      emitCidade: nfe.emitCidade,
      fornecedorId,
      destCnpj: nfe.destCnpj,
      destNome: nfe.destNome,
      dataEmissao: nfe.dataEmissao ? new Date(nfe.dataEmissao) : null,
      dataEntrada: nfe.dataEntrada ? new Date(nfe.dataEntrada) : null,
      valorTotal: String(nfe.valorTotal),
      valorProdutos: String(nfe.valorProdutos),
      valorFrete: String(nfe.valorFrete),
      valorSeguro: String(nfe.valorSeguro),
      valorDesconto: String(nfe.valorDesconto),
      valorOutros: String(nfe.valorOutros),
      valorIcms: String(nfe.valorIcms),
      valorIcmsSt: String(nfe.valorIcmsSt),
      valorIpi: String(nfe.valorIpi),
      valorPis: String(nfe.valorPis),
      valorCofins: String(nfe.valorCofins),
      situacao: nfe.situacao,
      protocoloAutorizacao: nfe.protocoloAutorizacao,
      dataAutorizacao: nfe.dataAutorizacao ? new Date(nfe.dataAutorizacao) : null,
      xmlHash,
      origemImportacao: 'UPLOAD',
    })
    .returning({ id: schema.notaCompra.id });

  const notaCompraId = nova!.id;

  // Insere itens
  if (nfe.itens.length > 0) {
    const itens = nfe.itens.map((it) => ({
      filialId,
      notaCompraId,
      numeroItem: it.numeroItem,
      codigoProdutoFornecedor: it.codigoProdutoFornecedor,
      ean: it.ean,
      descricao: it.descricao,
      ncm: it.ncm,
      cest: it.cest,
      cfop: it.cfop,
      unidade: it.unidade,
      quantidade: it.quantidade !== null ? String(it.quantidade) : null,
      valorUnitario: it.valorUnitario !== null ? String(it.valorUnitario) : null,
      valorTotal: it.valorTotal !== null ? String(it.valorTotal) : null,
      valorDesconto: it.valorDesconto !== null ? String(it.valorDesconto) : null,
      valorFrete: it.valorFrete !== null ? String(it.valorFrete) : null,
      valorIcms: it.valorIcms !== null ? String(it.valorIcms) : null,
      aliquotaIcms: it.aliquotaIcms !== null ? String(it.aliquotaIcms) : null,
      valorIpi: it.valorIpi !== null ? String(it.valorIpi) : null,
      valorPis: it.valorPis !== null ? String(it.valorPis) : null,
      valorCofins: it.valorCofins !== null ? String(it.valorCofins) : null,
    }));
    await db.insert(schema.notaCompraItem).values(itens);
  }

  // Insere duplicatas (parcelas) — usadas depois pra criar conta_pagar
  // ao lancar a nota no estoque. Filtra invalidas.
  if (nfe.duplicatas.length > 0) {
    const dups = nfe.duplicatas
      .filter((d) => d.vencimento != null && d.valor > 0)
      .map((d) => ({
        filialId,
        notaCompraId,
        numero: d.numero,
        dataVencimento: d.vencimento as string, // yyyy-mm-dd da NFe
        valor: String(d.valor),
      }));
    if (dups.length > 0) {
      await db.insert(schema.notaCompraDuplicata).values(dups);
    }
  }

  return NextResponse.json({
    ok: true,
    id: notaCompraId,
    chave: nfe.chave,
    emitNome: nfe.emitNome,
    valorTotal: nfe.valorTotal,
    qtdItens: nfe.itens.length,
    qtdDuplicatas: nfe.duplicatas.length,
  });
}
