// Importa os arquivos do EDI pela API da Cielo (mesma logica do cron
// /api/cron/cielo-edi), pra rodar sob demanda de fora da Vercel.
//
//   pnpm exec tsx scripts/importar-edi-api.ts [dias]
//
// Roteia cada linha pra filial dona do EC (hierarquia de grupo comercial
// traz as duas lojas no mesmo arquivo) e deduplica via ON CONFLICT.
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(aqui, '../../../.env') });

const { credenciaisEdi, gerarLinks, baixarArquivo, obterToken } = await import(
  resolve(aqui, '../../../apps/web/src/lib/cielo-edi.ts')
);
const { processarCieloVendas, processarCieloRecebiveis, extrairEcsCielo, mapearEcParaFilial } =
  await import(resolve(aqui, '../../../apps/web/src/lib/processadores.ts'));

const DIAS = Number(process.argv[2] ?? 10);
const PRAINHA = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';
const filialPadrao = process.env.CIELO_EDI_FILIAL_ID || PRAINHA;

const cred = credenciaisEdi();
if (!cred) {
  console.error('CIELO_EDI_* incompleto no .env');
  process.exit(1);
}

const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const inicio = new Date(Date.now() - DIAS * 86_400_000).toLocaleDateString('en-CA', {
  timeZone: 'America/Sao_Paulo',
});

const classificar = (nome: string): 'vendas' | 'recebiveis' | null => {
  const s = nome.toUpperCase();
  if (s.includes('CIELO03')) return 'vendas';
  if (s.includes('CIELO04') || s.includes('CIELO16')) return 'recebiveis';
  return null;
};

console.log(`janela ${inicio} -> ${hoje}`);
const token = await obterToken(cred);
const arquivos = await gerarLinks(cred, inicio, hoje, undefined, token);
console.log(`${arquivos.length} arquivo(s) disponiveis\n`);

let vendasIns = 0;
let recebIns = 0;
for (const arq of arquivos) {
  const tipo = classificar(arq.nome);
  if (!tipo) continue;
  try {
    const conteudo = await baixarArquivo(cred, arq);
    const ecs = extrairEcsCielo(conteudo, tipo === 'vendas' ? 'CIELO_VENDAS' : 'CIELO_RECEBIVEIS');
    const rot = { mapaEc: await mapearEcParaFilial(ecs), filialNomePadrao: '' };
    const storagePath = `cielo-edi/${arq.data}/${arq.nome}`;
    const r =
      tipo === 'vendas'
        ? await processarCieloVendas(filialPadrao, conteudo, storagePath, rot)
        : await processarCieloRecebiveis(filialPadrao, conteudo, storagePath, rot);
    if (tipo === 'vendas') vendasIns += r.registrosInseridos;
    else recebIns += r.registrosInseridos;
    console.log(
      `${arq.nome}: ${r.registrosInseridos}/${r.registrosLidos} novos · ECs ${(r.estabelecimentos ?? []).join(',')}`,
    );
  } catch (e) {
    console.error(`${arq.nome}: ERRO ${(e as Error).message}`);
  }
}
console.log(`\ntotal novo: ${vendasIns} vendas · ${recebIns} recebiveis`);
process.exit(0);
