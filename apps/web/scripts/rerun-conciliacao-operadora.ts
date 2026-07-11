// Rerun conciliacao OPERADORA. Roda sem auth (chama o lib direto). Usar so localmente.
// Revalidacao 11/07/2026: dataFim por filial = ultima data com venda Cielo carregada
// (evita PDV_SEM_CIELO falso em dias sem arquivo da operadora).

import { rodarConciliacaoOperadora } from '../src/lib/conciliacao-operadora';

const FILIAIS = [
  { nome: 'Prainha Bar 0001', id: '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9', dataFim: '2026-07-05' },
  { nome: 'Tabuara 0002', id: 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7', dataFim: '2026-07-05' },
];

const dataInicio = '2026-05-01';

async function main() {
  for (const f of FILIAIS) {
    console.log(`\n>>> ${f.nome} (${dataInicio} ate ${f.dataFim})`);
    const t0 = Date.now();
    try {
      const r = await rodarConciliacaoOperadora({
        filialId: f.id,
        dataInicio,
        dataFim: f.dataFim,
      });
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`OK em ${dt}s. Excecoes criadas: ${r.excecoesCriadas}`);
      console.log('Resumo:', JSON.stringify(r.resumo, null, 2));
    } catch (e) {
      console.error('ERRO:', (e as Error).message);
    }
  }
  process.exit(0);
}

main();
