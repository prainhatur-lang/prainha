// RESPOSTA AUTOMÁTICA NO GOOGLE (18/10/2026) — pedido do dono: "suba a resposta
// sem precisar de intervenção humana". O cron de hora em hora lê as avaliações
// de cada casa ligada ao Google, escreve a resposta pela IA (mesmo motor do
// quadro de /avaliacoes, variando das últimas da casa) e publica pela API
// oficial do Perfil da Empresa.
//
// Só o Google: o TripAdvisor não tem API de resposta do proprietário e o
// contrato do Terra não deixa o conteúdo da API ir pra IA — lá continua o
// quadro com texto colado. Avaliação do Google não é gravada (política da API);
// fica só a resposta NOSSA + o id da avaliação, pra não responder duas vezes.
// Liga/desliga por casa em ⚙️ Configurar (filial.google_resposta_auto).

import { db, schema } from '@concilia/db';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { sugerirResposta } from '@/lib/avaliacao-resposta';
import { ErroGoogle, googleConfigurado, lerAvaliacoes, publicarResposta, tokenDeAcesso } from '@/lib/google-avaliacoes';
import { ligacoesGoogle } from '@/lib/google-avaliacoes-ligacao';

export const MODOS_RESPOSTA_AUTO = ['todas', 'nota_alta', 'desligado'] as const;
export type ModoRespostaAuto = (typeof MODOS_RESPOSTA_AUTO)[number];

/** quantas respostas por casa por rodada — a fila antiga se esvazia em poucas
 *  horas sem estourar o tempo do cron nem despejar dezenas de uma vez */
const POR_RODADA = 5;

export interface ResultadoCasa {
  filialId: string;
  nome: string;
  respondidas: number;
  pendentes: number;
  erro?: string;
}

export async function responderGoogleSozinho(): Promise<ResultadoCasa[]> {
  if (!googleConfigurado()) return [];
  const casas = await db
    .select({ id: schema.filial.id, nome: schema.filial.nome, modo: schema.filial.googleRespostaAuto })
    .from(schema.filial);
  const ativas = casas.filter((c) => c.modo === 'todas' || c.modo === 'nota_alta');
  if (ativas.length === 0) return [];
  const ligacoes = await ligacoesGoogle(ativas.map((c) => c.id));

  const out: ResultadoCasa[] = [];
  for (const casa of ativas) {
    const l = ligacoes.get(casa.id);
    if (!l?.local || !l.conta) continue;
    const res: ResultadoCasa = { filialId: casa.id, nome: casa.nome, respondidas: 0, pendentes: 0 };
    out.push(res);
    try {
      const acesso = await tokenDeAcesso(l.refreshToken);
      const leitura = await lerAvaliacoes(acesso, l.conta, l.local);

      // as que já respondemos (o Google pode demorar a mostrar a resposta)
      const ja = await db
        .select({ reviewId: schema.avaliacaoRespostaIa.reviewId })
        .from(schema.avaliacaoRespostaIa)
        .where(
          and(
            eq(schema.avaliacaoRespostaIa.filialId, casa.id),
            isNotNull(schema.avaliacaoRespostaIa.publicadaEm),
            inArray(
              schema.avaliacaoRespostaIa.reviewId,
              leitura.avaliacoes.map((a) => a.id).concat(['-']),
            ),
          ),
        );
      const feitas = new Set(ja.map((j) => j.reviewId));

      const fila = leitura.avaliacoes
        .filter((a) => !a.resposta && !feitas.has(a.id))
        .filter((a) => casa.modo === 'todas' || (a.nota !== null && a.nota >= 4))
        // mais antigas primeiro
        .sort((a, b) => String(a.criadoEm ?? '').localeCompare(String(b.criadoEm ?? '')));
      res.pendentes = fila.length;

      for (const av of fila.slice(0, POR_RODADA)) {
        const anteriores = await db
          .select({ resposta: schema.avaliacaoRespostaIa.resposta })
          .from(schema.avaliacaoRespostaIa)
          .where(
            and(
              eq(schema.avaliacaoRespostaIa.filialId, casa.id),
              inArray(schema.avaliacaoRespostaIa.canal, ['tripadvisor', 'google']),
            ),
          )
          .orderBy(desc(schema.avaliacaoRespostaIa.criadoEm))
          .limit(12);
        const r = await sugerirResposta({
          canal: 'google',
          casa: casa.nome,
          nota: av.nota,
          texto: av.texto || '(o cliente deu a nota e não escreveu comentário)',
          nome: av.autor ? av.autor.split(/\s+/)[0] : null,
          anteriores: anteriores.map((x) => x.resposta),
        });
        await publicarResposta(acesso, l.conta, l.local, av.id, r.resposta);
        await db.insert(schema.avaliacaoRespostaIa).values({
          filialId: casa.id,
          canal: 'google',
          nota: av.nota,
          resposta: r.resposta.slice(0, 4000),
          reviewId: av.id,
          publicadaEm: new Date(),
        });
        res.respondidas++;
        res.pendentes--;
      }
    } catch (e) {
      res.erro = e instanceof ErroGoogle ? `${e.motivo}: ${e.message}` : e instanceof Error ? e.message : String(e);
    }
  }
  return out;
}
