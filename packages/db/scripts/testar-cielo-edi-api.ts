// Diagnostico da API EDI da Cielo (mTLS). Roda de packages/db:
//   pnpm exec tsx scripts/testar-cielo-edi-api.ts
//
// Serve pra saber, em 10 segundos, em que passo a integracao para: token
// (Keycloak) -> link/generate -> download no S3.
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(aqui, '../../../.env') });

const { credenciaisEdi, diagnosticar, gerarLinks, baixarArquivo } = await import(
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
console.log(`\n=== link/generate ${inicio} -> ${hoje} ===`);
try {
  const arquivos = await gerarLinks(cred, inicio, hoje);
  console.log(`${arquivos.length} arquivo(s):`);
  for (const a of arquivos) console.log(` · ${a.nome} (${a.data})`);
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
