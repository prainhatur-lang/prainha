// Foto do item do delivery a partir da foto do salão (dono 22/11/2026: "não
// está trazendo as fotos"). A foto do produto mora no servidor da LOJA
// (vendas-local, tabela produto_foto, servida em <caixa_url>/produto-foto/<cod>,
// chaveada pelo código do produto no PDV daquela casa). O delivery usa outra
// foto: delivery_item.foto_url no bucket público "cardapio" do Supabase.
//
// Aqui: pra cada item SEM foto, ligado a uma variante desta casa, baixa a foto
// do servidor desta mesma casa e sobe pro bucket. Nunca troca foto que já
// existe e nunca pega foto de outra casa (cada casa numera o catálogo por
// conta própria — ver memória fotos-produto-por-casa).
import { randomBytes } from 'node:crypto';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';
import { caixaUrlDaFilial } from '@/lib/caixa-loja';

const BUCKET = 'cardapio';
const TIMEOUT_MS = 8000;
const PARALELO = 6;

export type ResultadoFotos = {
  ok: boolean;
  erro?: string;
  verificados: number;
  trazidas: number;
  semFotoNaLoja: number;
  falhas: number;
};

function extOf(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  return 'jpg';
}

/** Puxa do servidor da loja a foto dos itens do delivery que estão sem foto.
 *  `itemIds` limita a esses itens (ex.: os que acabaram de ser trazidos);
 *  sem ele, olha todos os itens sem foto da filial. Nunca lança. */
export async function puxarFotosDaLoja(
  filialId: string,
  itemIds?: string[],
): Promise<ResultadoFotos> {
  const vazio = { verificados: 0, trazidas: 0, semFotoNaLoja: 0, falhas: 0 };
  if (itemIds && itemIds.length === 0) return { ok: true, ...vazio };
  try {
    const base = await caixaUrlDaFilial(filialId);
    if (!base) return { ok: false, erro: 'filial sem endereço do servidor da loja', ...vazio };

    const conds = [
      eq(schema.deliveryItem.filialId, filialId),
      isNull(schema.deliveryItem.fotoUrl),
    ];
    if (itemIds) conds.push(inArray(schema.deliveryItem.id, itemIds));

    const alvos = await db
      .select({
        id: schema.deliveryItem.id,
        codigo: schema.produtoVariante.codigoProdutoExterno,
      })
      .from(schema.deliveryItem)
      .innerJoin(
        schema.produtoVariante,
        and(
          eq(schema.produtoVariante.id, schema.deliveryItem.varianteId),
          eq(schema.produtoVariante.filialId, filialId),
        ),
      )
      .where(and(...conds));

    const r = { ...vazio, verificados: alvos.length };
    if (alvos.length === 0) return { ok: true, ...r };

    const supa = await createAdminClient();
    const fila = alvos.filter((a) => a.codigo != null);
    r.semFotoNaLoja += alvos.length - fila.length;

    async function um(a: { id: string; codigo: number | null }) {
      try {
        const resp = await fetch(`${base}/produto-foto/${a.codigo}`, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: 'no-store',
        });
        const tipo = resp.headers.get('content-type') ?? '';
        if (resp.status === 404 || (resp.ok && !tipo.startsWith('image/'))) {
          r.semFotoNaLoja++;
          return;
        }
        if (!resp.ok) {
          r.falhas++;
          return;
        }
        const buf = Buffer.from(await resp.arrayBuffer());
        if (buf.length < 200) {
          r.semFotoNaLoja++;
          return;
        }
        const path = `${filialId}/${Date.now()}-${randomBytes(6).toString('hex')}.${extOf(tipo)}`;
        const up = await supa.storage
          .from(BUCKET)
          .upload(path, buf, { contentType: tipo, upsert: false });
        if (up.error) {
          r.falhas++;
          return;
        }
        const { data: pub } = supa.storage.from(BUCKET).getPublicUrl(path);
        // Só grava se continuar sem foto (alguém pode ter subido uma no meio).
        const gravou = await db
          .update(schema.deliveryItem)
          .set({ fotoUrl: pub.publicUrl, fotoPath: path })
          .where(and(eq(schema.deliveryItem.id, a.id), isNull(schema.deliveryItem.fotoUrl)))
          .returning({ id: schema.deliveryItem.id });
        if (gravou.length > 0) r.trazidas++;
        else await supa.storage.from(BUCKET).remove([path]);
      } catch {
        r.falhas++;
      }
    }

    for (let i = 0; i < fila.length; i += PARALELO) {
      await Promise.all(fila.slice(i, i + PARALELO).map(um));
    }
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e), ...vazio };
  }
}
