// Credencial e ajustes do iFood de CADA filial.
//
// Cada casa é uma loja diferente no iFood (merchant próprio) e pode estar em
// estágio diferente: uma já integrada, outra ainda no Consumer, outra em teste.
// Por isso a configuração é POR FILIAL e não por env do servidor — env global
// obrigaria todas as casas a virarem a chave no mesmo dia.
//
// Mora na mesma tabela da Cielo (filial_credencial, provedor='ifood'), então
// não precisou de migration: o segredo entra cifrado (AES-256-GCM) e a tela
// mostra só a pista.

import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { decifrar, segredoConfigurado } from '@/lib/segredo';

export const PROVEDOR_IFOOD = 'ifood';

/** Campos que a tela pede, na ordem. `segredo` = entra e não volta. */
export const CAMPOS_IFOOD = [
  { chave: 'clientId', rotulo: 'client_id', ajuda: 'Do app no Portal do Desenvolvedor' },
  { chave: 'clientSecret', rotulo: 'client_secret', ajuda: 'Fica cifrado; depois de salvar some da tela', segredo: true },
  { chave: 'merchantId', rotulo: 'Loja (merchant_id)', ajuda: 'UUID da loja no iFood' },
  { chave: 'modo', rotulo: 'Tipo do app', ajuda: 'centralizado (client_credentials) ou distribuido (autorização da loja)' },
  { chave: 'codigoPdv', rotulo: 'Código de PDV do cardápio', ajuda: 'produto (PRODUTOS) é o que a Prainha usa; variante (PRODUTODETALHE) fica pra quem cadastrou diferente' },
  { chave: 'autoConfirmar', rotulo: 'Aceitar pedido automaticamente', ajuda: '1 = aceita sozinho' },
  { chave: 'puxador', rotulo: 'Quem puxa os pedidos', ajuda: 'loja (o vendas-local fala com o iFood) ou nuvem (o Concilia puxa e distribui). Tem que ser IGUAL em todas as casas do mesmo client_id' },
  { chave: 'ativo', rotulo: 'Integração ligada', ajuda: '1 = a loja recebe pedidos do iFood por aqui' },
  // App do FINANCEIRO. A API Financial não existe em app de categoria PDV:
  // é outro app no Portal (categoria Finanças), com outra credencial. Fica
  // separado de propósito — o puxador de pedidos e o vendas-local nunca veem
  // estas chaves, então trocar ou apagar aqui não mexe na fila de pedidos.
  { chave: 'finClientId', rotulo: 'client_id do app Financeiro', ajuda: 'App de categoria Finanças no Portal do Desenvolvedor' },
  { chave: 'finClientSecret', rotulo: 'client_secret do app Financeiro', ajuda: 'Fica cifrado; depois de salvar some da tela', segredo: true },
  { chave: 'finMerchantId', rotulo: 'Loja no app Financeiro (merchant_id)', ajuda: 'Em branco = a mesma loja dos pedidos' },
  { chave: 'finHomologacao', rotulo: 'Ambiente de homologação do Financeiro', ajuda: '1 = manda o header x-request-homologation (só durante a homologação)' },
] as const;

export type ChaveIfood = (typeof CAMPOS_IFOOD)[number]['chave'];
export const CHAVES_IFOOD = CAMPOS_IFOOD.map((c) => c.chave) as ChaveIfood[];
/** Só o client_secret é segredo de verdade. O resto é identificação e ajuste,
 *  e esconder isso da tela só atrapalharia quem precisa conferir. */
export const CHAVES_IFOOD_SECRETAS: ChaveIfood[] = ['clientSecret', 'finClientSecret'];
/** Chaves do app do Financeiro — salvas à parte e fora do "configurada". */
export const CHAVES_IFOOD_FIN: ChaveIfood[] = ['finClientId', 'finClientSecret', 'finMerchantId', 'finHomologacao'];

export interface ConfigIfood {
  clientId: string;
  clientSecret: string;
  merchantId: string;
  modo: 'centralizado' | 'distribuido';
  codigoPdv: 'variante' | 'produto';
  autoConfirmar: boolean;
  ativo: boolean;
  /** Quem faz o polling na API do iFood. A fila de eventos é por CREDENCIAL,
   *  não por loja: com duas casas no mesmo client_id, ou as duas puxam pela
   *  nuvem ou as duas puxam sozinhas — misturar divide a fila e some pedido. */
  puxador: 'loja' | 'nuvem';
  /** Tem credencial de PEDIDOS cadastrada pra esta filial. Só as chaves do
   *  app do Financeiro não contam: o vendas-local troca a credencial local
   *  pela da nuvem quando isto é true, e trocaria por uma vazia. */
  configurada: boolean;
  fin: ConfigIfoodFin;
}

export interface ConfigIfoodFin {
  clientId: string;
  clientSecret: string;
  /** Em branco = usa o merchantId dos pedidos. */
  merchantId: string;
  homologacao: boolean;
}

const VAZIA: ConfigIfood = {
  clientId: '', clientSecret: '', merchantId: '',
  modo: 'centralizado', codigoPdv: 'produto',
  autoConfirmar: true, ativo: false, puxador: 'loja', configurada: false,
  fin: { clientId: '', clientSecret: '', merchantId: '', homologacao: false },
};

const CHAVES_PEDIDOS = CHAVES_IFOOD.filter((c) => !CHAVES_IFOOD_FIN.includes(c)) as string[];

function montar(m: Record<string, string>, chaves: string[]): ConfigIfood {
  return {
    clientId: m.clientId ?? '',
    clientSecret: m.clientSecret ?? '',
    merchantId: m.merchantId ?? '',
    modo: m.modo === 'distribuido' ? 'distribuido' : 'centralizado',
    codigoPdv: m.codigoPdv === 'variante' ? 'variante' : 'produto',
    autoConfirmar: m.autoConfirmar !== '0',
    ativo: m.ativo === '1',
    // Default 'loja': quem já estava rodando não muda de dono do polling por
    // causa de deploy — a virada é explícita, casa por casa.
    puxador: m.puxador === 'nuvem' ? 'nuvem' : 'loja',
    configurada: chaves.some((c) => CHAVES_PEDIDOS.includes(c)),
    fin: {
      clientId: m.finClientId ?? '',
      clientSecret: m.finClientSecret ?? '',
      merchantId: m.finMerchantId ?? '',
      homologacao: m.finHomologacao === '1',
    },
  };
}

/** Credencial e loja que o módulo Financeiro usa: a do app do Financeiro
 *  quando cadastrada; senão a dos pedidos (que só funciona se esse app tiver
 *  o módulo Financial — app PDV não tem). */
export function credFinanceiro(cfg: ConfigIfood): {
  clientId: string;
  clientSecret: string;
  merchantId: string;
  homologacao: boolean;
  appProprio: boolean;
} | null {
  const proprio = Boolean(cfg.fin.clientId && cfg.fin.clientSecret);
  const clientId = proprio ? cfg.fin.clientId : cfg.clientId;
  const clientSecret = proprio ? cfg.fin.clientSecret : cfg.clientSecret;
  const merchantId = cfg.fin.merchantId || cfg.merchantId;
  if (!clientId || !clientSecret || !merchantId) return null;
  return { clientId, clientSecret, merchantId, homologacao: cfg.fin.homologacao, appProprio: proprio };
}

/** Config desta filial, já decifrada. Filial sem cadastro volta VAZIA e
 *  desligada — nunca herda credencial de outra casa. */
export async function configIfood(filialId: string): Promise<ConfigIfood> {
  if (!filialId || !segredoConfigurado()) return { ...VAZIA };
  const linhas = await db
    .select({ chave: schema.filialCredencial.chave, valor: schema.filialCredencial.valor })
    .from(schema.filialCredencial)
    .where(and(
      eq(schema.filialCredencial.filialId, filialId),
      eq(schema.filialCredencial.provedor, PROVEDOR_IFOOD),
    ));
  if (!linhas.length) return { ...VAZIA };

  const m: Record<string, string> = {};
  for (const l of linhas) {
    // CREDENCIAL_SECRET trocada deixa o valor ilegível: melhor tratar como
    // "não configurado" do que derrubar a tela inteira.
    try { m[l.chave] = decifrar(l.valor); } catch { /* ignora a chave ilegível */ }
  }
  return montar(m, linhas.map((l) => l.chave));
}

/** Config de TODAS as filiais que têm credencial do iFood, já decifrada.
 *  É o que o puxador da nuvem usa pra saber quais merchants são dele e de
 *  quem é cada pedido que chegar. */
export async function configsIfoodTodas(): Promise<Array<ConfigIfood & { filialId: string }>> {
  if (!segredoConfigurado()) return [];
  const linhas = await db
    .select({
      filialId: schema.filialCredencial.filialId,
      chave: schema.filialCredencial.chave,
      valor: schema.filialCredencial.valor,
    })
    .from(schema.filialCredencial)
    .where(eq(schema.filialCredencial.provedor, PROVEDOR_IFOOD));

  const porFilial = new Map<string, { m: Record<string, string>; chaves: string[] }>();
  for (const l of linhas) {
    const f = porFilial.get(l.filialId) ?? { m: {}, chaves: [] };
    f.chaves.push(l.chave);
    try { f.m[l.chave] = decifrar(l.valor); } catch { /* chave ilegível */ }
    porFilial.set(l.filialId, f);
  }

  return [...porFilial.entries()].map(([filialId, f]) => ({ filialId, ...montar(f.m, f.chaves) }));
}
