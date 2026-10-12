'use client';

// Seção "Extratos bancários do mês" do Fechamento do mês: a lista das contas de
// que o extrato é pedido, o que já foi enviado e o que falta. Quem fecha o mês
// envia o arquivo do banco; quem vê o fechamento (o contador) baixa aqui.
// O arquivo só é guardado — nada é lido nem lançado a partir dele.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { ContaExtratoDoMes } from '@/lib/extratos-fechamento';

interface Props {
  ano: number;
  mes: number;
  /** "Setembro/2026" */
  mesNome: string;
  /** Mês já acabou — extrato que falta vira pendência. */
  mesEncerrado: boolean;
  filialAtivaId: string;
  contas: ContaExtratoDoMes[];
  podeEnviar: boolean;
  extensoes: string[];
  /** Casas em que este usuário pode cadastrar conta. */
  casas: Array<{ id: string; nome: string }>;
  /** Pode cadastrar conta de empresa que não é uma das casas. */
  podeEmpresa: boolean;
}

const OUTRA = '__outra__';

/** dd/mm hh:mm em BRT (UTC−3 fixo), igual no servidor e no navegador. */
function quando(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString();
  return `${d.slice(8, 10)}/${d.slice(5, 7)} ${d.slice(11, 16)}`;
}

function tamanho(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

function nomeConta(c: { banco: string; apelido: string | null }): string {
  return c.apelido ? `${c.banco} · ${c.apelido}` : c.banco;
}

export function ExtratosMes(props: Props) {
  const { ano, mes, mesNome, mesEncerrado, filialAtivaId, contas, podeEnviar, extensoes, casas, podeEmpresa } = props;
  const router = useRouter();
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const [enviando, setEnviando] = useState<Record<string, string>>({});
  const [erros, setErros] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState(false);
  const [novaAberta, setNovaAberta] = useState(false);
  const [dono, setDono] = useState(casas.find((c) => c.id === filialAtivaId)?.id ?? casas[0]?.id ?? OUTRA);
  const [empresa, setEmpresa] = useState('');
  const [banco, setBanco] = useState('');
  const [apelido, setApelido] = useState('');
  const [erroNova, setErroNova] = useState('');

  const mostradas = contas.filter((c) => c.ativo || c.arquivos.length > 0);
  const desligadas = contas.filter((c) => !c.ativo && c.arquivos.length === 0);
  const pedidas = mostradas.filter((c) => c.ativo);
  const enviadas = pedidas.filter((c) => c.arquivos.length > 0).length;
  const faltando = pedidas.filter((c) => c.arquivos.length === 0);

  // Um bloco por dono da conta; a casa aberta na tela vem primeiro.
  const grupos: Array<{ chave: string; titular: string; contas: ContaExtratoDoMes[] }> = [];
  for (const c of mostradas) {
    const chave = c.filialId ?? `empresa:${c.titular}`;
    let g = grupos.find((x) => x.chave === chave);
    if (!g) {
      g = { chave, titular: c.titular, contas: [] };
      grupos.push(g);
    }
    g.contas.push(c);
  }
  grupos.sort((a, b) => Number(b.chave === filialAtivaId) - Number(a.chave === filialAtivaId));

  const empresasConhecidas = [...new Set(contas.filter((c) => !c.filialId).map((c) => c.titular))];

  async function chamar(url: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
    const r = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `erro ${r.status}`);
    return j;
  }

  async function enviar(conta: ContaExtratoDoMes, lista: FileList | null) {
    const arquivos = lista ? Array.from(lista) : [];
    if (arquivos.length === 0) return;
    setErros((e) => ({ ...e, [conta.id]: '' }));
    try {
      for (let i = 0; i < arquivos.length; i++) {
        const file = arquivos[i]!;
        setEnviando((s) => ({ ...s, [conta.id]: arquivos.length > 1 ? `Enviando ${i + 1} de ${arquivos.length}…` : 'Enviando…' }));
        const passo1 = await chamar('/api/extratos-fechamento/upload-url', 'POST', {
          contaId: conta.id,
          ano,
          mes,
          nome: file.name,
          tamanho: file.size,
        });
        const up = await createClient()
          .storage.from(String(passo1.bucket))
          .uploadToSignedUrl(String(passo1.path), String(passo1.token), file, {
            contentType: file.type || 'application/octet-stream',
          });
        if (up.error) throw new Error(`não consegui guardar o arquivo: ${up.error.message}`);
        await chamar('/api/extratos-fechamento/arquivos', 'POST', {
          contaId: conta.id,
          ano,
          mes,
          path: passo1.path,
          nome: file.name,
          contentType: file.type,
        });
      }
    } catch (e) {
      setErros((er) => ({ ...er, [conta.id]: (e as Error).message }));
    } finally {
      setEnviando((s) => ({ ...s, [conta.id]: '' }));
      const input = inputs.current[conta.id];
      if (input) input.value = '';
      router.refresh();
    }
  }

  async function acao(contaId: string, fn: () => Promise<unknown>) {
    if (ocupado) return;
    setOcupado(true);
    setErros((e) => ({ ...e, [contaId]: '' }));
    try {
      await fn();
    } catch (e) {
      setErros((er) => ({ ...er, [contaId]: (e as Error).message }));
    } finally {
      setOcupado(false);
      router.refresh();
    }
  }

  function tirarArquivo(conta: ContaExtratoDoMes, arquivoId: string, nome: string) {
    if (!window.confirm(`Tirar "${nome}" da lista de ${mesNome}?`)) return;
    void acao(conta.id, () => chamar(`/api/extratos-fechamento/arquivos/${arquivoId}`, 'DELETE'));
  }

  function pedir(conta: ContaExtratoDoMes, ativo: boolean) {
    if (
      !ativo &&
      !window.confirm(
        `Parar de pedir o extrato de ${nomeConta(conta)} (${conta.titular})? Os arquivos já enviados continuam guardados.`,
      )
    ) {
      return;
    }
    void acao(conta.id, () => chamar(`/api/extratos-fechamento/contas/${conta.id}`, 'PATCH', { ativo }));
  }

  async function adicionarConta() {
    if (ocupado) return;
    setErroNova('');
    if (!banco.trim()) return setErroNova('Informe o banco.');
    if (dono === OUTRA && !empresa.trim()) return setErroNova('Informe o nome da empresa.');
    setOcupado(true);
    try {
      await chamar('/api/extratos-fechamento/contas', 'POST', {
        filialId: dono === OUTRA ? '' : dono,
        empresa: dono === OUTRA ? empresa : '',
        banco,
        apelido,
      });
      setBanco('');
      setApelido('');
      setEmpresa('');
      setNovaAberta(false);
      router.refresh();
    } catch (e) {
      setErroNova((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const accept = extensoes.map((e) => `.${e}`).join(',');
  const campo = 'rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900';

  return (
    <section id="extratos" className="mb-5 scroll-mt-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Extratos bancários de {mesNome}</h2>
        {pedidas.length > 0 && (
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
              faltando.length === 0
                ? 'bg-emerald-50 text-emerald-700'
                : mesEncerrado
                  ? 'bg-amber-50 text-amber-800'
                  : 'bg-slate-100 text-slate-600'
            }`}
          >
            {enviadas} de {pedidas.length} enviados
          </span>
        )}
      </div>
      <p className="mb-3 text-[11px] text-slate-500">
        O extrato do mês de cada conta, no arquivo que o banco gera ({extensoes.slice(0, 4).map((e) => e.toUpperCase()).join(', ')}…). Fica
        guardado aqui pra o contador baixar junto com a apuração. O arquivo não é lido nem lançado em lugar nenhum.
      </p>

      {pedidas.length > 0 && faltando.length > 0 && mesEncerrado && (
        <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          ⚠️ {faltando.length === 1 ? 'Falta 1 extrato' : `Faltam ${faltando.length} extratos`} de {mesNome}:{' '}
          <b>{faltando.map((c) => `${nomeConta(c)} (${c.titular})`).join(' · ')}</b>.
        </p>
      )}
      {pedidas.length > 0 && faltando.length > 0 && !mesEncerrado && (
        <p className="mb-3 rounded-md bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
          Mês em andamento: o extrato completo só sai do banco depois que o mês fecha.
        </p>
      )}
      {pedidas.length > 0 && faltando.length === 0 && (
        <p className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
          ✓ Todos os extratos de {mesNome} estão aqui.
        </p>
      )}
      {mostradas.length === 0 && (
        <p className="mb-3 text-xs text-slate-400">Nenhuma conta na lista das casas que você acessa.</p>
      )}

      <div className="space-y-4">
        {grupos.map((g) => (
          <div key={g.chave}>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{g.titular}</h3>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {g.contas.map((c) => {
                const tem = c.arquivos.length > 0;
                return (
                  <li key={c.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-3 py-2.5">
                    <div className="w-44 shrink-0">
                      <p className="text-sm font-medium text-slate-900">{nomeConta(c)}</p>
                      <p
                        className={`text-[11px] ${
                          tem ? 'text-emerald-700' : !c.ativo ? 'text-slate-400' : mesEncerrado ? 'text-amber-700' : 'text-slate-400'
                        }`}
                      >
                        {tem ? '✓ enviado' : !c.ativo ? 'não é mais pedido' : mesEncerrado ? 'falta enviar' : 'aguardando o mês fechar'}
                      </p>
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      {c.arquivos.map((a) => (
                        <div key={a.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                          <a
                            href={`/api/extratos-fechamento/arquivos/${a.id}`}
                            className="break-all font-medium text-sky-700 underline decoration-sky-300 hover:text-sky-900"
                          >
                            ⬇ {a.nome}
                          </a>
                          <span className="text-[11px] text-slate-400">
                            {[tamanho(a.tamanhoBytes), quando(a.enviadoEm), a.enviadoPor].filter(Boolean).join(' · ')}
                          </span>
                          {podeEnviar && (
                            <button
                              type="button"
                              onClick={() => tirarArquivo(c, a.id, a.nome)}
                              disabled={ocupado}
                              className="text-[11px] text-slate-400 hover:text-rose-600 disabled:opacity-50"
                            >
                              tirar
                            </button>
                          )}
                        </div>
                      ))}
                      {!tem && <p className="text-xs text-slate-400">Nenhum arquivo deste mês.</p>}
                      {erros[c.id] && <p className="text-[11px] text-rose-600">{erros[c.id]}</p>}
                    </div>
                    {podeEnviar && (
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <input
                          ref={(el) => {
                            inputs.current[c.id] = el;
                          }}
                          type="file"
                          multiple
                          accept={accept}
                          className="hidden"
                          onChange={(e) => void enviar(c, e.target.files)}
                        />
                        <button
                          type="button"
                          onClick={() => inputs.current[c.id]?.click()}
                          disabled={!!enviando[c.id]}
                          className={`rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-60 ${
                            tem
                              ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                              : 'border-sky-600 bg-sky-600 text-white hover:bg-sky-700'
                          }`}
                        >
                          {enviando[c.id] || (tem ? 'Enviar outro' : 'Enviar extrato')}
                        </button>
                        {c.ativo && (
                          <button
                            type="button"
                            onClick={() => pedir(c, false)}
                            disabled={ocupado}
                            className="text-[11px] text-slate-400 hover:text-slate-600 disabled:opacity-50"
                          >
                            não pedir mais
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {podeEnviar && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          {!novaAberta ? (
            <button
              type="button"
              onClick={() => setNovaAberta(true)}
              className="text-xs font-medium text-sky-700 hover:text-sky-900"
            >
              + Adicionar conta
            </button>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[11px] text-slate-500">
                De quem é a conta
                <select value={dono} onChange={(e) => setDono(e.target.value)} className={`mt-0.5 block ${campo}`}>
                  {casas.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                    </option>
                  ))}
                  {podeEmpresa && <option value={OUTRA}>Outra empresa (não é uma das casas)</option>}
                </select>
              </label>
              {dono === OUTRA && (
                <label className="text-[11px] text-slate-500">
                  Empresa
                  <input
                    value={empresa}
                    onChange={(e) => setEmpresa(e.target.value)}
                    list="extrato-empresas"
                    maxLength={80}
                    placeholder="ex.: Leles"
                    className={`mt-0.5 block w-40 ${campo}`}
                  />
                  <datalist id="extrato-empresas">
                    {empresasConhecidas.map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                </label>
              )}
              <label className="text-[11px] text-slate-500">
                Banco
                <input
                  value={banco}
                  onChange={(e) => setBanco(e.target.value)}
                  maxLength={60}
                  placeholder="ex.: Caixa"
                  className={`mt-0.5 block w-40 ${campo}`}
                />
              </label>
              <label className="text-[11px] text-slate-500">
                Detalhe (opcional)
                <input
                  value={apelido}
                  onChange={(e) => setApelido(e.target.value)}
                  maxLength={80}
                  placeholder="ex.: aplicação"
                  className={`mt-0.5 block w-36 ${campo}`}
                />
              </label>
              <button
                type="button"
                onClick={() => void adicionarConta()}
                disabled={ocupado}
                className="rounded-md border border-sky-600 bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-60"
              >
                Adicionar
              </button>
              <button
                type="button"
                onClick={() => {
                  setNovaAberta(false);
                  setErroNova('');
                }}
                className="px-2 py-1.5 text-xs text-slate-500 hover:text-slate-700"
              >
                cancelar
              </button>
              {erroNova && <p className="w-full text-[11px] text-rose-600">{erroNova}</p>}
            </div>
          )}

          {desligadas.length > 0 && (
            <p className="mt-3 text-[11px] text-slate-400">
              Não são mais pedidas:{' '}
              {desligadas.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && ' · '}
                  {nomeConta(c)} ({c.titular}){' '}
                  <button
                    type="button"
                    onClick={() => pedir(c, true)}
                    disabled={ocupado}
                    className="text-sky-700 hover:text-sky-900 disabled:opacity-50"
                  >
                    voltar a pedir
                  </button>
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
