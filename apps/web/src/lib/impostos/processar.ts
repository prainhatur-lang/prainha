// Núcleo do ler/lançar guia de imposto — usado pela tela /financeiro/impostos
// (usuário logado) e pelo link do contador (/contador/impostos, sem login).
// Cada rota faz a própria autenticação e passa quem responde + as casas.

import { createAdminClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, ne } from 'drizzle-orm';
import { hashArquivo } from '@/lib/pedido-sem-nota';
import { hojeBr } from '@/lib/datas';
import { EB_CNPJ } from '@/lib/eb/faturas';
import type { schema as S } from '@concilia/db';
import {
  BUCKET_IMPOSTO,
  MIMES_IMPOSTO,
  NOME_TIPO,
  NaoEGuia,
  TIPOS_IMPOSTO,
  categoriaDoImposto,
  cnpjDoRateio,
  dividirValor,
  filialDoDepartamento,
  fornecedorPagadorNaCasa,
  lerArquivoImposto,
  proporRateio,
  type RegraImposto,
  type TipoImposto,
} from '@/lib/impostos/guia';

export interface Resposta {
  status: number;
  body: Record<string, unknown>;
}

const MAX_SIZE = 4 * 1024 * 1024;

function extOf(mime: string): string {
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  return 'jpg';
}

/** Reabre uma guia LIDA (conferir depois): guia + proposta. */
export async function reabrirGuia(guiaId: string): Promise<Resposta> {
  if (!/^[0-9a-f-]{36}$/i.test(guiaId)) return { status: 400, body: { error: 'guiaId inválido' } };
  const [g] = await db.select().from(schema.impostoGuia).where(eq(schema.impostoGuia.id, guiaId)).limit(1);
  if (!g) return { status: 404, body: { error: 'guia não encontrada' } };
  const proposta = await proporRateio({ tipo: (g.tipo as never) ?? null, contribuinteCnpj: g.contribuinteCnpj, competencia: g.competencia });
  return { status: 200, body: { ok: true, repetida: true, guia: g, proposta } };
}

/** Lê o arquivo: guia → imposto_guia LIDA + proposta; rateio → imposto_rateio_contador. */
export async function lerArquivo(arquivo: File, usuarioId: string): Promise<Resposta> {
  if (arquivo.size > MAX_SIZE) {
    return { status: 413, body: { error: 'arquivo maior que 4 MB — tire a foto de novo ou mande o PDF' } };
  }
  let mime = (arquivo.type || '').toLowerCase();
  if (mime === 'image/jpg') mime = 'image/jpeg';
  if (!mime && arquivo.name.toLowerCase().endsWith('.pdf')) mime = 'application/pdf';
  if (!MIMES_IMPOSTO.has(mime)) {
    return { status: 400, body: { error: `formato não aceito (${mime || 'desconhecido'}) — use PDF, JPG ou PNG` } };
  }
  const buf = Buffer.from(await arquivo.arrayBuffer());
  const hash = hashArquivo(buf);

  const [existe] = await db.select().from(schema.impostoGuia).where(eq(schema.impostoGuia.arquivoHash, hash)).limit(1);
  if (existe && existe.status !== 'ERRO') {
    const proposta = await proporRateio({
      tipo: (existe.tipo as never) ?? null,
      contribuinteCnpj: existe.contribuinteCnpj,
      competencia: existe.competencia,
    });
    return { status: 200, body: { ok: true, repetida: true, guia: existe, proposta } };
  }

  let lido;
  try {
    lido = await lerArquivoImposto(buf, mime, arquivo.name);
  } catch (e) {
    const msg = (e as Error).message;
    return { status: e instanceof NaoEGuia ? 422 : 502, body: { error: msg } };
  }

  const path = `impostos/${hash}.${extOf(mime)}`;
  const supa = await createAdminClient();
  const up = await supa.storage.from(BUCKET_IMPOSTO).upload(path, buf, { contentType: mime, upsert: true });
  if (up.error) return { status: 500, body: { error: `não guardei o arquivo: ${up.error.message}` } };

  // ── RATEIO do contador (não é guia): guarda o valor de cada casa ──
  if (lido.tipo === 'rateio') {
    const r = lido.rateio;
    const cnpj = cnpjDoRateio(r);
    if (!cnpj) return { status: 422, body: { error: 'li o rateio, mas não sei de qual empresa é (E.B. ou Lelis)' } };
    if (!r.competencia) return { status: 422, body: { error: 'li o rateio, mas não achei o mês (competência)' } };
    const linhas = await Promise.all(
      r.linhas.map(async (l) => ({
        imposto: l.imposto,
        departamento: l.departamento,
        filialId: await filialDoDepartamento(cnpj, l.departamento),
        valor: l.valor,
      })),
    );
    const valores = {
      cnpj,
      competencia: r.competencia,
      linhas,
      totais: r.totais,
      arquivoPath: path,
      arquivoHash: hash,
      lido: r.bruto,
      criadoPor: usuarioId,
      criadoEm: new Date(),
    };
    const t = schema.impostoRateioContador;
    const [salvo] = await db
      .insert(t)
      .values(valores)
      .onConflictDoUpdate({ target: [t.cnpj, t.competencia], set: valores })
      .returning();
    const semCasa = linhas.filter((l) => !l.filialId).map((l) => l.departamento);
    // guias dessa empresa/competência já lidas e não lançadas passam a usar o rateio
    return {
      status: 200,
      body: {
        ok: true,
        rateio: salvo,
        aviso: semCasa.length ? `Departamento sem casa: ${[...new Set(semCasa)].join(', ')}` : null,
      },
    };
  }

  const lida = lido.guia;
  // Mesmo código de barras já lançado = guia em dobro (o DAM do ISS de 13/08 foi pago 2x).
  let duplicada: { id: string; status: string; lancadoEm: Date | null } | null = null;
  if (lida.codigoBarras) {
    const [d] = await db
      .select({ id: schema.impostoGuia.id, status: schema.impostoGuia.status, lancadoEm: schema.impostoGuia.lancadoEm })
      .from(schema.impostoGuia)
      .where(and(eq(schema.impostoGuia.codigoBarras, lida.codigoBarras), ne(schema.impostoGuia.status, 'DESCARTADA')))
      .limit(1);
    duplicada = d ?? null;
  }

  const proposta = await proporRateio(lida);
  const valores = {
    arquivoPath: path,
    arquivoHash: hash,
    arquivoNome: arquivo.name.slice(0, 200),
    mime,
    lido: lida.bruto,
    erro: null,
    tipo: lida.tipo,
    contribuinteCnpj: lida.contribuinteCnpj,
    contribuinteNome: lida.contribuinteNome?.slice(0, 200) ?? null,
    competencia: lida.competencia,
    vencimento: lida.vencimento,
    valor: lida.valor === null ? null : lida.valor.toFixed(2),
    codigoBarras: lida.codigoBarras,
    descricao: lida.descricao,
    regra: proposta.regra,
    pagadoraFilialId: proposta.pagadoraFilialId,
    pagadoraNome: proposta.pagadoraNome || null,
    status: 'LIDA',
    criadoPor: usuarioId,
    criadoEm: new Date(),
  };
  const [guia] = existe
    ? await db.update(schema.impostoGuia).set(valores).where(eq(schema.impostoGuia.id, existe.id)).returning()
    : await db.insert(schema.impostoGuia).values(valores).returning();

  return { status: 200, body: { ok: true, guia, proposta, duplicada } };
}

export interface BodyLancar {
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
  /** valor (opcional): R$ exato da casa — vale quando a soma bate com a guia. */
  rateio?: Array<{ filialId: string; percentual: number; valor?: number | null }>;
}

const nomeComp = (c: string | null) => (c ? `${c.slice(5, 7)}/${c.slice(0, 4)}` : '');

export async function lancarGuia(
  b: BodyLancar,
  usuarioId: string,
  filiaisPermitidas: Set<string>,
  origemTexto = 'Guia de imposto lançada em /financeiro/impostos',
): Promise<Resposta> {
  if (!b.guiaId || !/^[0-9a-f-]{36}$/i.test(b.guiaId)) return { status: 400, body: { error: 'guiaId inválido' } };
  const [guia] = await db.select().from(schema.impostoGuia).where(eq(schema.impostoGuia.id, b.guiaId)).limit(1);
  if (!guia) return { status: 404, body: { error: 'guia não encontrada' } };
  if (guia.status === 'LANCADA') return { status: 409, body: { error: 'essa guia já foi lançada' } };

  if (b.acao === 'descartar') {
    await db.update(schema.impostoGuia).set({ status: 'DESCARTADA' }).where(eq(schema.impostoGuia.id, guia.id));
    return { status: 200, body: { ok: true, descartada: true } };
  }

  // ── campos conferidos ──
  const tipo = (TIPOS_IMPOSTO as readonly string[]).includes(b.tipo ?? '') ? (b.tipo as TipoImposto) : null;
  if (!tipo) return { status: 400, body: { error: 'escolha o tipo do imposto' } };
  const venc = b.vencimento ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(venc)) return { status: 400, body: { error: 'vencimento inválido' } };
  const valor = Math.round(Number(b.valor) * 100) / 100;
  if (!Number.isFinite(valor) || valor <= 0) return { status: 400, body: { error: 'valor inválido' } };
  const competencia = b.competencia && /^\d{4}-\d{2}$/.test(b.competencia) ? b.competencia : null;
  const cnpj = (b.contribuinteCnpj ?? '').replace(/\D/g, '') || null;
  const barras = (b.codigoBarras ?? '').replace(/\D/g, '') || null;
  const regra: RegraImposto = b.regra === 'FOLHA' || b.regra === 'PERCENTUAL' ? b.regra : 'CASA';

  const bruto = (b.rateio ?? []).map((r) => ({
    filialId: String(r.filialId),
    percentual: Math.round(Number(r.percentual) * 100) / 100 || 0,
    valor: r.valor === null || r.valor === undefined ? null : Math.round(Number(r.valor) * 100) / 100,
  }));
  // R$ exato de cada casa (rateio do contador): vale quando TODA casa do rateio veio com valor.
  const comValores = bruto.filter((r) => r.valor !== null && Number.isFinite(r.valor) && r.valor > 0);
  const comValor = comValores.length > 0 && bruto.every((r) => r.percentual <= 0 || (r.valor ?? 0) > 0);
  let rateioIn: Array<{ filialId: string; percentual: number; valor: number | null }>;
  if (comValor) {
    const somaValores = Math.round(comValores.reduce((s, r) => s + r.valor!, 0) * 100) / 100;
    if (Math.abs(somaValores - valor) > 0.01) {
      return {
        status: 400,
        body: {
          error: `os valores das casas somam R$ ${somaValores.toFixed(2).replace('.', ',')} e a guia é R$ ${valor.toFixed(2).replace('.', ',')}`,
        },
      };
    }
    rateioIn = comValores.map((r) => ({ ...r, percentual: Math.round((r.valor! / valor) * 10000) / 100 }));
  } else {
    rateioIn = bruto.filter((r) => r.percentual > 0).map((r) => ({ ...r, valor: null }));
    if (!rateioIn.length) return { status: 400, body: { error: 'informe o % de pelo menos uma casa' } };
    const soma = Math.round(rateioIn.reduce((s, r) => s + r.percentual, 0) * 100) / 100;
    if (Math.abs(soma - 100) > 0.011) {
      return { status: 400, body: { error: `os percentuais somam ${soma.toFixed(2)}% — têm que dar 100%` } };
    }
  }
  const fora = rateioIn.find((r) => !filiaisPermitidas.has(r.filialId));
  if (fora) return { status: 403, body: { error: 'casa sem acesso no rateio' } };
  if (new Set(rateioIn.map((r) => r.filialId)).size !== rateioIn.length) {
    return { status: 400, body: { error: 'casa repetida no rateio' } };
  }

  // Quem paga a guia inteira: E.B. (filial própria) ou Lelis (sem filial).
  const ebPaga = regra === 'FOLHA' && cnpj === EB_CNPJ && guia.pagadoraFilialId;
  const repassa = regra === 'FOLHA' && !!cnpj && (cnpj === EB_CNPJ || !!guia.pagadoraNome);
  const pagadoraNome = guia.pagadoraNome ?? (cnpj === EB_CNPJ ? 'E.B. Serviços' : 'Lelis');

  const partes = comValor
    ? rateioIn.map((r) => ({ filialId: r.filialId, percentual: r.percentual, valor: r.valor! }))
    : dividirValor(valor, rateioIn);
  const rotulo = `${NOME_TIPO[tipo]}${competencia ? ` ${nomeComp(competencia)}` : ''}`;
  const descGuia = b.descricao?.trim() || rotulo;
  const obsBase = [
    barras ? `Código de barras: ${barras}` : null,
    cnpj ? `Contribuinte: ${b.contribuinteNome ?? ''} ${cnpj}`.trim() : null,
    origemTexto,
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
    criadoPor: usuarioId,
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
        lancadoPor: usuarioId,
        lancadoEm: agora,
      })
      .where(eq(schema.impostoGuia.id, guia.id));
    return { contaGuiaId, rateio };
  });

  if (!resultado) return { status: 409, body: { error: 'essa guia já foi lançada' } };
  return { status: 200, body: { ok: true, ...resultado } };
}
