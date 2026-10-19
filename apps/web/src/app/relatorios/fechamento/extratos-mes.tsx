// Seção "Extratos bancários do mês" do Fechamento do mês: a lista das contas de
// que o extrato é pedido, o que já chegou e o que falta, com o arquivo pra
// baixar junto com a apuração (é o que o contador usa).
// Em 12/10/2026 o dono tirou daqui a importação: enviar arquivo, baixar direto
// do Inter, tirar arquivo e mexer na lista de contas ficam só em
// /relatorios/fechamento/extratos (a grade do ano). Aqui é só ver e baixar.

import Link from 'next/link';
import type { ContaExtratoDoMes } from '@/lib/extratos-fechamento';
import { LinkExtrato } from './link-extrato';

interface Props {
  ano: number;
  /** "Setembro/2026" */
  mesNome: string;
  /** Mês já acabou — extrato que falta vira pendência. */
  mesEncerrado: boolean;
  filialAtivaId: string;
  contas: ContaExtratoDoMes[];
  /** Quem envia extrato: o atalho fala em enviar; pros outros, só em ver o ano. */
  podeEnviar: boolean;
  /** Contador de fora: planilha sai só em CSV. */
  soContador?: boolean;
}

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

/** Planilha que o sistema montou com o que o Inter respondeu (não foi alguém que enviou). */
function veioDoInter(nome: string): boolean {
  return /^extrato-inter-\d{4}-\d{2}-automatico\.xlsx$/.test(nome);
}

export function ExtratosMes({ ano, mesNome, mesEncerrado, filialAtivaId, contas, podeEnviar, soContador = false }: Props) {
  const mostradas = contas.filter((c) => c.ativo || c.arquivos.length > 0);
  const pedidas = mostradas.filter((c) => c.ativo);
  const enviadas = pedidas.filter((c) => c.arquivos.length > 0).length;
  const faltando = pedidas.filter((c) => c.arquivos.length === 0);
  const telaDoAno = `/relatorios/fechamento/extratos?ano=${ano}`;

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
        O extrato do mês de cada conta, guardado aqui pra baixar junto com a apuração. O arquivo não é lido nem lançado em
        lugar nenhum.
      </p>
      <p className="mb-3 text-[11px]">
        <Link href={telaDoAno} className="font-medium text-sky-700 hover:text-sky-900">
          {podeEnviar
            ? `📥 Enviar extrato, baixar direto do Inter ou mexer na lista de contas: Extratos bancários de ${ano} →`
            : `📅 Ver ${ano} inteiro (todos os meses e contas numa tela só) →`}
        </Link>
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
                          <LinkExtrato id={a.id} nome={a.nome} soContador={soContador} />
                          <span className="text-[11px] text-slate-400">
                            {[tamanho(a.tamanhoBytes), quando(a.enviadoEm), a.enviadoPor].filter(Boolean).join(' · ')}
                          </span>
                          {veioDoInter(a.nome) && (
                            <span className="rounded-full bg-orange-50 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
                              direto do Inter
                            </span>
                          )}
                        </div>
                      ))}
                      {!tem && <p className="text-xs text-slate-400">Nenhum arquivo deste mês.</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
