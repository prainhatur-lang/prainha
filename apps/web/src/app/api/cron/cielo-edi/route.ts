// GET /api/cron/cielo-edi
//
// Busca sozinho os arquivos do EDI Extrato Eletronico da Cielo (CIELO03 =
// vendas, CIELO04 = recebiveis) e processa pelos MESMOS parsers do /upload —
// o que hoje e' feito baixando a mao no portal.
//
// Janela de 10 dias com overlap de proposito: arquivo que a Cielo publica
// atrasado ainda entra, e a dedupe do processador cuida da repeticao.
//
// ⚠️ Enquanto a API da Cielo estiver com 504, esta rota devolve o diagnostico
// em vez de falhar em silencio — o log diz se o problema e' deles ou nosso.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { credenciaisEdi, listarArquivos, baixarArquivo, diagnosticar } from '@/lib/cielo-edi';
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

/** CIELO03 = vendas · CIELO04 = recebiveis · CIELO16 = Pix (recebiveis). */
function classificar(nome: string, tipo: string): 'vendas' | 'recebiveis' | null {
  const s = (nome + ' ' + tipo).toUpperCase();
  if (s.includes('CIELO03')) return 'vendas';
  if (s.includes('CIELO04') || s.includes('CIELO16')) return 'recebiveis';
  return null;
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
    arquivos = await listarArquivos(cred, inicio, fim);
  } catch (e) {
    // nao e' erro nosso: devolve o diagnostico pra saber de quem e' a falha
    const diag = await diagnosticar(cred).catch(() => null);
    console.error('[cielo-edi]', (e as Error).message);
    return NextResponse.json(
      { ok: false, erro: (e as Error).message, diagnostico: diag, janela: { inicio, fim } },
      { status: 200 },
    );
  }

  // Nome da filial default (a da env) pro auto-split por EC: com hierarquia de
  // grupo comercial na Cielo, um arquivo só pode trazer ECs das DUAS filiais —
  // o roteamento manda cada linha pra filial dona do EC (aprendida do
  // histórico), igual o upload manual já faz. EC inédito cai na filial da env.
  const [filialDefault] = await db
    .select({ nome: schema.filial.nome })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);

  const resultados: Array<Record<string, unknown>> = [];
  for (const arq of arquivos) {
    const tipo = classificar(arq.nome, arq.tipo);
    if (!tipo) continue;
    try {
      const conteudo = await baixarArquivo(cred, arq);
      const storagePath = `cielo-edi/${arq.data || fim}/${arq.nome || arq.id}`;
      const ecs = extrairEcsCielo(conteudo, tipo === 'vendas' ? 'CIELO_VENDAS' : 'CIELO_RECEBIVEIS');
      const rot: RoteamentoEc = {
        mapaEc: await mapearEcParaFilial(ecs),
        filialNomePadrao: filialDefault?.nome ?? '',
      };
      const resumo =
        tipo === 'vendas'
          ? await processarCieloVendas(filialId, conteudo, storagePath, rot)
          : await processarCieloRecebiveis(filialId, conteudo, storagePath, rot);
      resultados.push({ arquivo: arq.nome || arq.id, tipo, ...resumo });
    } catch (e) {
      resultados.push({ arquivo: arq.nome || arq.id, tipo, erro: (e as Error).message });
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
