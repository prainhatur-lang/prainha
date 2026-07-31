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
import { credenciaisEdi, listarArquivos, baixarArquivo, diagnosticar } from '@/lib/cielo-edi';
import { processarCieloVendas, processarCieloRecebiveis } from '@/lib/processadores';
import { hojeBr, diasAtrasBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/** CIELO03 = vendas · CIELO04 = recebiveis. Os demais layouts ficam de fora. */
function classificar(nome: string, tipo: string): 'vendas' | 'recebiveis' | null {
  const s = (nome + ' ' + tipo).toUpperCase();
  if (s.includes('CIELO03')) return 'vendas';
  if (s.includes('CIELO04')) return 'recebiveis';
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

  const resultados: Array<Record<string, unknown>> = [];
  for (const arq of arquivos) {
    const tipo = classificar(arq.nome, arq.tipo);
    if (!tipo) continue;
    try {
      const conteudo = await baixarArquivo(cred, arq);
      const storagePath = `cielo-edi/${arq.data || fim}/${arq.nome || arq.id}`;
      const resumo =
        tipo === 'vendas'
          ? await processarCieloVendas(filialId, conteudo, storagePath)
          : await processarCieloRecebiveis(filialId, conteudo, storagePath);
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
