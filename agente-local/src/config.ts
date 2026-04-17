// Carrega config.json do diretorio do executavel.
// O arquivo config.json e gerado pelo instalador (ou criado manualmente).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const ConfigSchema = z.object({
  api: z.object({
    url: z.string().url(),
    token: z.string().startsWith('agt_'),
  }),
  firebird: z.object({
    host: z.string(),
    port: z.number().int().default(3050),
    database: z.string(),
    user: z.string().default('SYSDBA'),
    password: z.string(),
  }),
  /** Intervalo entre sincronizacoes em segundos. */
  intervalSeconds: z.number().int().min(60).default(900),
  /** Tamanho maximo do batch enviado por POST. */
  batchSize: z.number().int().min(1).max(2000).default(500),
  /** Caminho do arquivo de checkpoint local. */
  checkpointFile: z.string().default('checkpoint.json'),
});

export type Config = z.infer<typeof ConfigSchema>;

function configPath(): string {
  // 1. CONCILIA_CONFIG (env var)
  if (process.env.CONCILIA_CONFIG) return resolve(process.env.CONCILIA_CONFIG);
  // 2. config.json no diretorio do executavel
  return resolve(process.cwd(), 'config.json');
}

let zod: typeof import('zod');
async function loadZod() {
  if (!zod) zod = await import('zod');
  return zod;
}

export async function loadConfig(): Promise<Config> {
  await loadZod(); // mantem o import vivo no bundle
  const path = configPath();
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    throw new Error(`Nao foi possivel ler config em ${path}. ${(e as Error).message}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`config.json invalido: ${(e as Error).message}`);
  }
  const parsed = ConfigSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`config.json com erros: ${JSON.stringify(parsed.error.flatten(), null, 2)}`);
  }
  return parsed.data;
}
