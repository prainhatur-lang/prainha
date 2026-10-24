// Exportação por conta contábil do contador (24/10/2026).
// Contas pagas no período (data_pagamento), conta contábil vinda da categoria.
// CSV com ";" e vírgula decimal, com BOM — abre direto no Excel pt-BR.
//   modo=resumo  → uma linha por conta contábil
//   modo=detalhe → uma linha por pagamento

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, asc, eq, gte, isNotNull, isNull, lte } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ymd = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const num = (n: number) => n.toFixed(2).replace('.', ',');
const cel = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const dataBr = (v: string | null) => (v ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : '');

export async function GET(request: Request) {
  const { user, error } = await exigirPermApi('configuracao.read');
  if (error) return error;

  const u = new URL(request.url);
  const filialId = u.searchParams.get('filialId');
  const de = ymd(u.searchParams.get('de'));
  const ate = ymd(u.searchParams.get('ate'));
  const modo = u.searchParams.get('modo') === 'detalhe' ? 'detalhe' : 'resumo';
  if (!filialId || !de || !ate) {
    return NextResponse.json({ error: 'filialId, de e ate (AAAA-MM-DD) são obrigatórios' }, { status: 400 });
  }
  const filiais = await filiaisDoUsuario(user.id);
  const filial = filiais.find((f) => f.id === filialId);
  if (!filial) return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });

  const [org] = await db
    .select({ organizacaoId: schema.filial.organizacaoId })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId));

  const [rows, plano] = await Promise.all([
    db
      .select({
        dataPagamento: schema.contaPagar.dataPagamento,
        dataVencimento: schema.contaPagar.dataVencimento,
        valor: schema.contaPagar.valor,
        valorPago: schema.contaPagar.valorPago,
        descricao: schema.contaPagar.descricao,
        categoriaCodigo: schema.categoriaConta.codigoExterno,
        categoria: schema.categoriaConta.descricao,
        contaContabil: schema.categoriaConta.contaContabil,
        fornecedor: schema.fornecedor.nome,
        fornecedorRazao: schema.fornecedor.razaoSocial,
        fornecedorDoc: schema.fornecedor.cnpjOuCpf,
      })
      .from(schema.contaPagar)
      .leftJoin(schema.categoriaConta, eq(schema.categoriaConta.id, schema.contaPagar.categoriaId))
      .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.contaPagar.fornecedorId))
      .where(
        and(
          eq(schema.contaPagar.filialId, filialId),
          isNull(schema.contaPagar.dataDelete),
          isNotNull(schema.contaPagar.dataPagamento),
          gte(schema.contaPagar.dataPagamento, de),
          lte(schema.contaPagar.dataPagamento, ate),
        ),
      )
      .orderBy(asc(schema.contaPagar.dataPagamento)),
    db
      .select({
        classificacao: schema.planoContabil.classificacao,
        reduzido: schema.planoContabil.codigoReduzido,
        nome: schema.planoContabil.nome,
      })
      .from(schema.planoContabil)
      .where(eq(schema.planoContabil.organizacaoId, org.organizacaoId)),
  ]);
  const planoMap = new Map(plano.map((p) => [p.classificacao, p]));
  const valorDe = (r: (typeof rows)[number]) => Number(r.valorPago ?? r.valor ?? 0);

  const linhas: string[] = [];
  if (modo === 'detalhe') {
    linhas.push(
      ['Data pagamento', 'Conta contábil', 'Reduzido', 'Nome da conta', 'Categoria', 'Fornecedor', 'CNPJ/CPF', 'Descrição', 'Vencimento', 'Valor pago']
        .join(';'),
    );
    for (const r of rows) {
      const p = r.contaContabil ? planoMap.get(r.contaContabil) : undefined;
      linhas.push(
        [
          dataBr(r.dataPagamento),
          r.contaContabil ?? 'SEM CONTA',
          p?.reduzido ?? '',
          p?.nome ?? '',
          r.categoria ?? 'Sem categoria',
          r.fornecedorRazao || r.fornecedor || '',
          r.fornecedorDoc ?? '',
          r.descricao ?? '',
          dataBr(r.dataVencimento),
          num(valorDe(r)),
        ]
          .map(cel)
          .join(';'),
      );
    }
  } else {
    const grupos = new Map<string, { total: number; qtd: number; categorias: Set<string> }>();
    for (const r of rows) {
      const k = r.contaContabil ?? '';
      const g = grupos.get(k) ?? { total: 0, qtd: 0, categorias: new Set<string>() };
      g.total += valorDe(r);
      g.qtd += 1;
      g.categorias.add(r.categoria ?? 'Sem categoria');
      grupos.set(k, g);
    }
    linhas.push(['Conta contábil', 'Reduzido', 'Nome da conta', 'Qtd pagamentos', 'Total pago', 'Categorias (nossas)'].join(';'));
    // Contas mapeadas em ordem de classificação; "sem conta" por último.
    const chaves = [...grupos.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
    let total = 0;
    for (const k of chaves) {
      const g = grupos.get(k)!;
      const p = k ? planoMap.get(k) : undefined;
      total += g.total;
      linhas.push(
        [k || 'SEM CONTA', p?.reduzido ?? '', p?.nome ?? (k ? '' : 'Categoria sem conta do contador'), g.qtd, num(g.total), [...g.categorias].sort().join(', ')]
          .map(cel)
          .join(';'),
      );
    }
    linhas.push(['TOTAL', '', '', rows.length, num(total), ''].map(cel).join(';'));
  }

  const nomeCasa = filial.nome.normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  const arquivo = `contador-${modo}-${nomeCasa}-${de}-a-${ate}.csv`;
  return new NextResponse('﻿' + linhas.join('\r\n') + '\r\n', {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${arquivo}"`,
    },
  });
}
