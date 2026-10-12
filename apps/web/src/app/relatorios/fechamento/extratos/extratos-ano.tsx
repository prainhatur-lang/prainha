'use client';

// Grade do ano: uma linha por conta, uma coluna por mês. Clicar num mês vazio
// abre a escolha do arquivo; clicar num mês com ✓ mostra os arquivos pra baixar.
// O envio é o mesmo da seção do Fechamento do mês (mesmas rotas, mesmo bucket).

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { ContaExtratoDoAno } from '@/lib/extratos-fechamento';

interface Props {
  ano: number;
  hojeAno: number;
  hojeMes: number;
  contas: ContaExtratoDoAno[];
  podeEnviar: boolean;
  extensoes: string[];
}

const MESES = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const MES_CURTO = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const DOZE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** dd/mm/aa hh:mm em BRT (UTC−3 fixo), igual no servidor e no navegador. */
function quando(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString();
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)} ${d.slice(11, 16)}`;
}

function tamanho(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

function nomeConta(c: { banco: string; apelido: string | null }): string {
  return c.apelido ? `${c.banco} · ${c.apelido}` : c.banco;
}

export function ExtratosAno({ ano, hojeAno, hojeMes, contas, podeEnviar, extensoes }: Props) {
  const router = useRouter();
  const input = useRef<HTMLInputElement | null>(null);
  const alvo = useRef<{ contaId: string; mes: number } | null>(null);
  const [aberto, setAberto] = useState<{ contaId: string; mes: number } | null>(null);
  const [enviando, setEnviando] = useState<Record<string, string>>({});
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  /** O mês já acabou, está correndo ou ainda não chegou. */
  function estado(mes: number): 'encerrado' | 'andamento' | 'futuro' {
    if (ano < hojeAno || (ano === hojeAno && mes < hojeMes)) return 'encerrado';
    if (ano === hojeAno && mes === hojeMes) return 'andamento';
    return 'futuro';
  }

  const temArquivo = (c: ContaExtratoDoAno) => DOZE.some((m) => (c.meses[m]?.length ?? 0) > 0);
  const mostradas = contas.filter((c) => c.ativo || temArquivo(c));
  const encerrados = DOZE.filter((m) => estado(m) === 'encerrado');
  const pedidos = mostradas.filter((c) => c.ativo).length * encerrados.length;
  const enviados = mostradas
    .filter((c) => c.ativo)
    .reduce((s, c) => s + encerrados.filter((m) => (c.meses[m]?.length ?? 0) > 0).length, 0);

  // Um bloco por dono da conta, na ordem da lista.
  const grupos: Array<{ chave: string; titular: string; contas: ContaExtratoDoAno[] }> = [];
  for (const c of mostradas) {
    const chave = c.filialId ?? `empresa:${c.titular}`;
    let g = grupos.find((x) => x.chave === chave);
    if (!g) {
      g = { chave, titular: c.titular, contas: [] };
      grupos.push(g);
    }
    g.contas.push(c);
  }

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

  function escolher(contaId: string, mes: number) {
    alvo.current = { contaId, mes };
    input.current?.click();
  }

  async function enviar(lista: FileList | null) {
    const destino = alvo.current;
    const arquivos = lista ? Array.from(lista) : [];
    if (!destino || arquivos.length === 0) return;
    const chave = `${destino.contaId}:${destino.mes}`;
    const conta = contas.find((c) => c.id === destino.contaId);
    setErro('');
    try {
      for (let i = 0; i < arquivos.length; i++) {
        const file = arquivos[i]!;
        setEnviando((s) => ({ ...s, [chave]: arquivos.length > 1 ? `${i + 1}/${arquivos.length}` : '…' }));
        const passo1 = await chamar('/api/extratos-fechamento/upload-url', 'POST', {
          contaId: destino.contaId,
          ano,
          mes: destino.mes,
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
          contaId: destino.contaId,
          ano,
          mes: destino.mes,
          path: passo1.path,
          nome: file.name,
          contentType: file.type,
        });
      }
      setAberto(destino);
    } catch (e) {
      setErro(
        `${conta ? `${nomeConta(conta)} (${conta.titular})` : 'Conta'}, ${MESES[destino.mes]}: ${(e as Error).message}`,
      );
    } finally {
      setEnviando((s) => ({ ...s, [chave]: '' }));
      if (input.current) input.current.value = '';
      router.refresh();
    }
  }

  async function tirar(arquivoId: string, nome: string, mes: number) {
    if (ocupado) return;
    if (!window.confirm(`Tirar "${nome}" da lista de ${MESES[mes]}/${ano}?`)) return;
    setOcupado(true);
    setErro('');
    try {
      await chamar(`/api/extratos-fechamento/arquivos/${arquivoId}`, 'DELETE');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
      router.refresh();
    }
  }

  const contaAberta = aberto ? contas.find((c) => c.id === aberto.contaId) : undefined;
  const arquivosAbertos = aberto && contaAberta ? (contaAberta.meses[aberto.mes] ?? []) : [];
  const accept = extensoes.map((e) => `.${e}`).join(',');

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <input
        ref={input}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onChange={(e) => void enviar(e.target.files)}
      />

      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] text-slate-500">
          {podeEnviar
            ? 'Clique no mês vazio pra enviar o arquivo do banco; no ✓ pra ver, baixar ou enviar outro. '
            : 'Clique no ✓ pra ver e baixar o arquivo. '}
          Aceita {extensoes.slice(0, 4).map((e) => e.toUpperCase()).join(', ')}… O arquivo só é guardado, nada é lançado a partir dele.
        </p>
        {pedidos > 0 && (
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
              enviados === pedidos ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
            }`}
          >
            {enviados} de {pedidos} enviados{enviados < pedidos ? ` · faltam ${pedidos - enviados}` : ''}
          </span>
        )}
      </div>

      {erro && <p className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{erro}</p>}
      {mostradas.length === 0 && (
        <p className="text-xs text-slate-400">Nenhuma conta na lista das casas que você acessa.</p>
      )}

      {mostradas.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white py-1.5 pr-3 text-left text-[11px] font-medium text-slate-500">
                  Conta
                </th>
                {DOZE.map((m) => (
                  <th key={m} className="px-1 py-1.5 text-center text-[11px] font-medium">
                    <Link
                      href={`/relatorios/fechamento?ano=${ano}&mes=${m}`}
                      title={`Abrir o fechamento de ${MESES[m]}/${ano}`}
                      className={estado(m) === 'futuro' ? 'text-slate-300' : 'text-slate-500 hover:text-sky-700'}
                    >
                      {MES_CURTO[m]}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            {grupos.map((g) => (
              <tbody key={g.chave}>
                <tr>
                  <td
                    colSpan={13}
                    className="border-t border-slate-200 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                  >
                    {g.titular}
                  </td>
                </tr>
                {g.contas.map((c) => (
                  <tr key={c.id}>
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-white py-1 pr-3 text-sm font-medium text-slate-900">
                      {nomeConta(c)}
                      {!c.ativo && <span className="ml-1 text-[10px] font-normal text-slate-400">(não é mais pedida)</span>}
                    </td>
                    {DOZE.map((m) => {
                      const chave = `${c.id}:${m}`;
                      const qtd = c.meses[m]?.length ?? 0;
                      const est = estado(m);
                      const selecionado = aberto?.contaId === c.id && aberto.mes === m;
                      const base = 'block h-8 w-full rounded-md border text-[11px] font-medium';
                      let celula: React.ReactNode;
                      if (enviando[chave]) {
                        celula = (
                          <span className={`${base} border-sky-200 bg-sky-50 leading-8 text-sky-700`}>{enviando[chave]}</span>
                        );
                      } else if (qtd > 0) {
                        celula = (
                          <button
                            type="button"
                            onClick={() => setAberto(selecionado ? null : { contaId: c.id, mes: m })}
                            title={`${MESES[m]}/${ano}: ${qtd === 1 ? '1 arquivo' : `${qtd} arquivos`}`}
                            className={`${base} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 ${
                              selecionado ? 'ring-2 ring-emerald-500' : ''
                            }`}
                          >
                            ✓{qtd > 1 ? ` ${qtd}` : ''}
                          </button>
                        );
                      } else if (est === 'futuro') {
                        celula = <span className={`${base} border-transparent leading-8 text-slate-300`}>·</span>;
                      } else if (c.ativo && podeEnviar) {
                        celula = (
                          <button
                            type="button"
                            onClick={() => escolher(c.id, m)}
                            title={`Enviar o extrato de ${MESES[m]}/${ano} — ${nomeConta(c)} (${c.titular})`}
                            className={`${base} border-dashed ${
                              est === 'encerrado'
                                ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                                : 'border-slate-300 bg-white text-slate-500 hover:bg-slate-50'
                            }`}
                          >
                            enviar
                          </button>
                        );
                      } else {
                        celula = (
                          <span
                            className={`${base} leading-8 ${
                              c.ativo && est === 'encerrado'
                                ? 'border-amber-200 bg-amber-50 text-amber-700'
                                : 'border-transparent text-slate-300'
                            }`}
                          >
                            {c.ativo && est === 'encerrado' ? 'falta' : '—'}
                          </span>
                        );
                      }
                      return (
                        <td key={m} className="px-0.5 py-1 text-center">
                          {celula}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}

      {aberto && contaAberta && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">
              {nomeConta(contaAberta)} ({contaAberta.titular}) — {MESES[aberto.mes]}/{ano}
            </h3>
            <div className="flex items-center gap-3">
              {podeEnviar && (
                <button
                  type="button"
                  onClick={() => escolher(aberto.contaId, aberto.mes)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Enviar outro
                </button>
              )}
              <button type="button" onClick={() => setAberto(null)} className="text-xs text-slate-500 hover:text-slate-700">
                fechar
              </button>
            </div>
          </div>
          {arquivosAbertos.length === 0 && <p className="text-xs text-slate-400">Nenhum arquivo deste mês.</p>}
          <div className="space-y-1">
            {arquivosAbertos.map((a) => (
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
                    onClick={() => void tirar(a.id, a.nome, aberto.mes)}
                    disabled={ocupado}
                    className="text-[11px] text-slate-400 hover:text-rose-600 disabled:opacity-50"
                  >
                    tirar
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-4 text-[11px] text-slate-400">
        Pra incluir ou parar de pedir uma conta, use a seção <b>Extratos bancários</b> dentro do{' '}
        <Link href="/relatorios/fechamento#extratos" className="text-sky-700 hover:text-sky-900">
          Fechamento do mês
        </Link>
        .
      </p>
    </section>
  );
}
