// Documento do orçamento (o "PDF") — server component compartilhado entre a
// página interna (/orcamentos/[id]) e a pública de aceite (/orcamento/[token]).

import type { schema } from '@concilia/db';
import { brl, formatDate, formatDateTime, maskCnpj } from '@/lib/format';
import { calcularTotais, diaSemanaBr, numeroOrcamento } from '@/lib/orcamentos';

export type OrcamentoRow = typeof schema.orcamentoEvento.$inferSelect;

const num = (v: string | null) => (v == null ? null : Number(v));

interface Props {
  o: OrcamentoRow;
  filialNome: string;
  filialCnpj: string;
  /** URL pública de aceite+pagamento — sai no rodapé (inclusive impresso).
   *  Null = não mostrar (ex: na própria página pública). */
  linkAceite: string | null;
}

export function DocOrcamento({ o, filialNome, filialCnpj, linkAceite }: Props) {
  const valorPessoa = num(o.valorPessoa);
  const entrada = num(o.entradaValor);
  const totais = calcularTotais({
    pessoas: o.pessoas,
    valorPessoa,
    taxaEspaco: num(o.taxaEspaco),
    taxaExclusividade: num(o.taxaExclusividade),
  });
  const pratos = o.pratos ?? [];
  const diaSemana = diaSemanaBr(o.dataEvento);

  return (
    <section className="mx-auto my-6 max-w-4xl bg-white px-8 py-10 shadow-sm ring-1 ring-slate-200 sm:px-12 print:my-0 print:max-w-none print:px-0 print:py-0 print:shadow-none print:ring-0">
      {/* Cabecalho */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-slate-800 pb-5">
        <div>
          <p className="font-serif text-3xl font-bold tracking-tight text-slate-900">
            {filialNome}
          </p>
          {o.local && (
            <p className="mt-0.5 text-sm font-semibold uppercase tracking-widest text-emerald-700">
              {o.local}
            </p>
          )}
          <p className="mt-1 text-xs text-slate-500">CNPJ {maskCnpj(filialCnpj)}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">
            Orçamento
          </p>
          <p className="font-mono text-2xl font-bold text-slate-900">
            Nº {numeroOrcamento(o.numero)}
          </p>
          <p className="mt-1 text-xs text-slate-500">Emitido em {formatDate(o.criadoEm)}</p>
        </div>
      </header>

      {/* Evento */}
      <div className="mt-6 grid gap-x-8 gap-y-3 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
            Cliente
          </p>
          <p className="text-base font-semibold text-slate-900">{o.clienteNome}</p>
          {o.clienteTelefone && <p className="text-sm text-slate-600">{o.clienteTelefone}</p>}
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          {o.local && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Local
              </p>
              <p className="text-sm font-semibold text-slate-900">{o.local}</p>
            </div>
          )}
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              Data do evento
            </p>
            <p className="text-sm font-semibold text-slate-900">{formatDate(o.dataEvento)}</p>
            <p className="text-xs capitalize text-slate-500">{diaSemana}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              Horário
            </p>
            <p className="text-sm font-semibold text-slate-900">
              {o.hora ? `${o.hora}h` : 'a combinar'}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              Pessoas
            </p>
            <p className="text-sm font-semibold text-slate-900">{o.pessoas}</p>
          </div>
          {o.validoAte && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Válido até
              </p>
              <p className="text-sm font-semibold text-slate-900">{formatDate(o.validoAte)}</p>
            </div>
          )}
        </div>
      </div>

      {/* Cardapio */}
      <div className="mt-8">
        <h2 className="mb-3 border-b border-slate-200 pb-1 text-sm font-bold uppercase tracking-widest text-slate-700">
          Cardápio
        </h2>
        {pratos.length === 0 ? (
          <p className="text-sm text-slate-500">Cardápio a definir com o cliente.</p>
        ) : (
          <ul className="space-y-2.5">
            {pratos.map((p, i) => (
              <li key={i} className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{p.nome}</p>
                  {p.descricao && <p className="text-xs text-slate-500">{p.descricao}</p>}
                </div>
                <span
                  className={`mt-0.5 shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                    p.regime === 'livre'
                      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                      : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                  }`}
                >
                  {p.regime === 'livre' ? 'à vontade' : p.qtd || 'quantidade limitada'}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-sm text-slate-700">
          <span className="font-semibold">Sobremesa:</span>{' '}
          {o.sobremesaIncluida ? (
            <>incluída{o.sobremesaDescricao ? ` — ${o.sobremesaDescricao}` : ''}</>
          ) : (
            'não incluída'
          )}
        </p>
      </div>

      {/* Valores */}
      <div className="mt-8">
        <h2 className="mb-3 border-b border-slate-200 pb-1 text-sm font-bold uppercase tracking-widest text-slate-700">
          Valores
        </h2>
        {totais.total == null ? (
          <p className="text-sm text-slate-500">Valores a combinar.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {totais.subtotalMenu != null && (
                <tr className="border-b border-slate-100">
                  <td className="py-2 text-slate-700">
                    Menu — {brl(valorPessoa)} por pessoa × {o.pessoas} pessoas
                  </td>
                  <td className="py-2 text-right font-mono text-slate-900">
                    {brl(totais.subtotalMenu)}
                  </td>
                </tr>
              )}
              {totais.taxaEspaco != null && (
                <tr className="border-b border-slate-100">
                  <td className="py-2 text-slate-700">Aluguel do espaço</td>
                  <td className="py-2 text-right font-mono text-slate-900">
                    {brl(totais.taxaEspaco)}
                  </td>
                </tr>
              )}
              {totais.taxaExclusividade != null && (
                <tr className="border-b border-slate-100">
                  <td className="py-2 text-slate-700">
                    Exclusividade do ambiente (fechado para o grupo)
                  </td>
                  <td className="py-2 text-right font-mono text-slate-900">
                    {brl(totais.taxaExclusividade)}
                  </td>
                </tr>
              )}
              <tr>
                <td className="py-3 text-base font-bold text-slate-900">TOTAL</td>
                <td className="py-3 text-right font-mono text-lg font-bold text-slate-900">
                  {brl(totais.total)}
                </td>
              </tr>
            </tbody>
          </table>
        )}
        {entrada != null && (
          <p className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700 print:bg-transparent print:px-0">
            Entrada (sinal) para reserva da data: <b>{brl(entrada)}</b>
            {totais.total != null && totais.total > entrada && (
              <>
                {' '}
                · Restante: <b>{brl(totais.total - entrada)}</b>
              </>
            )}
          </p>
        )}
      </div>

      {/* Condicoes / observacoes */}
      {o.condicoes && (
        <div className="mt-8">
          <h2 className="mb-2 border-b border-slate-200 pb-1 text-sm font-bold uppercase tracking-widest text-slate-700">
            Condições
          </h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
            {o.condicoes}
          </p>
        </div>
      )}
      {o.observacoes && (
        <div className="mt-6">
          <h2 className="mb-2 border-b border-slate-200 pb-1 text-sm font-bold uppercase tracking-widest text-slate-700">
            Observações
          </h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
            {o.observacoes}
          </p>
        </div>
      )}

      {/* Aceite + rodape */}
      {linkAceite && (
        <div className="mt-8 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 print:bg-transparent">
          <p className="text-sm font-semibold text-emerald-900">
            Aceite do contrato e pagamento da entrada
          </p>
          <p className="mt-1 text-xs leading-relaxed text-emerald-800">
            Para aceitar este orçamento e garantir a data
            {entrada != null ? ` pagando a entrada de ${brl(entrada)} via Pix` : ''}, acesse:
          </p>
          <a
            href={linkAceite}
            className="mt-1 block break-all font-mono text-xs font-medium text-emerald-900 underline"
          >
            {linkAceite}
          </a>
        </div>
      )}

      <footer className="mt-10 border-t border-slate-200 pt-4 text-center">
        {o.validoAte && (
          <p className="text-xs text-slate-500">
            Este orçamento é válido até {formatDate(o.validoAte)}.
          </p>
        )}
        <p className="mt-1 text-[10px] text-slate-400">
          {filialNome} · gerado em {formatDateTime(o.atualizadoEm)}
        </p>
      </footer>
    </section>
  );
}
