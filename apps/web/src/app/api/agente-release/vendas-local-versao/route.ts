// GET /api/agente-release/vendas-local-versao — só o hash da versão publicada
// do vendas-local, pra loop de auto-atualização checar sem baixar os ~700KB
// do arquivo inteiro a cada consulta. Mesmo hash que /api/versao devolve na
// loja (sha256 do arquivo, 8 primeiros caracteres).

import { NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const dynamic = 'force-dynamic';

let cache: { versao: string; em: number } | null = null;

export async function GET() {
  const agora = Date.now();
  if (!cache || agora - cache.em > 60_000) {
    const caminho = path.join(process.cwd(), 'public', 'agente-release', 'vendas-local-server.mjs');
    const buf = readFileSync(caminho);
    const versao = createHash('sha256').update(buf).digest('hex').slice(0, 8);
    cache = { versao, em: agora };
  }
  return NextResponse.json({ versao: cache.versao });
}
