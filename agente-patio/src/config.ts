// Carrega config.json do diretorio de trabalho (ou CONCILIA_PATIO_CONFIG).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const ConfigSchema = z.object({
  api: z.object({
    url: z.string().url(),
    token: z.string().min(1),
  }),
  /** UUID da filial dona dessa cancela. */
  filialId: z.string().uuid(),
  /** entrada = imprime ticket + abre; saida = valida + abre. */
  papel: z.enum(['entrada', 'saida']),
  facial: z.object({
    host: z.string(),
    user: z.string().default('admin'),
    password: z.string(),
    /** Canal da porta no SS 3532 (default 1). */
    doorChannel: z.number().int().default(1),
  }),
  camera: z.object({
    /** Id da camera UniFi (Protect) que cobre essa cancela. */
    id: z.string(),
    nome: z.string().default(''),
  }),
  protect: z.object({
    host: z.string(),
    /** API key (integração) — usada pra snapshot/info da câmera. */
    apiKey: z.string(),
    /** Conta LOCAL do NVR (sem 2FA) pra login na API legada de eventos/placas. */
    username: z.string(),
    password: z.string(),
  }),
  /** Leitura de placa. fonte=polling (recomendado, outbound) ou webhook (mini-PC same-LAN). */
  placa: z
    .object({
      fonte: z.enum(['polling', 'webhook']).default('polling'),
      /** Intervalo do polling em ms. */
      intervalMs: z.number().int().min(500).max(30000).default(2000),
      /** Confiança mínima (0-1) pra aceitar a placa. Abaixo disso = não-lida (cai no ticket). */
      minConfianca: z.number().min(0).max(1).default(0.8),
    })
    .default({ fonte: 'polling', intervalMs: 2000, minConfianca: 0.8 }),
  laco: z
    .object({
      /** facial = entrada de alarme do SS 3532; rele = placa USB; none = nao instalado (usa placa como gatilho em DEV). */
      fonte: z.enum(['facial', 'rele', 'none']).default('none'),
    })
    .default({ fonte: 'none' }),
  /** Duracao do pulso de abertura do rele (ms). */
  relePulsoMs: z.number().int().min(100).max(10000).default(800),
  /** Se true, o agente abre a cancela sozinho no fluxo. Em F1 fica false
   *  (so captura/loga) pra nao acionar portao fisico sem querer. */
  autoAbrir: z.boolean().default(false),
  /** Janela (ms) pra casar evento de laco com leitura de placa. */
  correlacaoMs: z.number().int().min(1000).max(60000).default(8000),
  webhook: z.object({
    porta: z.number().int().min(1).max(65535).default(9099),
    /** Segredo opcional exigido no path/header do webhook (anti-spoofing). */
    segredo: z.string().default(''),
  }),
  /** UI local (Pátio ao vivo / caixa) servida pelo próprio agente. */
  web: z
    .object({ porta: z.number().int().min(1).max(65535).default(8080) })
    .default({ porta: 8080 }),
  /** Regras do caixa / validação. */
  caixa: z
    .object({
      /** Minutos que a saída fica liberada após validar (tolerância). */
      toleranciaSaidaMin: z.number().int().min(0).max(120).default(15),
      /** Valor pré-preenchido no "Cobrar" (centavos). */
      tarifaPadraoCentavos: z.number().int().min(0).default(1000),
    })
    .default({ toleranciaSaidaMin: 15, tarifaPadraoCentavos: 1000 }),
  /** Pasta de dados locais (sessões + fotos). Local-first. */
  dataDir: z.string().default('./data'),
  impressora: z
    .object({
      /** none (F1) | escpos-usb | escpos-net — definido na F2. */
      tipo: z.enum(['none', 'escpos-usb', 'escpos-net']).default('none'),
      host: z.string().optional(),
      porta: z.number().int().optional(),
      /** Largura em colunas (58mm=32, 80mm=48). */
      largura: z.number().int().optional(),
    })
    .default({ tipo: 'none' }),
});

export type Config = z.infer<typeof ConfigSchema>;

function configPath(): string {
  if (process.env.CONCILIA_PATIO_CONFIG) return resolve(process.env.CONCILIA_PATIO_CONFIG);
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
