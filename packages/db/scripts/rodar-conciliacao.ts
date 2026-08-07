// Roda a conciliacao automatica (mesma lib do cron e do botao "Conciliar
// agora") pras filiais, sob demanda:
//
//   pnpm exec tsx scripts/rodar-conciliacao.ts [dataInicio] [dataFim]
//
// Sem argumentos usa os ultimos 14 dias.
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(aqui, '../../../.env') });

const { rodarConciliacaoAutomatica } = await import(
  resolve(aqui, '../../../apps/web/src/lib/conciliacao-automatica.ts')
);
const { db, schema } = await import('@concilia/db');

const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const dataFim = process.argv[3] ?? hoje;
const dataInicio =
  process.argv[2] ??
  new Date(Date.now() - 14 * 86_400_000).toLocaleDateString('en-CA', {
    timeZone: 'America/Sao_Paulo',
  });

const filiais = await db
  .select({ id: schema.filial.id, nome: schema.filial.nome })
  .from(schema.filial);

for (const f of filiais) {
  if (/teste/i.test(f.nome)) continue;
  console.log(`\n════ ${f.nome} · ${dataInicio} → ${dataFim} ════`);
  try {
    const r = await rodarConciliacaoAutomatica({ filialId: f.id, dataInicio, dataFim });
    const o = r.operadora.resumo;
    console.log(
      `OPERADORA : ${o.conciliados.qtd} conciliados (R$ ${o.conciliados.valor.toFixed(2)}) · ` +
        `${o.pdvSemCielo.qtd} PDV s/ Cielo (R$ ${o.pdvSemCielo.valor.toFixed(2)}) · ` +
        `${o.cieloSemPdv.qtd} Cielo s/ PDV`,
    );
    const rc = r.recebiveis.resumo;
    console.log(
      `RECEBIVEIS: ${rc.conciliados.qtd} ok · ${rc.vendaSemAgenda.qtd} venda s/ agenda · ` +
        `${rc.agendaSemVenda.qtd} agenda s/ venda · ${rc.tarifas.qtd} tarifas`,
    );
    const b = r.banco.resumo;
    console.log(
      `BANCO     : ${b.conciliados.qtd} grupos pagos (R$ ${b.conciliados.valor.toFixed(2)}) · ` +
        `${b.cieloNaoPago.qtd} nao pagos · ${b.creditoSemCielo.qtd} creditos s/ origem`,
    );
    const bx = r.baixa;
    console.log(
      `BAIXA     : ${bx.total.qtd} pagamentos · COMPLETO ${bx.porEtapa.COMPLETO.qtd} ` +
        `(R$ ${bx.porEtapa.COMPLETO.valor.toFixed(2)}) · a receber ${bx.aguardandoCredito.qtd} · ` +
        `sem Cielo ${bx.porEtapa.NAO_NA_CIELO_VENDA.qtd} · sem agenda ${bx.porEtapa.SEM_AGENDA_RECEBIVEL.qtd} · ` +
        `nao pago ${bx.porEtapa.NAO_PAGO_NO_BANCO.qtd - bx.aguardandoCredito.qtd} · ` +
        `diverg ${bx.porEtapa.DIVERGENCIA_VALOR.qtd}`,
    );
  } catch (e) {
    console.error(`ERRO em ${f.nome}: ${(e as Error).message}`);
  }
}
process.exit(0);
