// Diagnostico da API EDI da Cielo (mTLS). Roda de packages/db:
//   pnpm exec tsx scripts/testar-cielo-edi-api.ts
//
// Serve pra saber, em 10 segundos, se o problema e' nosso ou deles. Estado
// conhecido (07/08/2026): o gateway responde e exige um JWT emitido pela
// Cielo — ver o bloco de comentario no topo de apps/web/src/lib/cielo-edi.ts.
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(aqui, '../../../.env') });

const { credenciaisEdi, diagnosticar, listarArquivos, baixarArquivo } = await import(
  resolve(aqui, '../../../apps/web/src/lib/cielo-edi.ts')
);

const cred = credenciaisEdi();
if (!cred) {
  console.error('CIELO_EDI_* incompleto no .env (base, client id, token, matriz, cert, key)');
  process.exit(1);
}
console.log('base:', cred.base);

console.log('\n=== diagnostico ===');
console.log(await diagnosticar(cred));

const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const inicio = new Date(Date.now() - 5 * 86_400_000).toLocaleDateString('en-CA', {
  timeZone: 'America/Sao_Paulo',
});
console.log(`\n=== listar ${inicio} -> ${hoje} ===`);
try {
  const arquivos = await listarArquivos(cred, inicio, hoje);
  console.log(`${arquivos.length} arquivo(s):`);
  for (const a of arquivos.slice(0, 15)) console.log(' ·', JSON.stringify(a));
  if (arquivos[0]) {
    console.log('\n=== baixar o primeiro ===');
    const buf = await baixarArquivo(cred, arquivos[0]);
    console.log(
      `${buf.length} bytes · primeira linha: ${buf.toString('latin1').split(/\r?\n/)[0]?.slice(0, 76)}`,
    );
  }
} catch (e) {
  console.error('FALHOU:', (e as Error).message);
}
process.exit(0);
