// Joga posts montados pelo Claude na fila de aprovação do /marketing
// (status AGUARDANDO, origem 'claude'). O dono aprova ou recusa na tela;
// aprovado sai sozinho pelo cron. Pedido do dono 25/10/2026.
//
// Uso: pnpm --filter @concilia/db exec tsx scripts/marketing-fila-inserir.ts <arquivo.json>
// O JSON é uma lista de:
//   { filialId, titulo, roteiro?, legenda, legendaTiktok?, musica?, redes?, agendadoPara (ISO),
//     fotos?: [{ url, nome }] }   ← fotos baixadas da URL e postas no depósito marketing-midia
// Não repete: post da mesma casa com o mesmo título e horário já na fila é pulado.

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

type Entrada = {
  filialId: string;
  titulo: string;
  roteiro?: string;
  legenda: string;
  legendaTiktok?: string;
  musica?: string;
  redes?: string[];
  agendadoPara: string;
  fotos?: Array<{ url: string; nome: string }>;
};

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
const supa = process.env.NEXT_PUBLIC_SUPABASE_URL;
const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !supa || !chave) throw new Error('faltam DATABASE_URL / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
const sql = postgres(url, { prepare: false, ssl: 'require' });
const BUCKET = 'marketing-midia';

async function subirFoto(filialId: string, origem: string, nome: string): Promise<string> {
  const r = await fetch(origem);
  if (!r.ok) throw new Error(`foto ${origem}: HTTP ${r.status}`);
  const tipo = r.headers.get('content-type') ?? 'image/jpeg';
  if (!tipo.startsWith('image/jpeg')) throw new Error(`foto ${origem}: ${tipo} (o Instagram só aceita JPEG)`);
  const corpo = Buffer.from(await r.arrayBuffer());
  const seguro = nome.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 60);
  const path = `${filialId}/claude-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${seguro}`;
  const up = await fetch(`${supa}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { apikey: chave, Authorization: `Bearer ${chave}`, 'Content-Type': 'image/jpeg', 'x-upsert': 'false' },
    body: corpo,
  });
  if (!up.ok) throw new Error(`depósito ${path}: HTTP ${up.status} ${await up.text()}`);
  return path;
}

async function main() {
  const arq = process.argv[2];
  if (!arq) throw new Error('passe o arquivo .json');
  const lista = JSON.parse(readFileSync(resolve(arq), 'utf8')) as Entrada[];
  for (const p of lista) {
    const quando = new Date(p.agendadoPara);
    if (Number.isNaN(quando.getTime())) throw new Error(`${p.titulo}: agendadoPara inválido`);
    if (p.legenda.length > 2200) throw new Error(`${p.titulo}: legenda passou de 2200`);
    const [ja] = await sql`
      SELECT id FROM marketing_post
       WHERE filial_id = ${p.filialId} AND titulo = ${p.titulo} AND agendado_para = ${quando}
         AND origem = 'claude' AND status = 'AGUARDANDO'
       LIMIT 1`;
    if (ja) {
      console.log(`= já na fila: ${p.titulo}`);
      continue;
    }
    const midias: Array<{ path: string; tipo: 'foto'; nome: string }> = [];
    for (const f of p.fotos ?? []) midias.push({ path: await subirFoto(p.filialId, f.url, f.nome), tipo: 'foto', nome: f.nome });
    const [novo] = await sql`
      INSERT INTO marketing_post
        (filial_id, midias, legenda, redes, agendado_para, status, origem, titulo, roteiro, legenda_tiktok, musica, criado_por_email)
      VALUES
        (${p.filialId}, ${sql.json(midias)}, ${p.legenda}, ${sql.json(p.redes ?? ['instagram', 'tiktok'])}, ${quando},
         'AGUARDANDO', 'claude', ${p.titulo}, ${p.roteiro ?? null}, ${p.legendaTiktok ?? null}, ${p.musica ?? null}, 'claude')
      RETURNING id`;
    console.log(`+ ${p.titulo} (${midias.length} foto(s)) → ${novo.id}`);
  }
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
