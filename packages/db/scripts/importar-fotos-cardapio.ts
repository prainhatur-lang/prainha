// Importa fotos de uma PASTA pro cardápio do delivery, casando o nome do
// arquivo com o nome do item. Sobe pro bucket "cardapio" do Supabase e grava
// a URL em delivery_item.foto_url.
//
// Roda em DRY RUN por padrão: mostra o que casou e o que sobrou, sem gravar.
// Só grava com --aplicar.
//
//   pnpm --filter @concilia/db fotos:importar -- --pasta "/caminho/das/fotos"
//   pnpm --filter @concilia/db fotos:importar -- --pasta "..." --aplicar
//
// Casamento: nome do arquivo sem extensão vs nome do item, ambos normalizados
// (sem acento, minúsculo, sem pontuação). Aceita nome exato, item contido no
// arquivo ou arquivo contido no item. Ambíguo (casa com 2+ itens) é reportado
// e NÃO aplicado — nome de prato errado numa foto é pior que foto faltando.

import { config as loadEnv } from 'dotenv';
import { resolve, extname, basename } from 'node:path';
import { readdirSync, readFileSync, statSync } from 'node:fs';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const arg = (n: string, d?: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const APLICAR = args.includes('--aplicar');
const PASTA = arg('pasta');
const FILIAL = arg('filial', '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9')!;
const BUCKET = 'cardapio';
const EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MAX_BYTES = 10 * 1024 * 1024;

if (!PASTA) {
  console.error('Uso: fotos:importar -- --pasta "/caminho/das/fotos" [--aplicar]');
  process.exit(1);
}

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** minúsculo, sem acento, sem pontuação — pra comparar nome de arquivo x prato. */
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tipoMime(ext: string): string {
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

async function main() {
  const st = statSync(PASTA!);
  if (!st.isDirectory()) throw new Error(`${PASTA} nao e uma pasta`);

  const arquivos = readdirSync(PASTA!)
    .filter((f) => !f.startsWith('._') && !f.startsWith('.'))
    .filter((f) => EXTS.has(extname(f).toLowerCase()));
  console.log(`${arquivos.length} imagem(ns) em ${PASTA}\n`);

  const itens = await sql<Array<{ id: string; nome: string; foto_url: string | null }>>`
    SELECT id, nome, foto_url FROM delivery_item WHERE filial_id = ${FILIAL}
  `;
  if (itens.length === 0) {
    console.log('Nenhum item no cardápio do delivery — traga os produtos antes.');
    await sql.end();
    return;
  }
  console.log(`${itens.length} item(ns) no cardápio\n`);

  const casados: Array<{ arquivo: string; item: { id: string; nome: string; foto_url: string | null } }> = [];
  const ambiguos: Array<{ arquivo: string; itens: string[] }> = [];
  const semCasar: string[] = [];

  for (const arq of arquivos) {
    const base = norm(basename(arq, extname(arq)));
    if (!base) continue;
    const exatos = itens.filter((i) => norm(i.nome) === base);
    const candidatos =
      exatos.length > 0
        ? exatos
        : itens.filter((i) => {
            const n = norm(i.nome);
            return n.length >= 4 && (base.includes(n) || n.includes(base));
          });
    if (candidatos.length === 1) casados.push({ arquivo: arq, item: candidatos[0] });
    else if (candidatos.length > 1) ambiguos.push({ arquivo: arq, itens: candidatos.map((c) => c.nome) });
    else semCasar.push(arq);
  }

  console.log(`CASARAM: ${casados.length}`);
  for (const c of casados.slice(0, 40))
    console.log(`   ${c.arquivo}  ->  ${c.item.nome}${c.item.foto_url ? '  (JÁ TEM FOTO, será trocada)' : ''}`);
  if (casados.length > 40) console.log(`   ... e mais ${casados.length - 40}`);

  if (ambiguos.length) {
    console.log(`\nAMBÍGUOS (nao aplicados): ${ambiguos.length}`);
    for (const a of ambiguos.slice(0, 15))
      console.log(`   ${a.arquivo}  ->  ${a.itens.slice(0, 3).join(' | ')}${a.itens.length > 3 ? ' ...' : ''}`);
  }
  if (semCasar.length) {
    console.log(`\nSEM CASAR: ${semCasar.length}`);
    for (const s of semCasar.slice(0, 20)) console.log(`   ${s}`);
    if (semCasar.length > 20) console.log(`   ... e mais ${semCasar.length - 20}`);
  }

  const itensSemFoto = itens.filter((i) => !i.foto_url && !casados.some((c) => c.item.id === i.id));
  if (itensSemFoto.length) {
    console.log(`\nITENS QUE SEGUEM SEM FOTO: ${itensSemFoto.length}`);
    for (const i of itensSemFoto.slice(0, 20)) console.log(`   ${i.nome}`);
    if (itensSemFoto.length > 20) console.log(`   ... e mais ${itensSemFoto.length - 20}`);
  }

  if (!APLICAR) {
    console.log('\n--- DRY RUN: nada foi gravado. Rode de novo com --aplicar pra valer. ---');
    await sql.end();
    return;
  }

  if (!SUPA_URL || !SUPA_KEY) {
    console.error('\nFalta NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env');
    await sql.end();
    process.exit(1);
  }
  const supa = createClient(SUPA_URL, SUPA_KEY);

  console.log('\nAplicando...');
  let ok = 0;
  let erro = 0;
  for (const c of casados) {
    try {
      const caminho = resolve(PASTA!, c.arquivo);
      const buf = readFileSync(caminho);
      if (buf.length > MAX_BYTES) {
        console.log(`   PULOU (${(buf.length / 1024 / 1024).toFixed(1)}MB > 10MB): ${c.arquivo}`);
        erro++;
        continue;
      }
      const ext = extname(c.arquivo).toLowerCase();
      const destino = `${FILIAL}/${c.item.id}${ext}`;
      const up = await supa.storage
        .from(BUCKET)
        .upload(destino, buf, { contentType: tipoMime(ext), upsert: true });
      if (up.error) throw new Error(up.error.message);
      const { data: pub } = supa.storage.from(BUCKET).getPublicUrl(destino);
      await sql`
        UPDATE delivery_item
        SET foto_url = ${pub.publicUrl}, foto_path = ${destino}, atualizado_em = now()
        WHERE id = ${c.item.id}
      `;
      ok++;
      process.stdout.write(`\r   ${ok}/${casados.length}`);
    } catch (e) {
      erro++;
      console.log(`\n   ERRO em ${c.arquivo}: ${(e as Error).message}`);
    }
  }
  console.log(`\n\nPronto: ${ok} foto(s) aplicada(s), ${erro} com problema.`);
  await sql.end();
}

main().catch(async (e) => {
  console.error('ERRO:', (e as Error).message);
  await sql.end();
  process.exit(1);
});
