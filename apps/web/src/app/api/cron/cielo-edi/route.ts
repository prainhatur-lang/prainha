// GET /api/cron/cielo-edi
//
// Busca sozinho os arquivos do EDI Extrato Eletronico da Cielo (CIELO03 =
// vendas, CIELO04 = recebiveis, CIELO16 = Pix) e processa pelos MESMOS
// parsers do /upload — o que antes era feito baixando a mao no portal.
//
// Janela de 10 dias com overlap de proposito: arquivo que a Cielo publica
// atrasado ainda entra, e a dedupe do processador cuida da repeticao.
//
// Roda 11:30/21:30 (janela em que a Cielo publica), ANTES do extrato-inter e
// da conciliacao-diaria — a ordem importa: conciliar antes de ingerir e'
// conciliar contra dado velho.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { credenciaisEdi, gerarLinks, baixarArquivo, obterToken } from '@/lib/cielo-edi';
import {
  processarCieloVendas,
  processarCieloRecebiveis,
  extrairEcsCielo,
  mapearEcParaFilial,
  type RoteamentoEc,
} from '@/lib/processadores';
import { hojeBr, diasAtrasBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * CIELO03 = vendas · CIELO04 = recebiveis · CIELO16 = Pix, que e' os DOIS: o
 * Pix da maquininha nao aparece no CIELO03, entao o mesmo arquivo alimenta a
 * venda (pro PDV casar) e o recebivel (pro banco casar).
 */
function classificar(nome: string): Array<'vendas' | 'recebiveis'> {
  const s = nome.toUpperCase();
  if (s.includes('CIELO03')) return ['vendas'];
  if (s.includes('CIELO04')) return ['recebiveis'];
  if (s.includes('CIELO16')) return ['vendas', 'recebiveis'];
  return [];
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const cred = credenciaisEdi();
  if (!cred) {
    return NextResponse.json({ ok: false, motivo: 'CIELO_EDI_* nao configurado' }, { status: 200 });
  }

  const filialId = process.env.CIELO_EDI_FILIAL_ID;
  if (!filialId) {
    return NextResponse.json({ ok: false, motivo: 'CIELO_EDI_FILIAL_ID nao configurado' }, { status: 200 });
  }

  const fim = hojeBr();
  const inicio = diasAtrasBr(10);

  let arquivos;
  try {
    // Um token so pra toda a execucao (vale 600s).
    const token = await obterToken(cred);
    arquivos = await gerarLinks(cred, inicio, fim, undefined, token);
  } catch (e) {
    console.error('[cielo-edi]', (e as Error).message);
    return NextResponse.json(
      { ok: false, erro: (e as Error).message, janela: { inicio, fim } },
      { status: 200 },
    );
  }

  // Nome da filial default (a da env) pro auto-split por EC: com hierarquia de
  // grupo comercial na Cielo, um arquivo so pode trazer ECs das DUAS filiais —
  // o roteamento manda cada linha pra filial dona do EC (aprendida do
  // historico), igual o upload manual ja faz. EC inedito cai na filial da env.
  const [filialDefault] = await db
    .select({ nome: schema.filial.nome })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);

  const resultados: Array<Record<string, unknown>> = [];
  for (const arq of arquivos) {
    const tipos = classificar(arq.nome);
    if (tipos.length === 0) continue;
    let conteudo: Buffer;
    try {
      conteudo = await baixarArquivo(cred, arq);
    } catch (e) {
      resultados.push({ arquivo: arq.nome, erro: (e as Error).message });
      continue;
    }
    const storagePath = `cielo-edi/${arq.data || fim}/${arq.nome}`;
    for (const tipo of tipos) {
      try {
        const ecs = extrairEcsCielo(conteudo, tipo === 'vendas' ? 'CIELO_VENDAS' : 'CIELO_RECEBIVEIS');
        const rot: RoteamentoEc = {
          mapaEc: await mapearEcParaFilial(ecs),
          filialNomePadrao: filialDefault?.nome ?? '',
        };
        const resumo =
          tipo === 'vendas'
            ? await processarCieloVendas(filialId, conteudo, storagePath, rot)
            : await processarCieloRecebiveis(filialId, conteudo, storagePath, rot);
        resultados.push({ arquivo: arq.nome, tipo, ...resumo });
      } catch (e) {
        resultados.push({ arquivo: arq.nome, tipo, erro: (e as Error).message });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    janela: { inicio, fim },
    disponiveis: arquivos.length,
    processados: resultados.length,
    resultados,
  });
}
