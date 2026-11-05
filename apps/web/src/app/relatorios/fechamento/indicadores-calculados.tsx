// Bloco "Indicadores calculados" do Fechamento (04/11/2026).
// Mostra só o que já tem dado no banco; cada cartão some sozinho se a consulta falhou.

import { brl, int } from '@/lib/format';
import type { IndicadoresFechamento } from '@/lib/fechamento-indicadores';

const pct = (v: number) => `${v.toFixed(1).replace('.', ',')}%`;
const num1 = (v: number) => v.toFixed(1).replace('.', ',');

function fmtData(s: string | null) {
  if (!s) return '—';
  const [a, m, d] = s.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

function Cartao({ titulo, children, nota }: { titulo: string; children: React.ReactNode; nota?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
      <p className="mb-2 text-xs font-semibold text-slate-700">{titulo}</p>
      {children}
      {nota && <p className="mt-2 text-[11px] leading-snug text-slate-400">{nota}</p>}
    </div>
  );
}

function Linha({ k, v, forte, cor }: { k: string; v: string; forte?: boolean; cor?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5 text-xs">
      <span className="text-slate-600">{k}</span>
      <span className={`shrink-0 ${forte ? 'font-semibold' : 'font-medium'} ${cor ?? 'text-slate-900'}`}>{v}</span>
    </div>
  );
}

export function IndicadoresCalculados({
  ind,
  setores,
  faturamento,
  custoCltTotal,
}: {
  ind: IndicadoresFechamento | null;
  setores: Array<{ setor: string; total: number; pessoas: number }> | null;
  faturamento: number;
  custoCltTotal: number;
}) {
  if (!ind) return null;
  const { praca, cmv, cartao, ocupacao, reservas, espera, fluxo, impostos, notas, fiado } = ind;
  const cmvConfiavel = !!cmv && cmv.coberturaPct >= 60;
  const folhaPct = faturamento ? (custoCltTotal / faturamento) * 100 : 0;

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {praca && (
        <Cartao
          titulo="🍹 Bebida × comida (pela praça do KDS)"
          nota="Bebida = praças BAR, DRINKS, adega etc. Produto sem praça cadastrada fica à parte."
        >
          {(() => {
            const tot = praca.bebida + praca.comida + praca.semPraca;
            return (
              <>
                <Linha k="Bebida" v={`${brl(praca.bebida)} · ${pct(tot ? (praca.bebida / tot) * 100 : 0)}`} forte />
                <Linha k="Comida" v={`${brl(praca.comida)} · ${pct(tot ? (praca.comida / tot) * 100 : 0)}`} forte />
                {praca.semPraca > 0 && <Linha k="Sem praça" v={`${brl(praca.semPraca)} · ${pct(tot ? (praca.semPraca / tot) * 100 : 0)}`} cor="text-slate-500" />}
                <div className="mt-2 border-t border-slate-200 pt-1.5">
                  {praca.pracas.slice(0, 8).map((p) => (
                    <Linha key={p.praca} k={`${p.tipo === 'bebida' ? '🍹' : p.tipo === 'comida' ? '🍽️' : '·'} ${p.praca}`} v={brl(p.valor)} />
                  ))}
                </div>
              </>
            );
          })()}
        </Cartao>
      )}

      {cmv && (
        <Cartao
          titulo="📦 CMV pelas saídas do estoque"
          nota={
            cmvConfiavel
              ? 'Custo das baixas de estoque (ficha técnica e revenda) dos itens vendidos no mês, dividido pelo que esses itens venderam.'
              : 'Pouca venda com baixa de estoque custeada — o % ainda não representa a casa. Falta ficha técnica e preço de custo nos produtos.'
          }
        >
          <Linha
            k="CMV"
            v={cmv.vendidoCoberto ? pct(cmv.cmvPct) : '—'}
            forte
            cor={!cmvConfiavel ? 'text-slate-400' : cmv.cmvPct > 38 ? 'text-rose-600' : 'text-emerald-700'}
          />
          <Linha k="Custo das baixas" v={brl(cmv.custo)} />
          <Linha k="Venda com custo" v={`${brl(cmv.vendidoCoberto)} de ${brl(cmv.vendido)}`} />
          <Linha k="Cobertura" v={pct(cmv.coberturaPct)} cor={cmvConfiavel ? 'text-emerald-700' : 'text-amber-600'} />
          {cmvConfiavel && faturamento > 0 && custoCltTotal > 0 && (
            <Linha k="Prime cost (CMV + CLT)" v={pct(cmv.cmvPct + folhaPct)} forte />
          )}
        </Cartao>
      )}

      {setores && setores.length > 0 && (
        <Cartao titulo="👥 Custo CLT por setor" nota="Setor do cadastro do funcionário no RH. Mesmos valores da tabela de custo CLT abaixo.">
          {setores.map((s) => (
            <Linha
              key={s.setor}
              k={`${s.setor} (${s.pessoas})`}
              v={`${brl(s.total)}${faturamento ? ` · ${pct((s.total / faturamento) * 100)} do fat.` : ''}`}
            />
          ))}
        </Cartao>
      )}

      {cartao && (
        <Cartao
          titulo="💳 Taxas de cartão e Pix (adquirente)"
          nota={
            faturamento && cartao.bruto < faturamento * 0.5
              ? 'Pouca venda da adquirente nesta casa — confira se o extrato da Cielo está chegando.'
              : 'Vendas da adquirente pela data da venda.'
          }
        >
          <Linha k="Vendido" v={`${brl(cartao.bruto)} · ${int(cartao.vendas)} vendas`} />
          <Linha k="Taxa paga" v={`${brl(cartao.taxa)} · ${pct(cartao.taxaPct)}`} forte cor="text-rose-600" />
          <Linha k="Líquido" v={brl(cartao.liquido)} />
          <div className="mt-2 border-t border-slate-200 pt-1.5">
            {cartao.porForma.map((f) => (
              <Linha key={f.forma} k={f.forma} v={`${brl(f.taxa)} · ${pct(f.bruto ? (f.taxa / f.bruto) * 100 : 0)}`} />
            ))}
          </div>
          {cartao.aReceberFuturo > 0 && (
            <Linha k="Ainda a cair" v={`${brl(cartao.aReceberFuturo)} até ${fmtData(cartao.aReceberAte)}`} />
          )}
        </Cartao>
      )}

      {ocupacao && (
        <Cartao
          titulo="🪑 Ocupação"
          nota={
            ocupacao.mesas
              ? `Mesas e lugares do cadastro de reservas (${int(ocupacao.mesas)} mesas, ${int(ocupacao.lugares)} lugares). Giro = contas por mesa por dia aberto.`
              : 'Sem mesas no cadastro de reservas — giro não calculado.'
          }
        >
          <Linha k="Pessoas no mês" v={int(ocupacao.pessoas)} forte />
          <Linha k="Pessoas por dia aberto" v={num1(ocupacao.pessoasPorDia)} />
          <Linha k="Pessoas por conta" v={num1(ocupacao.pessoasPorConta)} />
          {faturamento > 0 && ocupacao.pessoas > 0 && <Linha k="Ticket por pessoa" v={brl(faturamento / ocupacao.pessoas)} />}
          {ocupacao.mesas > 0 && <Linha k="Giro de mesa / dia" v={num1(ocupacao.giroMesa)} />}
          {ocupacao.mesas > 0 && faturamento > 0 && ocupacao.dias > 0 && (
            <Linha k="Faturamento por mesa / dia" v={brl(faturamento / ocupacao.dias / ocupacao.mesas)} />
          )}
        </Cartao>
      )}

      {reservas && reservas.total > 0 && (
        <Cartao
          titulo="📅 Reservas"
          nota="No-show conta só reservas que terminaram como não veio × sentou. Fica alto enquanto a recepção não marca &quot;sentou&quot; em quem chegou."
        >
          <Linha k="Reservas no mês" v={int(reservas.total)} forte />
          {reservas.por.map((p) => (
            <Linha key={p.status} k={p.status.replace('_', '-')} v={`${int(p.q)} · ${int(p.pessoas)} pessoas`} />
          ))}
          <Linha k="No-show" v={pct(reservas.noShowPct)} cor="text-amber-600" forte />
        </Cartao>
      )}

      {espera && espera.total > 0 && (
        <Cartao titulo="⏳ Lista de espera" nota="Espera = da entrada na lista até sentar (mediana; ignora registros de mais de 6 h).">
          <Linha k="Entraram na lista" v={`${int(espera.total)} · ${int(espera.pessoas)} pessoas`} forte />
          <Linha k="Sentaram" v={`${int(espera.sentados)} · ${pct(espera.conversaoPct)}`} cor="text-emerald-700" />
          <Linha k="Desistiram" v={int(espera.desistiu)} cor="text-rose-600" />
          <Linha k="Espera típica" v={espera.medianaMin == null ? '—' : `${Math.round(espera.medianaMin)} min`} />
        </Cartao>
      )}

      {fluxo && (
        <Cartao
          titulo="🧭 Fluxo de caixa (a partir de hoje)"
          nota={
            <>
              Contas a pagar em aberto (sem borderô) pelo vencimento; a receber = cartão previsto + delivery em aberto.
              {fluxo.pagarVencidoAntigo > 0 && ` Há ainda ${brl(fluxo.pagarVencidoAntigo)} vencidos há mais de 90 dias (quase tudo resto antigo do PDV anterior).`}
            </>
          }
        >
          <Linha k={`Vencido (90 dias) · ${int(fluxo.pagarVencidoQtd)}`} v={brl(fluxo.pagarVencido)} cor="text-rose-600" forte />
          {['Próximos 30 dias', '31 a 60 dias', '61 a 90 dias'].map((rot, i) => (
            <Linha key={rot} k={`A pagar · ${rot}`} v={brl(fluxo.pagar[i])} />
          ))}
          <div className="mt-2 border-t border-slate-200 pt-1.5">
            <Linha k="Cartão a cair (90 dias)" v={brl(fluxo.receberCartao.reduce((s, v) => s + v, 0))} />
            <Linha k={`Delivery a receber · ${int(fluxo.receberCanalQtd)}`} v={brl(fluxo.receberCanal)} />
          </div>
        </Cartao>
      )}

      {(impostos || notas || fiado) && (
        <Cartao titulo="🧾 Fiscal e fiado">
          {impostos && (
            impostos.guias.length ? (
              <>
                <Linha k="Guias de imposto da competência" v={brl(impostos.total)} forte />
                {impostos.guias.map((g, i) => (
                  <Linha key={i} k={`${g.tipo} · vence ${fmtData(g.vencimento)}`} v={brl(g.valor)} />
                ))}
              </>
            ) : (
              <Linha k="Guias de imposto da competência" v="nenhuma lida" cor="text-slate-400" />
            )
          )}
          {notas && (
            <>
              <Linha k="NF-e a manifestar (no prazo de 10 dias)" v={int(notas.noPrazo)} cor={notas.noPrazo ? 'text-amber-600' : undefined} />
              {notas.foraPrazo > 0 && <Linha k="Passaram da ciência (últimos 90 dias)" v={int(notas.foraPrazo)} cor="text-rose-600" />}
            </>
          )}
          {fiado && (
            <div className="mt-2 border-t border-slate-200 pt-1.5">
              <Linha k={`Fiado em aberto · ${int(fiado.devedores)} clientes`} v={brl(fiado.devendo)} forte />
              <Linha k="Último movimento de fiado" v={fmtData(fiado.ultimoMovimento)} cor="text-slate-500" />
            </div>
          )}
        </Cartao>
      )}
    </div>
  );
}
