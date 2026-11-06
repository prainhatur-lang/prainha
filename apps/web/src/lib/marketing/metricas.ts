// Engajamento dos posts do Instagram de cada casa guardado no banco
// (marketing_metrica). Pedido do dono 06/11/2026: ver quais posts engajam mais
// nas 3 casas e seguir a linha que dá certo. A chave da Meta só existe no
// servidor, então o cron /api/cron/marketing-metricas lê e grava aqui.

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { chaveValida } from './chave';
import { postsInstagram } from './instagram';
import { todasLigacoesRedes } from './ligacao';

export async function gravarMetricasInstagram(limite = 50): Promise<Record<string, number | string>> {
  const out: Record<string, number | string> = {};
  const casas = (await todasLigacoesRedes()).filter((c) => c.rede === 'instagram');
  for (const c of casas) {
    try {
      const ig = await chaveValida(c.filialId, 'instagram');
      if (!ig) continue;
      const posts = await postsInstagram(ig.accessToken, limite);
      for (const p of posts) {
        await db.execute(sql`
          INSERT INTO marketing_metrica
            (filial_id, ig_post_id, legenda, tipo, produto, link, publicado_em,
             curtidas, comentarios, alcance, views, salvos, compartilhamentos, atualizado_em)
          VALUES (${c.filialId}, ${p.id}, ${p.legenda}, ${p.tipo}, ${p.produto}, ${p.link},
             ${p.quando || null}::timestamptz, ${p.curtidas}::int, ${p.comentarios}::int, ${p.alcance}::int,
             ${p.views}::int, ${p.salvos}::int, ${p.compartilhamentos}::int, now())
          ON CONFLICT (filial_id, ig_post_id) DO UPDATE SET
            legenda = excluded.legenda,
            curtidas = COALESCE(excluded.curtidas, marketing_metrica.curtidas),
            comentarios = COALESCE(excluded.comentarios, marketing_metrica.comentarios),
            alcance = COALESCE(excluded.alcance, marketing_metrica.alcance),
            views = COALESCE(excluded.views, marketing_metrica.views),
            salvos = COALESCE(excluded.salvos, marketing_metrica.salvos),
            compartilhamentos = COALESCE(excluded.compartilhamentos, marketing_metrica.compartilhamentos),
            atualizado_em = now()`);
      }
      out[c.filialId] = posts.length;
    } catch (e) {
      out[c.filialId] = e instanceof Error ? e.message : String(e);
    }
  }
  return out;
}
