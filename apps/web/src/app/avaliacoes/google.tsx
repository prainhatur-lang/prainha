// Bloco "Google" do painel de avaliações: nota, total e as avaliações mais
// recentes de cada casa, com quem ainda está sem resposta — e a resposta da casa
// publicada daqui (o Google TEM caminho oficial pra isso; o TripAdvisor não).
//
// Lê AO VIVO a cada abertura da tela: a política da API do Google não deixa
// guardar as avaliações, então não há cron, tabela nem histórico (ver
// lib/google-avaliacoes.ts). Enquanto as chaves do Google não estiverem na
// Vercel e a conta não for ligada, o bloco só aparece pra quem configura.
// Erro inesperado aqui nunca derruba a tela de avaliações: o bloco some.

import { segredoConfigurado } from '@/lib/segredo';
import {
  ErroGoogle,
  googleConfigurado,
  lerAvaliacoes,
  tokenDeAcesso,
  uriDeRetorno,
  type AvaliacaoGoogle,
  type LeituraGoogle,
} from '@/lib/google-avaliacoes';
import { ligacoesGoogle, type LigacaoGoogle } from '@/lib/google-avaliacoes-ligacao';
import { AvisoGoogle, EscolherFichas, ResponderGoogle } from './google-cliente';

const FUSO = 'America/Sao_Paulo';
const VISIVEIS = 5;
const PEDIDO_DE_ACESSO = 'https://support.google.com/business/contact/api_default';

function dia(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: '2-digit' });
}

function notaBr(n: number): string {
  return n.toFixed(1).replace('.', ',');
}

function Estrelas({ nota }: { nota: number }) {
  const n = Math.max(0, Math.min(5, Math.round(nota)));
  return (
    <span className="whitespace-nowrap text-amber-500" aria-label={`${n} de 5`}>
      {'★'.repeat(n)}
      <span className="text-slate-300">{'★'.repeat(5 - n)}</span>
    </span>
  );
}

const quando = (a: AvaliacaoGoogle) => (a.criadoEm ? Date.parse(a.criadoEm) || 0 : 0);
const baixa = (a: AvaliacaoGoogle) => a.nota !== null && a.nota <= 3;

/** Sem resposta primeiro (a nota mais baixa na frente); depois as respondidas,
 *  da mais nova pra mais antiga. */
function ordenar(avs: AvaliacaoGoogle[]): AvaliacaoGoogle[] {
  return [...avs].sort((a, b) => {
    const ra = a.resposta ? 1 : 0;
    const rb = b.resposta ? 1 : 0;
    if (ra !== rb) return ra - rb;
    if (!a.resposta && (a.nota ?? 6) !== (b.nota ?? 6)) return (a.nota ?? 6) - (b.nota ?? 6);
    return quando(b) - quando(a);
  });
}

type Lida = { ok: true; leitura: LeituraGoogle } | { ok: false; mensagem: string; religar: boolean };

async function ler(l: LigacaoGoogle): Promise<Lida> {
  try {
    const acesso = await tokenDeAcesso(l.refreshToken);
    return { ok: true, leitura: await lerAvaliacoes(acesso, l.conta, l.local) };
  } catch (e) {
    if (e instanceof ErroGoogle) return { ok: false, mensagem: e.message, religar: e.motivo === 'religar' };
    console.error('[google-avaliacoes] leitura:', e);
    return { ok: false, mensagem: 'Não consegui ler o Google agora. Recarregue a página em instantes.', religar: false };
  }
}

interface Props {
  filiais: Array<{ id: string; nome: string }>;
  /** avaliacao.configurar — liga a conta Google e escolhe a ficha de cada casa */
  podeConfigurar: boolean;
  /** avaliacao.update — escreve e publica a resposta da casa */
  podeAtualizar: boolean;
}

export async function BlocoGoogle(props: Props) {
  try {
    return await montar(props);
  } catch (e) {
    console.error('[google-avaliacoes] bloco:', e);
    return null;
  }
}

function Avaliacao({
  a,
  filialId,
  podeAtualizar,
}: {
  a: AvaliacaoGoogle;
  filialId: string;
  podeAtualizar: boolean;
}) {
  return (
    <li className="text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {a.nota !== null && <Estrelas nota={a.nota} />}
        <span className="text-xs text-slate-500">
          {dia(a.criadoEm)}
          {a.autor ? ` · ${a.autor}` : ''}
        </span>
        {a.resposta ? (
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
            respondida
          </span>
        ) : (
          <span
            className={
              baixa(a)
                ? 'rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-semibold text-rose-800'
                : 'rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600'
            }
          >
            sem resposta
          </span>
        )}
      </div>
      {a.texto ? (
        <p className={a.resposta ? 'mt-1 line-clamp-4 text-slate-600' : 'mt-1 whitespace-pre-line text-slate-700'}>
          {a.texto}
        </p>
      ) : (
        <p className="mt-1 text-xs italic text-slate-400">Só a nota, sem comentário.</p>
      )}
      {a.resposta && (
        <div className="mt-1 rounded border-l-2 border-slate-200 bg-slate-50 px-2 py-1">
          <p className="text-[11px] text-slate-500">
            Resposta da casa{a.resposta.em ? ` · ${dia(a.resposta.em)}` : ''}
            {a.resposta.estado === 'PENDING' && ' · em análise no Google'}
            {a.resposta.estado === 'REJECTED' && (
              <span className="font-semibold text-rose-700"> · recusada pelo Google</span>
            )}
          </p>
          <p className="line-clamp-3 text-xs text-slate-600">{a.resposta.texto}</p>
        </div>
      )}
      {podeAtualizar && (
        <ResponderGoogle
          filialId={filialId}
          reviewId={a.id}
          nota={a.nota}
          texto={a.texto}
          respostaAtual={a.resposta?.texto ?? ''}
        />
      )}
    </li>
  );
}

async function montar({ filiais, podeConfigurar, podeAtualizar }: Props) {
  if (filiais.length === 0) return null;

  // 1) faltam as chaves na Vercel: só quem configura vê o que falta
  if (!googleConfigurado() || !segredoConfigurado()) {
    if (!podeConfigurar) return null;
    return (
      <>
        <h2 id="google" className="mt-10 text-lg font-semibold text-slate-900">
          Google
        </h2>
        <AvisoGoogle />
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-700 shadow-sm">
          <p>
            As avaliações do Google podem aparecer aqui, com quem ainda está sem resposta, e a resposta da casa
            ser publicada por este painel. Falta ligar, uma vez só:
          </p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-xs text-slate-600">
            <li>
              Pedir ao Google o acesso à API do Perfil da Empresa:{' '}
              <a href={PEDIDO_DE_ACESSO} target="_blank" rel="noreferrer" className="font-medium text-emerald-700 hover:underline">
                formulário “Application for Basic API Access” ↗
              </a>
              , com o número do projeto do Google Cloud e o e-mail que administra as fichas das casas. O Google
              analisa o pedido antes de liberar.
            </li>
            <li>
              No projeto do Google Cloud: ativar as APIs do Perfil da Empresa, criar um cliente OAuth do tipo
              “Aplicativo da Web” com este endereço de retorno:{' '}
              <code className="break-all rounded bg-slate-100 px-1 py-0.5">{uriDeRetorno('')}</code> e deixar a
              tela de consentimento “Em produção” (em “Teste” a ligação cai a cada 7 dias).
            </li>
            <li>
              Salvar na Vercel, em Production: <code className="rounded bg-slate-100 px-1 py-0.5">GOOGLE_BUSINESS_CLIENT_ID</code>{' '}
              e <code className="rounded bg-slate-100 px-1 py-0.5">GOOGLE_BUSINESS_CLIENT_SECRET</code>.
            </li>
            <li>Voltar aqui e tocar em “Ligar conta Google”.</li>
          </ol>
        </div>
      </>
    );
  }

  const ligacoes = await ligacoesGoogle(filiais.map((f) => f.id));

  // 2) chaves ok, conta ainda não ligada
  if (ligacoes.size === 0) {
    if (!podeConfigurar) return null;
    return (
      <>
        <h2 id="google" className="mt-10 text-lg font-semibold text-slate-900">
          Google
        </h2>
        <AvisoGoogle />
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-700 shadow-sm">
          <p>
            Ligue a conta Google que administra as fichas das casas. Depois disso as avaliações do Google
            aparecem aqui e a resposta da casa pode ser publicada por este painel.
          </p>
          <a
            href="/api/avaliacoes/google/conectar"
            className="mt-3 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Ligar conta Google
          </a>
          <p className="mt-2 text-[11px] text-slate-400">
            Abre a tela do Google pra você autorizar. A chave fica guardada cifrada; nenhuma avaliação é gravada.
          </p>
        </div>
      </>
    );
  }

  // 3) ligado: lê ao vivo as casas que já têm ficha escolhida
  const comFicha = filiais
    .map((f) => ({ filial: f, l: ligacoes.get(f.id) }))
    .filter((x): x is { filial: { id: string; nome: string }; l: LigacaoGoogle } => Boolean(x.l?.local))
    .sort((a, b) => a.filial.nome.localeCompare(b.filial.nome));
  if (comFicha.length === 0 && !podeConfigurar) return null;

  const lidas = await Promise.all(comFicha.map((x) => ler(x.l)));
  const casas = comFicha.map((x, i) => {
    const r = lidas[i]!;
    return { ...x, r, avaliacoes: r.ok ? ordenar(r.leitura.avaliacoes) : [] };
  });

  // nota baixa que a casa ainda não respondeu, entre as que a leitura trouxe
  const semResposta = casas.flatMap((c) =>
    c.avaliacoes.filter((a) => baixa(a) && !a.resposta).map((a) => ({ casa: c.filial.nome, a })),
  );
  // casas que ainda não têm ficha escolhida (pra quem configura saber o que falta)
  const semFicha = filiais.filter((f) => !ligacoes.get(f.id)?.local).map((f) => f.nome);

  return (
    <>
      <h2 id="google" className="mt-10 text-lg font-semibold text-slate-900">
        Google
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Lido agora, direto do Google: as avaliações mais recentes de cada casa (até 50). O Google não deixa
        guardar as avaliações, então aqui não há histórico.
        {podeAtualizar && ' A resposta da casa é publicada daqui, no clique de quem escreveu.'}
      </p>
      <AvisoGoogle />

      {semResposta.length > 0 && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <p className="font-semibold">
            {semResposta.length === 1
              ? '1 avaliação baixa sem resposta da casa'
              : `${semResposta.length} avaliações baixas sem resposta da casa`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {semResposta.slice(0, 8).map(({ casa, a }) => (
              <li key={`${casa}-${a.id}`}>
                {casa} — {a.nota}★ em {dia(a.criadoEm)}
                {a.autor ? ` · ${a.autor}` : ''}
              </li>
            ))}
            {semResposta.length > 8 && <li>e mais {semResposta.length - 8}.</li>}
          </ul>
        </div>
      )}

      {casas.length > 0 && (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {casas.map(({ filial, l, r, avaliacoes }) => {
            const pendentes = avaliacoes.filter((a) => !a.resposta).length;
            return (
              <div key={filial.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-slate-900">{filial.nome}</h3>
                  <a
                    href="https://business.google.com/reviews"
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-xs font-medium text-emerald-700 hover:underline"
                  >
                    abrir no Google ↗
                  </a>
                </div>
                {l.titulo && <p className="text-[11px] text-slate-400">Ficha: {l.titulo}</p>}

                {!r.ok ? (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <p>{r.mensagem}</p>
                    {r.religar &&
                      (podeConfigurar ? (
                        <a href="/api/avaliacoes/google/conectar" className="mt-1 inline-block font-semibold underline">
                          Ligar a conta Google de novo
                        </a>
                      ) : (
                        <p className="mt-1">Peça a quem configura as avaliações pra ligar de novo.</p>
                      ))}
                  </div>
                ) : r.leitura.total === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">Ainda sem avaliações no Google.</p>
                ) : (
                  <>
                    <div className="mt-3 flex items-baseline gap-2">
                      {r.leitura.media !== null && (
                        <>
                          <span className="text-3xl font-bold text-slate-900">{notaBr(r.leitura.media)}</span>
                          <Estrelas nota={r.leitura.media} />
                        </>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">
                      {r.leitura.total} avaliações
                      {avaliacoes.length > 0 && (
                        <span className={pendentes > 0 ? 'font-medium text-rose-700' : 'font-medium text-emerald-700'}>
                          {' '}
                          ·{' '}
                          {pendentes === 0
                            ? `todas respondidas entre as ${avaliacoes.length} mais recentes`
                            : `${pendentes} sem resposta entre as ${avaliacoes.length} mais recentes`}
                        </span>
                      )}
                    </p>

                    {avaliacoes.length > 0 && (
                      <ul className="mt-4 space-y-3 border-t border-slate-100 pt-3">
                        {avaliacoes.slice(0, VISIVEIS).map((a) => (
                          <Avaliacao key={a.id} a={a} filialId={filial.id} podeAtualizar={podeAtualizar} />
                        ))}
                      </ul>
                    )}
                    {avaliacoes.length > VISIVEIS && (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-xs font-medium text-emerald-700">
                          ver as outras {avaliacoes.length - VISIVEIS}
                        </summary>
                        <ul className="mt-3 space-y-3">
                          {avaliacoes.slice(VISIVEIS).map((a) => (
                            <Avaliacao key={a.id} a={a} filialId={filial.id} podeAtualizar={podeAtualizar} />
                          ))}
                        </ul>
                      </details>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* nenhuma casa com ficha ainda: a lista já abre, é o passo que falta */}
      {podeConfigurar && <EscolherFichas abrirDeCara={casas.length === 0} semFicha={semFicha} />}
    </>
  );
}
