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
  /** Janela de re-sincronizacao de PEDIDOS/ITENSPEDIDO em dias.
   *  Pedidos abertos dentro dessa janela sao re-buscados a cada ciclo
   *  e UPSERT no banco — captura updates pos-criacao (data_fechamento,
   *  valor_total, total_servico) que o cursor incremental por CODIGO
   *  perdia. Default 7 dias = uma semana operacional. */
  refetchJanelaDias: z.number().int().min(0).max(60).default(14),
});

export type Config = z.infer<typeof ConfigSchema>;

function configPath(): string {
  // 1. CONCILIA_CONFIG (env var)
  if (process.env.CONCILIA_CONFIG) return resolve(process.env.CONCILIA_CONFIG);
  // 2. config.json no diretorio do executavel
  return resolve(process.cwd(), 'config.json');
}

export function loadConfig(): Config {
  const path = configPath();
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    throw new Error(`Nao foi possivel ler config em ${path}. ${(e as Error).message}`);
  }
  // Remover BOM UTF-8 se presente (PowerShell 5 Set-Content -Encoding utf8 adiciona)
  const cleaned = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`config.json invalido: ${(e as Error).message}`);
  }
  const parsed = ConfigSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`config.json com erros: ${JSON.stringify(parsed.error.flatten(), null, 2)}`);
  }
  return parsed.data;
}
