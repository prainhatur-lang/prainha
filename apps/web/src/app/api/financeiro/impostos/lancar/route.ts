// POST /api/financeiro/impostos/lancar — guia conferida vira contas a pagar.
// Body JSON: { guiaId, acao: 'lancar' | 'descartar', tipo, contribuinteCnpj,
//   contribuinteNome, competencia, vencimento, valor, codigoBarras, descricao,
//   regra, rateio: [{ filialId, percentual }] }
//
//   FOLHA com pagadora (E.B.): conta da guia inteira na E.B. + em cada casa uma
//     conta "repasse" com fornecedor E.B. (o Pix da casa pra E.B.).
//   FOLHA sem filial pagadora (Lelis): só as contas de repasse nas casas.
//   PERCENTUAL / CASA: a conta do imposto direto em cada casa, com a parte dela.
// Toda conta leva a guia como boleto (aparece em Pedidos Pix) e o código de
// barras na observação.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { negarSemPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { hojeBr } from '@/lib/datas';
import {
  NOME_TIPO,
  PERM_IMPOSTO_LANCAR,
  TIPOS_IMPOSTO,
  categoriaDoImposto,
  dividirValor,
  fornecedorPagadorNaCasa,
  type RegraImposto,
  type TipoImposto,
} from '@/lib/impostos/guia';
import { EB_CNPJ } from '@/lib/eb/faturas';
import type { schema as S } from '@concilia/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Body {
  guiaId?: string;
  acao?: 'lancar' | 'descartar';
  tipo?: string;
  contribuinteCnpj?: string | null;
  contribuinteNome?: string | null;
  competencia?: string | null;
  vencimento?: string;
  valor?: number;
  codigoBarras?: string | null;
  descricao?: string | null;
  regra?: string;
  rateio?: Array<{ filialId: string; percentual: number }>;
}

const nomeComp = (c: string | null) => (c ? `${c.slice(5, 7)}/${c.slice(0, 4)}` : '');

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const negado = await negarSemPerm(user.id, PERM_IMPOSTO_LANCAR);
  if (negado) return negado;

  const b = (await req.json().catch(() => ({}))) as Body;
  if (!b.guiaId || !/^[0-9a-f-]{36}$/i.test(b.guiaId)) {
    return NextResponse.json({ error: 'guiaId inválido' }, { status: 400 });
  }
  const [guia] = await db.select().from(schema.impostoGuia).where(eq(schema.impostoGuia.id, b.guiaId)).limit(1);
  if (!guia) return NextResponse.json({ error: 'guia não encontrada' }, { status: 404 });
  if (guia.status === 'LANCADA') return NextResponse.json({ error: 'essa guia já foi lançada' }, { status: 409 });

  if (b.acao === 'descartar') {
    await db.update(schema.impostoGuia).set({ status: 'DESCARTADA' }).where(eq(schema.impostoGuia.id, guia.id));
    return NextResponse.json({ ok: true, descartada: true });
  }

  // ── campos conferidos ──
  const tipo = (TIPOS_IMPOSTO as readonly string[]).includes(b.tipo ?? '') ? (b.tipo as TipoImposto) : null;
  if (!tipo) return NextResponse.json({ error: 'escolha o tipo do imposto' }, { status: 400 });
  const venc = b.vencimento ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(venc)) return NextResponse.json({ error: 'vencimento inválido' }, { status: 400 });
  const valor = Math.round(Number(b.valor) * 100) / 100;
  if (!Number.isFinite(valor) || valor <= 0) return NextResponse.json({ error: 'valor inválido' }, { status: 400 });
  const competencia = b.competencia && /^\d{4}-\d{2}$/.test(b.competencia) ? b.competencia : null;
  const cnpj = (b.contribuinteCnpj ?? '').replace(/\D/g, '') || null;
  const barras = (b.codigoBarras ?? '').replace(/\D/g, '') || null;
  const regra: RegraImposto = b.regra === 'FOLHA' || b.regra === 'PERCENTUAL' ? b.regra : 'CASA';

  const rateioIn = (b.rateio ?? [])
    .map((r) => ({ filialId: String(r.filialId), percentual: Math.round(Number(r.percentual) * 100) / 100 }))
    .filter((r) => r.percentual > 0);
  if (!rateioIn.length) return NextResponse.json({ error: 'informe o % de pelo menos uma casa' }, { status: 400 });
  const soma = Math.round(rateioIn.reduce((s, r) => s + r.percentual, 0) * 100) / 100;
  if (Math.abs(soma - 100) > 0.01) {
    return NextResponse.json({ error: `os percentuais somam ${soma.toFixed(2)}% — têm que dar 100%` }, { status: 400 });
  }
  const minhas = new Set((await filiaisDoUsuario(user.id)).map((f) => f.id));
  const fora = rateioIn.find((r) => !minhas.has(r.filialId));
  if (fora) return NextResponse.json({ error: 'casa sem acesso no rateio' }, { status: 403 });
  if (new Set(rateioIn.map((r) => r.filialId)).size !== rateioIn.length) {
    return NextResponse.json({ error: 'casa repetida no rateio' }, { status: 400 });
  }

  // Quem paga a guia inteira: E.B. (filial própria) ou Lelis (sem filial).
  const ebPaga = regra === 'FOLHA' && cnpj === EB_CNPJ && guia.pagadoraFilialId;
  const repassa = regra === 'FOLHA' && !!cnpj && (cnpj === EB_CNPJ || !!guia.pagadoraNome);
  const pagadoraNome = guia.pagadoraNome ?? (cnpj === EB_CNPJ ? 'E.B. Serviços' : 'Lelis');

  const partes = dividirValor(valor, rateioIn);
  const rotulo = `${NOME_TIPO[tipo]}${competencia ? ` ${nomeComp(competencia)}` : ''}`;
  const descGuia = b.descricao?.trim() || rotulo;
  const obsBase = [
    barras ? `Código de barras: ${barras}` : null,
    cnpj ? `Contribuinte: ${b.contribuinteNome ?? ''} ${cnpj}`.trim() : null,
    `Guia de imposto lançada em /financeiro/impostos`,
  ]
    .filter(Boolean)
    .join('\n');

  // Fornecedor e categoria por casa (fora da transação: só lê ou cria cadastro).
  const preparo = await Promise.all(
    partes.map(async (p) => ({
      ...p,
      categoriaId: await categoriaDoImposto(p.filialId, tipo),
      fornecedorId: repassa && cnpj && p.filialId !== guia.pagadoraFilialId ? await fornecedorPagadorNaCasa(p.filialId, cnpj) : null,
    })),
  );

  const agora = new Date();
  const dataCadastro = new Date(`${hojeBr()}T12:00:00-03:00`);
  const comum = {
    dataVencimento: venc,
    competencia,
    origem: 'MANUAL',
    boletoStoragePath: guia.arquivoPath,
    criadoPor: user.id,
    criadoEm: agora,
    dataCadastro,
  } satisfies Partial<typeof schema.contaPagar.$inferInsert>;

  const resultado = await db.transaction(async (tx) => {
    // trava contra clique duplo: só um lançamento por guia
    const [trava] = await tx
      .select({ status: schema.impostoGuia.status })
      .from(schema.impostoGuia)
      .where(eq(schema.impostoGuia.id, guia.id))
      .for('update');
    if (trava?.status === 'LANCADA') return null;
    let contaGuiaId: string | null = null;
    if (ebPaga) {
      const [c] = await tx
        .insert(schema.contaPagar)
        .values({
          ...comum,
          filialId: guia.pagadoraFilialId!,
          valor: valor.toFixed(2),
          descricao: `${descGuia} — guia inteira (as casas repassam a parte delas)`,
          observacao: obsBase,
        })
        .returning({ id: schema.contaPagar.id });
      contaGuiaId = c!.id;
    }
    const rateio: S.ImpostoRateio[] = [];
    for (const p of preparo) {
      const ehPagadora = ebPaga && p.filialId === guia.pagadoraFilialId;
      if (ehPagadora) {
        rateio.push({ filialId: p.filialId, percentual: p.percentual, valor: p.valor, contaPagarId: contaGuiaId });
        continue;
      }
      const descricao = repassa
        ? `Repasse ${pagadoraNome} — ${descGuia} (${p.percentual.toLocaleString('pt-BR')}%)`
        : partes.length > 1
          ? `${descGuia} (${p.percentual.toLocaleString('pt-BR')}% da guia de R$ ${valor.toFixed(2).replace('.', ',')})`
          : descGuia;
      const [c] = await tx
        .insert(schema.contaPagar)
        .values({
          ...comum,
          filialId: p.filialId,
          fornecedorId: p.fornecedorId,
          categoriaId: p.categoriaId,
          valor: p.valor.toFixed(2),
          descricao,
          observacao: repassa
            ? `${obsBase}\nPix pra ${pagadoraNome}, que paga a guia inteira de R$ ${valor.toFixed(2).replace('.', ',')}.`
            : obsBase,
        })
        .returning({ id: schema.contaPagar.id });
      rateio.push({ filialId: p.filialId, percentual: p.percentual, valor: p.valor, contaPagarId: c!.id });
    }
    await tx
      .update(schema.impostoGuia)
      .set({
        tipo,
        contribuinteCnpj: cnpj,
        contribuinteNome: b.contribuinteNome ?? guia.contribuinteNome,
        competencia,
        vencimento: venc,
        valor: valor.toFixed(2),
        codigoBarras: barras,
        descricao: descGuia,
        regra,
        rateio,
        contaGuiaId,
        status: 'LANCADA',
        lancadoPor: user.id,
        lancadoEm: agora,
      })
      .where(eq(schema.impostoGuia.id, guia.id));
    return { contaGuiaId, rateio };
  });

  if (!resultado) return NextResponse.json({ error: 'essa guia já foi lançada' }, { status: 409 });
  return NextResponse.json({ ok: true, ...resultado });
}
