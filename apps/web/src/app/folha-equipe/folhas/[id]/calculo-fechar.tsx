'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Pessoa {
  fornecedorId: string;
  nome: string;
  papel: string;
  saldoFiado: number | null;
  bonusFixoSemanal: number | null;
  clienteId: string | null;
}

interface AjusteRow {
  id: string;
  fornecedorId: string;
  tipo: 'desconto' | 'acrescimo';
  valor: string; // numeric
  descricao: string | null;
  origem: string;
}

interface Lancamento {
  fornecedorId: string;
  pessoaNome: string;
  papel: string;
  tipo: 'comissao' | 'diaria' | 'gratificacao' | 'transporte';
  valorBruto: number;
  desconto: number;
  valorLiquido: number;
  detalhe: string;
}

interface Resultado {
  lancamentos: Lancamento[];
  totalBruto: number;
  totalLiquido: number;
  totalDescontos: number;
  totalAcrescimos: number;
  totalEmpresa: number;
  avisos: string[];
}

interface Props {
  folhaId: string;
  status: string;
  pessoas: Pessoa[];
  ajustesIniciais: AjusteRow[];
}

export function CalculoFechar({ folhaId, status, pessoas, ajustesIniciais }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ajustes, setAjustes] = useState<AjusteRow[]>(ajustesIniciais);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  // Form pra adicionar ajuste
  const [formFornecedor, setFormFornecedor] = useState('');
  const [formTipo, setFormTipo] = useState<'desconto' | 'acrescimo'>('desconto');
  const [formValor, setFormValor] = useState('');
  const [formDescricao, setFormDescricao] = useState('');

  async function refreshPreview() {
    const r = await fetch(`/api/folha-equipe/folhas/${folhaId}/preview`);
    if (r.ok) setResultado(await r.json());
  }

  // Mantém a tabela de ajustes em sync com o que o servidor mandou
  // (depois de router.refresh os ajustesIniciais mudam, mas a state local
  //  não atualizava sozinha — adiciona/remove e fiado_auto ficavam stale).
  useEffect(() => {
    setAjustes(ajustesIniciais);
  }, [ajustesIniciais]);

  // Auto-puxa fiados ao abrir a folha (silencioso). Substitui o clique
  // manual no botão "⤓ Puxar fiados" — sempre traz o saldo mais recente
  // de cada cliente vinculado.
  const autoPuxouRef = useRef(false);
  useEffect(() => {
    if (autoPuxouRef.current) return;
    autoPuxouRef.current = true;
    (async () => {
      if (status === 'aberta') {
        try {
          const r = await fetch(`/api/folha-equipe/folhas/${folhaId}/puxar-fiado`, {
            method: 'POST',
          });
          if (r.ok) router.refresh();
        } catch {
          // Ignora — botão manual ainda funciona como fallback
        }
      }
      refreshPreview();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function puxarFiados() {
    setMsg(null);
    start(async () => {
      const r = await fetch(`/api/folha-equipe/folhas/${folhaId}/puxar-fiado`, {
        method: 'POST',
      });
      if (r.ok) {
        const data = await r.json();
        setMsg({ tipo: 'ok', texto: `${data.importados} fiado(s) importado(s) ✓` });
        router.refresh();
      } else {
        setMsg({ tipo: 'erro', texto: await r.text() });
      }
    });
  }

  async function baixarFiadosNoConsumer() {
    if (
      !confirm(
        'Vai criar comandos pro agente ZERAR o saldo de fiado dos garçons no Consumer Rede.\n\n' +
          'Use isso depois de aplicar os fiados como desconto na folha — pra que próxima semana ' +
          'o saldo comece do zero.\n\nContinuar?',
      )
    )
      return;
    setMsg(null);
    start(async () => {
      const r = await fetch(`/api/folha-equipe/folhas/${folhaId}/baixar-fiados`, {
        method: 'POST',
      });
      if (r.ok) {
        const data = await r.json();
        if (data.comandos === 0) {
          setMsg({ tipo: 'ok', texto: data.msg ?? 'Nenhum saldo a baixar.' });
        } else {
          const sufixo = data.ignorados
            ? ` (${data.ignorados} já estavam na fila — ignorados).`
            : '';
          setMsg({
            tipo: 'ok',
            texto: `${data.comandos} comando(s) criado(s)${sufixo} Agente vai executar no próximo ciclo (~15min).`,
          });
        }
        router.refresh();
      } else {
        setMsg({ tipo: 'erro', texto: await r.text() });
      }
    });
  }

  async function adicionarAjuste() {
    if (!formFornecedor || !formValor) return;
    setMsg(null);
    const valor = Number(formValor.replace(',', '.'));
    if (!Number.isFinite(valor) || valor <= 0) {
      setMsg({ tipo: 'erro', texto: 'Valor inválido' });
      return;
    }
    start(async () => {
      const r = await fetch(`/api/folha-equipe/folhas/${folhaId}/ajustes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fornecedorId: formFornecedor,
          tipo: formTipo,
          valor,
          descricao: formDescricao || undefined,
        }),
      });
      if (r.ok) {
        setFormValor('');
        setFormDescricao('');
        router.refresh();
      } else {
        setMsg({ tipo: 'erro', texto: await r.text() });
      }
    });
  }

  async function removerAjuste(ajusteId: string) {
    start(async () => {
      const r = await fetch(
        `/api/folha-equipe/folhas/${folhaId}/ajustes?ajusteId=${ajusteId}`,
        { method: 'DELETE' },
      );
      if (r.ok) router.refresh();
      else setMsg({ tipo: 'erro', texto: await r.text() });
    });
  }

  async function fechar() {
    if (!confirm('Fechar folha? Vai gerar os lançamentos no contas a pagar.')) return;
    setMsg(null);
    start(async () => {
      const r = await fetch(`/api/folha-equipe/folhas/${folhaId}/fechar`, {
        method: 'POST',
      });
      if (r.ok) {
        const data = await r.json();
        setMsg({
          tipo: 'ok',
          texto: `Folha fechada — ${data.lancamentosGerados} lançamento(s) gerado(s) no contas a pagar.`,
        });
        router.refresh();
      } else {
        setMsg({ tipo: 'erro', texto: await r.text() });
      }
    });
  }

  const aberta = status === 'aberta';

  return (
    <div className="space-y-6">
      {msg && (
        <div
          className={`rounded-md border p-3 text-sm ${
            msg.tipo === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-rose-200 bg-rose-50 text-rose-700'
          }`}
        >
          {msg.texto}
        </div>
      )}

      {/* Ajustes (descontos / acréscimos) */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">
            💰 Ajustes (descontos / acréscimos)
          </h2>
          {aberta && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={puxarFiados}
                disabled={pending}
                className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                title="Lê o saldo atual de fiado de cada cliente vinculado e cria desconto automático na folha"
              >
                ⤓ Puxar fiados
              </button>
              <button
                type="button"
                onClick={baixarFiadosNoConsumer}
                disabled={pending}
                className="rounded-md border border-purple-300 bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50"
                title="Cria comandos pro agente lançar baixa em CONTACORRENTE no Consumer (zera saldo dos garçons)"
              >
                📤 Baixar fiados no Consumer
              </button>
            </div>
          )}
        </div>

        {(() => {
          const pessoasComBonus = pessoas.filter(
            (p) => p.bonusFixoSemanal != null && p.bonusFixoSemanal > 0,
          );
          const totalLinhas = ajustes.length + pessoasComBonus.length;
          if (totalLinhas === 0) {
            return <p className="text-xs text-slate-500">Nenhum ajuste lançado.</p>;
          }
          return (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs">
                <tr>
                  <th className="px-2 py-2 text-left font-medium text-slate-500">Pessoa</th>
                  <th className="px-2 py-2 text-left font-medium text-slate-500">Tipo</th>
                  <th className="px-2 py-2 text-right font-medium text-slate-500">Valor</th>
                  <th className="px-2 py-2 text-left font-medium text-slate-500">Descrição</th>
                  <th className="px-2 py-2 text-left font-medium text-slate-500">Origem</th>
                  {aberta && <th className="px-2 py-2"></th>}
                </tr>
              </thead>
              <tbody>
                {/* Bônus fixo do cadastro (read-only — vem do cadastro da pessoa) */}
                {pessoasComBonus.map((p) => (
                  <tr key={`bonus-${p.fornecedorId}`} className="border-t border-slate-100 bg-emerald-50/40">
                    <td className="px-2 py-1.5">{p.nome}</td>
                    <td className="px-2 py-1.5">
                      <span className="text-emerald-700">↑ acréscimo</span>
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">
                      {brl(Number(p.bonusFixoSemanal))}
                    </td>
                    <td className="px-2 py-1.5 text-xs text-slate-600">
                      Bônus fixo semanal
                    </td>
                    <td className="px-2 py-1.5 text-xs text-emerald-700">
                      💰 cadastro
                    </td>
                    {aberta && (
                      <td className="px-2 py-1.5 text-right">
                        <a
                          href="/folha-equipe/pessoas"
                          className="text-xs text-slate-500 hover:underline"
                          title="Pra mudar/remover, edita o cadastro da pessoa"
                        >
                          editar cadastro
                        </a>
                      </td>
                    )}
                  </tr>
                ))}
                {/* Ajustes manuais ou fiado_auto da folha */}
                {ajustes.map((a) => {
                  const p = pessoas.find((x) => x.fornecedorId === a.fornecedorId);
                  return (
                    <tr key={a.id} className="border-t border-slate-100">
                      <td className="px-2 py-1.5">{p?.nome ?? '?'}</td>
                      <td className="px-2 py-1.5">
                        {a.tipo === 'desconto' ? (
                          <span className="text-rose-700">↓ desconto</span>
                        ) : (
                          <span className="text-emerald-700">↑ acréscimo</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {brl(Number(a.valor))}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-slate-600">
                        {a.descricao ?? '—'}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-slate-500">
                        {a.origem === 'fiado_auto' ? '🤖 fiado auto' : '✍ manual'}
                      </td>
                      {aberta && (
                        <td className="px-2 py-1.5 text-right">
                          <button
                            type="button"
                            onClick={() => removerAjuste(a.id)}
                            disabled={pending}
                            className="text-xs text-rose-600 hover:underline"
                          >
                            remover
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          );
        })()}

        {/* Form adicionar */}
        {aberta && (
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="grid grid-cols-12 gap-2">
              <select
                value={formFornecedor}
                onChange={(e) => setFormFornecedor(e.target.value)}
                className="col-span-4 rounded border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="">— pessoa —</option>
                {pessoas.map((p) => (
                  <option key={p.fornecedorId} value={p.fornecedorId}>
                    {p.nome}
                  </option>
                ))}
              </select>
              <select
                value={formTipo}
                onChange={(e) => setFormTipo(e.target.value as 'desconto' | 'acrescimo')}
                className="col-span-2 rounded border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="desconto">Desconto</option>
                <option value="acrescimo">Acréscimo</option>
              </select>
              <input
                type="text"
                placeholder="Valor"
                value={formValor}
                onChange={(e) => setFormValor(e.target.value)}
                className="col-span-2 rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
              />
              <input
                type="text"
                placeholder="Descrição (opcional)"
                value={formDescricao}
                onChange={(e) => setFormDescricao(e.target.value)}
                className="col-span-3 rounded border border-slate-300 px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={adicionarAjuste}
                disabled={pending || !formFornecedor || !formValor}
                className="col-span-1 rounded bg-blue-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:bg-slate-400"
              >
                +
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Preview do cálculo */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-slate-900">
          🧮 Preview da folha {!aberta && '(snapshot do fechamento)'}
        </h2>

        {!resultado ? (
          <p className="text-xs text-slate-500">Calculando...</p>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-5 gap-3 rounded bg-slate-50 p-3">
              <Box label="Empresa fica" valor={brl(resultado.totalEmpresa)} cor="text-slate-600" />
              <Box
                label="Bruto a pagar"
                valor={brl(resultado.totalBruto)}
                cor="text-slate-700"
              />
              <Box
                label="↑ Acréscimos"
                valor={brl(resultado.totalAcrescimos)}
                cor="text-emerald-700"
              />
              <Box
                label="↓ Descontos"
                valor={brl(resultado.totalDescontos)}
                cor="text-rose-700"
              />
              <Box
                label="Líquido a pagar"
                valor={brl(resultado.totalLiquido)}
                cor="text-emerald-700"
                bold
              />
            </div>

            {resultado.lancamentos.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">
                Sem lançamentos. Suba o espelho de ponto e/ou ajuste a config.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium text-slate-500">Pessoa</th>
                    <th className="px-2 py-2 text-left font-medium text-slate-500">Tipo</th>
                    <th className="px-2 py-2 text-right font-medium text-slate-500">Bruto</th>
                    <th className="px-2 py-2 text-right font-medium text-slate-500">↑ Acréscimo</th>
                    <th className="px-2 py-2 text-right font-medium text-slate-500">↓ Desconto</th>
                    <th className="px-2 py-2 text-right font-medium text-slate-500">Líquido</th>
                    <th className="px-2 py-2 text-left font-medium text-slate-500">Detalhe</th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.lancamentos.map((l, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-2 py-1.5 font-medium text-slate-900">
                        {l.pessoaNome}
                      </td>
                      <td className="px-2 py-1.5 text-xs">
                        {l.tipo === 'comissao' && '💰 Comissão'}
                        {l.tipo === 'diaria' && '⏰ Diária'}
                        {l.tipo === 'gratificacao' && '🎁 Gratificação'}
                        {l.tipo === 'transporte' && '🚗 Transporte'}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">{brl(l.valorBruto)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-emerald-700">
                        {l.tipo === 'gratificacao' && l.valorBruto > 0 ? brl(l.valorBruto) : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-rose-700">
                        {l.desconto > 0 ? brl(l.desconto) : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono font-semibold">
                        {brl(l.valorLiquido)}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-slate-500">{l.detalhe}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Resumo por pessoa — soma dos lançamentos agrupados */}
            {resultado.lancamentos.length > 0 && (() => {
              type ResumoPessoa = {
                fornecedorId: string;
                nome: string;
                bruto: number; // comissao + diaria + transporte (sem gratificacao)
                acrescimos: number; // gratificacao
                descontos: number;
                liquido: number;
              };
              const porPessoa = new Map<string, ResumoPessoa>();
              for (const l of resultado.lancamentos) {
                const cur = porPessoa.get(l.fornecedorId) ?? {
                  fornecedorId: l.fornecedorId,
                  nome: l.pessoaNome,
                  bruto: 0,
                  acrescimos: 0,
                  descontos: 0,
                  liquido: 0,
                };
                if (l.tipo === 'gratificacao') {
                  cur.acrescimos += l.valorBruto;
                } else {
                  cur.bruto += l.valorBruto;
                }
                cur.descontos += l.desconto;
                cur.liquido += l.valorLiquido;
                porPessoa.set(l.fornecedorId, cur);
              }
              const linhas = Array.from(porPessoa.values()).sort((a, b) =>
                a.nome.localeCompare(b.nome, 'pt-BR'),
              );
              return (
                <div className="mt-6">
                  <h3 className="mb-2 text-sm font-semibold text-slate-900">
                    📋 Resumo por pessoa (líquido a pagar)
                  </h3>
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs">
                      <tr>
                        <th className="px-2 py-2 text-left font-medium text-slate-500">Pessoa</th>
                        <th className="px-2 py-2 text-right font-medium text-slate-500">Bruto</th>
                        <th className="px-2 py-2 text-right font-medium text-slate-500">↑ Acréscimos</th>
                        <th className="px-2 py-2 text-right font-medium text-slate-500">↓ Descontos</th>
                        <th className="px-2 py-2 text-right font-medium text-slate-500">Líquido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {linhas.map((r) => (
                        <tr key={r.fornecedorId} className="border-t border-slate-100">
                          <td className="px-2 py-1.5 font-medium text-slate-900">{r.nome}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{brl(r.bruto)}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-emerald-700">
                            {r.acrescimos > 0 ? brl(r.acrescimos) : '—'}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono text-rose-700">
                            {r.descontos > 0 ? brl(r.descontos) : '—'}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono font-bold text-emerald-700">
                            {brl(r.liquido)}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                        <td className="px-2 py-2">TOTAL</td>
                        <td className="px-2 py-2 text-right font-mono">
                          {brl(linhas.reduce((s, r) => s + r.bruto, 0))}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-emerald-700">
                          {brl(resultado.totalAcrescimos)}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-rose-700">
                          {brl(resultado.totalDescontos)}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-emerald-700">
                          {brl(resultado.totalLiquido)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })()}

            {resultado.avisos.length > 0 && (
              <div className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-xs">
                <p className="mb-1 font-semibold text-amber-800">⚠ Avisos:</p>
                <ul className="list-disc pl-5 text-amber-800">
                  {resultado.avisos.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      {/* Acoes finais — exportar pagamento + fechar */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <a
          href={`/folha-equipe/folhas/${folhaId}/exportar`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          💸 Exportar pagamento (CSV / impressão)
        </a>
        {aberta && (
          <button
            type="button"
            onClick={fechar}
            disabled={pending || !resultado || resultado.lancamentos.length === 0}
            className="rounded-md bg-emerald-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:bg-slate-400"
          >
            {pending ? 'Fechando...' : '✅ Fechar folha e gerar contas a pagar'}
          </button>
        )}
      </div>
    </div>
  );
}

function Box({
  label,
  valor,
  cor,
  bold,
}: {
  label: string;
  valor: string;
  cor: string;
  bold?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-base font-mono ${cor} ${bold ? 'font-bold' : ''}`}>{valor}</div>
    </div>
  );
}

function brl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
