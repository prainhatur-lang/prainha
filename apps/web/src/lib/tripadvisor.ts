// TripAdvisor pela API oficial (Terra, plano Discover). Chave em
// TRIPADVISOR_API_KEY, uma só pras três casas. O id do local sai do link de
// avaliação que o dono já salvou em /avaliacoes (filial.tripadvisor_review_url).
//
// O plano cobra por consulta e só entrega as 3 avaliações mais recentes por
// leitura: quem chama é o cron /api/cron/tripadvisor, 1 vez por dia, e a tela
// lê do banco (tripadvisor_resumo / tripadvisor_avaliacao) — nunca da API.

import { db, schema } from '@concilia/db';
import { isNotNull, sql } from 'drizzle-orm';
import { hojeBr } from '@/lib/datas';

const BASE = 'https://terra.tripadvisor.com/api';

interface TerraTexto {
  language?: string;
  value?: string;
  primary?: boolean;
}

interface TerraLocal {
  id: number;
  urls?: { tripadvisor?: { main?: string } };
  traveler_ratings?: {
    overall?: { rating?: number; count?: number };
    breakdowns?: Array<{ rating: number; count: number }>;
    subratings?: Array<{ type: string; type_name?: string; rating: number; count: number }>;
  };
}

interface TerraAvaliacao {
  id: number;
  publish_ts?: string;
  rating: number;
  travel_date?: string;
  url?: string;
  user?: { username?: string };
  title?: TerraTexto[];
  text?: TerraTexto[];
  owner_response?: { text?: TerraTexto[] } | null;
}

/** O d123456 do link do TripAdvisor (UserReviewEdit-g303638-d16804020-… ou
 *  UserReviewEdit-d33110570?m=…). */
export function locationIdDoLink(link: string | null | undefined): number | null {
  const m = /[-/]d(\d{5,})(?:\D|$)/.exec(link ?? '');
  return m ? Number(m[1]) : null;
}

function chave(): string {
  // env da Vercel já veio com quebra de linha no fim em outra chave
  return (process.env.TRIPADVISOR_API_KEY ?? '').trim();
}

export function tripadvisorConfigurado(): boolean {
  return chave().length > 0;
}

async function terra<T>(caminho: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams({ version: '1', ...params });
  const r = await fetch(`${BASE}${caminho}?${qs}`, {
    headers: { 'X-API-Key': chave(), Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    const corpo = await r.text().catch(() => '');
    throw new Error(`TripAdvisor ${r.status} em ${caminho}: ${corpo.slice(0, 200)}`);
  }
  return (await r.json()) as T;
}

/** Texto no idioma em que foi escrito (o TripAdvisor manda uma lista de traduções). */
function original(lista: TerraTexto[] | undefined): TerraTexto | null {
  if (!lista?.length) return null;
  return lista.find((t) => t.primary) ?? lista[0] ?? null;
}

export interface LeituraTripadvisor {
  filialId: string;
  nome: string;
  locationId: number | null;
  nota: number | null;
  total: number;
  avaliacoes: number;
  erro?: string;
}

/** Lê nota, total e últimas avaliações de cada casa que tem link do TripAdvisor
 *  e grava a foto do dia. Uma casa que falha não derruba as outras. */
export async function sincronizarTripadvisor(): Promise<LeituraTripadvisor[]> {
  if (!tripadvisorConfigurado()) throw new Error('TRIPADVISOR_API_KEY ausente');

  const filiais = await db
    .select({ id: schema.filial.id, nome: schema.filial.nome, link: schema.filial.tripadvisorReviewUrl })
    .from(schema.filial)
    .where(isNotNull(schema.filial.tripadvisorReviewUrl))
    .orderBy(schema.filial.nome);

  const dia = hojeBr();
  const saida: LeituraTripadvisor[] = [];

  for (const f of filiais) {
    const locationId = locationIdDoLink(f.link);
    const linha: LeituraTripadvisor = { filialId: f.id, nome: f.nome, locationId, nota: null, total: 0, avaliacoes: 0 };
    saida.push(linha);
    if (!locationId) {
      linha.erro = 'link do TripAdvisor sem o id do local';
      continue;
    }
    try {
      const local = await terra<TerraLocal>(`/locations/${locationId}`, { locale: 'pt-BR' });
      const tr = local.traveler_ratings;
      const nota = typeof tr?.overall?.rating === 'number' ? tr.overall.rating : null;
      const total = tr?.overall?.count ?? 0;
      const distribuicao: Record<string, number> = {};
      for (const b of tr?.breakdowns ?? []) distribuicao[String(b.rating)] = b.count;
      const subnotas = (tr?.subratings ?? []).map((s) => ({
        tipo: s.type,
        nome: s.type_name ?? s.type,
        nota: s.rating,
        total: s.count,
      }));
      const foto = {
        locationId,
        nota: nota === null ? null : nota.toFixed(1),
        total,
        distribuicao,
        subnotas,
        paginaUrl: local.urls?.tripadvisor?.main ?? null,
        lidoEm: new Date(),
      };
      await db
        .insert(schema.tripadvisorResumo)
        .values({ filialId: f.id, dia, ...foto })
        .onConflictDoUpdate({
          target: [schema.tripadvisorResumo.filialId, schema.tripadvisorResumo.dia],
          set: foto,
        });
      linha.nota = nota;
      linha.total = total;

      const resp = await terra<{ data?: TerraAvaliacao[] }>(`/locations/${locationId}/reviews`, { language: 'primary' });
      for (const a of resp.data ?? []) {
        if (typeof a.id !== 'number' || typeof a.rating !== 'number') continue;
        const titulo = original(a.title);
        const texto = original(a.text);
        const resposta = original(a.owner_response?.text);
        const publicado = a.publish_ts ? new Date(a.publish_ts) : null;
        const dados = {
          nota: Math.round(a.rating),
          titulo: titulo?.value ?? null,
          texto: texto?.value ?? null,
          idioma: (texto?.language ?? titulo?.language ?? null)?.slice(0, 12) ?? null,
          usuario: a.user?.username?.slice(0, 120) ?? null,
          publicadoEm: publicado && !Number.isNaN(publicado.getTime()) ? publicado : null,
          viagem: a.travel_date?.slice(0, 10) ?? null,
          url: a.url ?? null,
          respondida: !!a.owner_response,
          respostaTexto: resposta?.value ?? null,
        };
        await db
          .insert(schema.tripadvisorAvaliacao)
          .values({ filialId: f.id, reviewId: a.id, ...dados })
          .onConflictDoUpdate({
            target: [schema.tripadvisorAvaliacao.filialId, schema.tripadvisorAvaliacao.reviewId],
            set: { ...dados, atualizadoEm: sql`now()` },
          });
        linha.avaliacoes++;
      }
    } catch (e) {
      linha.erro = (e as Error).message;
      console.error('[tripadvisor]', f.nome, linha.erro);
    }
  }
  return saida;
}
