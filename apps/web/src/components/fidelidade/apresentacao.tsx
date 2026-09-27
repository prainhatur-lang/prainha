// Apresentação do programa Cartão Prainha (estilo programa de milhas):
// categorias, benefícios por categoria, como funciona e dúvidas. Usada na
// página pública /cartao-prainha e no convite (/cartao/[token] antes da adesão).

import type { FidelidadeConfig } from '@/lib/fidelidade/config';

export function ApresentacaoPrograma({ cfg, destaque }: { cfg: FidelidadeConfig; destaque?: string }) {
  const b = cfg.bonusDiaUtilPct;
  const topo = cfg.niveis[cfg.niveis.length - 1];
  const temPrioridade = cfg.niveis.some((n) => n.prioridadeReserva);
  const temEspaco = cfg.niveis.some((n) => n.pctEspaco > 0);
  const espacoMin = Math.min(...cfg.niveis.map((n) => n.pctEspaco));
  const espacoMax = Math.max(...cfg.niveis.map((n) => n.pctEspaco));

  return (
    <div className="space-y-5">
      <section className="grid gap-2">
        <Beneficio
          titulo={`Até ${topo.pct + b}% de desconto no consumo`}
          texto={`Todo membro já entra com ${cfg.niveis[0].pct}% no Pix${b ? `, e de segunda a sexta ganha +${b}%` : ''}. Quanto mais você vem, maior a categoria.`}
        />
        {temPrioridade && (
          <Beneficio
            titulo="Prioridade nas reservas"
            texto="Quando as mesas reserváveis de uma área esgotam, o membro ainda consegue reservar pelo site ou pelo WhatsApp (se houver mesa livre)."
          />
        )}
        {temEspaco && (
          <Beneficio
            titulo={espacoMin === espacoMax ? `${espacoMax}% no aluguel de espaços` : `${espacoMin}% a ${espacoMax}% no aluguel de espaços`}
            texto="Aniversário, confraternização da empresa, reunião de família: desconto no aluguel do espaço conforme sua categoria."
          />
        )}
        <Beneficio
          titulo="Nas 3 casas"
          texto="Prainha Bar, Tabuará e Prainha Mar. Um cartão só, direto na Apple Wallet ou no Google Wallet do seu celular."
        />
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold">Categorias</h2>
        <p className="mt-1 text-xs text-slate-500">
          Sua categoria é calculada pelas visitas (dias diferentes) nos últimos {cfg.janelaDias} dias e muda sozinha no cartão.
        </p>
        <div className="mt-3 space-y-2">
          {cfg.niveis.map((n) => (
            <div
              key={n.codigo}
              className={`overflow-hidden rounded-xl text-white ${destaque === n.codigo ? 'ring-2 ring-offset-2 ring-amber-400' : ''}`}
              style={{ background: `linear-gradient(120deg, ${n.cor} 0%, ${n.cor}cc 100%)` }}
            >
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-base font-bold tracking-wide">{n.nome}</div>
                  <div className="text-[11px] opacity-80">
                    {n.minVisitas === 0 ? 'entrada — ao aderir' : `a partir de ${n.minVisitas} visitas em ${cfg.janelaDias} dias`}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold">{n.pct}%</div>
                  {b ? <div className="text-[11px] opacity-80">{n.pct + b}% seg–sex</div> : null}
                </div>
              </div>
              {(n.pctEspaco > 0 || n.prioridadeReserva) && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 bg-black/15 px-4 py-1.5 text-[11px]">
                  {n.prioridadeReserva && <span>✓ Prioridade na reserva</span>}
                  {n.pctEspaco > 0 && <span>✓ {n.pctEspaco}% no aluguel de espaço</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold">Como funciona</h2>
        <ol className="mt-3 space-y-3 text-sm">
          <Passo n={1} texto="Ative o cartão pelo link e salve na Wallet do celular. Não tem app, não tem senha." />
          <Passo n={2} texto="Na hora de pagar a conta no Pix (QR da mesa, garçom ou caixa), informe o código de 4 letras do cartão." />
          <Passo n={3} texto="O desconto sai na hora. O código troca depois de cada uso e a Wallet atualiza sozinha." />
        </ol>
      </section>

      <section className="rounded-2xl bg-white p-4 text-sm shadow-sm">
        <h2 className="text-base font-semibold">Dúvidas</h2>
        <Faq p="Quanto custa?" r="Nada. O cartão é gratuito." />
        <Faq p="Vale em cartão de crédito ou débito?" r="Não — o desconto é só no Pix. É o Pix que deixa a gente devolver essa economia pra você." />
        <Faq
          p="O desconto vale sobre tudo?"
          r={`Sobre o consumo. A taxa de serviço dos garçons continua sobre o valor cheio.${cfg.tetoDescontoReais ? ` Limite de R$ ${cfg.tetoDescontoReais.toFixed(2).replace('.', ',')} de desconto por conta.` : ''}`}
        />
        <Faq p="Quantas vezes posso usar?" r="Uma vez por dia, em qualquer uma das 3 casas." />
        <Faq p="Posso passar o cartão pra outra pessoa?" r="O cartão é pessoal, ligado ao seu telefone. Mas ele vale pra conta da mesa inteira que você pagar." />
        <Faq p="O que conta como dia útil?" r="Segunda a sexta, fora feriados." />
        <Faq p="Como peço o desconto no espaço?" r="Peça o orçamento do seu evento pelo nosso WhatsApp usando o mesmo telefone do cartão — o desconto já vem aplicado." />
      </section>
    </div>
  );
}

function Beneficio({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="text-sm font-semibold text-[#0F3A5F]">{titulo}</div>
      <div className="mt-1 text-sm text-slate-600">{texto}</div>
    </div>
  );
}

function Passo({ n, texto }: { n: number; texto: string }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0F3A5F] text-xs font-bold text-white">{n}</span>
      <span>{texto}</span>
    </li>
  );
}

function Faq({ p, r }: { p: string; r: string }) {
  return (
    <details className="border-b border-slate-100 py-2 last:border-0">
      <summary className="cursor-pointer font-medium">{p}</summary>
      <p className="mt-1 text-slate-600">{r}</p>
    </details>
  );
}
