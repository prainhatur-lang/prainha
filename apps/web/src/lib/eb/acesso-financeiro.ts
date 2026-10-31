// E.B. Serviços no contas a pagar / receber (pedido do dono 30/10/2026:
// "vamos colocar EB no contas a pagar e receber").
//
// A E.B. continua FORA de usuario_filial (ver lib/eb/faturas.ts): se entrasse
// lá, apareceria nas ~250 telas que listam as casas do usuário, no seletor do
// menu e nos totais. Aqui ela entra só nas telas de contas, pra quem é do grupo
// Admin (o dono — mesmo critério de podePagarPix).

import { filiaisDoUsuario, type FilialAcessivel } from '@/lib/filiais';
import { filialDoCnpj } from '@/lib/impostos/guia';
import { ehAdmin } from '@/lib/usuario-admin';
import { EB_CNPJ } from '@/lib/eb/faturas';
import { LELIS_CNPJ } from '@/lib/impostos/guia';

// Empresas fora de usuario_filial que entram só nas telas de contas, só pro
// Admin (pessoas autorizadas — pedido do dono 31/10/2026: "so tem acesso a
// lelis e eb pessoas autorizadas"). Lelis entrou em 31/10 (migrate-lelis-filial).
const EMPRESAS_SO_ADMIN: { cnpj: string; nome: string }[] = [
  { cnpj: EB_CNPJ, nome: 'E.B. Serviços' },
  { cnpj: LELIS_CNPJ, nome: 'Lelis Distribuidora' },
];

/** CNPJ é de empresa que fica fora do "Todas" das casas (E.B., Lelis)? */
export function ehEmpresaSoAdmin(cnpj: string | null | undefined): boolean {
  return !!cnpj && EMPRESAS_SO_ADMIN.some((e) => e.cnpj === cnpj);
}

const idCache = new Map<string, string>();
async function filialIdDoCnpj(cnpj: string): Promise<string | null> {
  const c = idCache.get(cnpj);
  if (c) return c;
  const f = await filialDoCnpj(cnpj);
  if (f?.id) idCache.set(cnpj, f.id);
  return f?.id ?? null;
}

let ebIdCache: string | null = null;

/** id da filial da E.B. (cacheado: não muda). */
export async function ebFilialId(): Promise<string | null> {
  if (ebIdCache) return ebIdCache;
  const eb = await filialDoCnpj(EB_CNPJ);
  ebIdCache = eb?.id ?? null;
  return ebIdCache;
}

/** O usuário pode mexer nas contas dessa filial por ela ser a E.B. ou a Lelis? (complementa usuario_filial) */
export async function ebLiberadaNoFinanceiro(userId: string, filialId: string | null | undefined): Promise<boolean> {
  if (!filialId) return false;
  let achou = false;
  for (const e of EMPRESAS_SO_ADMIN) {
    if ((await filialIdDoCnpj(e.cnpj)) === filialId) { achou = true; break; }
  }
  if (!achou) return false;
  return ehAdmin(userId);
}

/** Casas do usuário + E.B. e Lelis no fim (só pro Admin). Só pras telas de contas. */
export async function filiaisDoFinanceiro(userId: string): Promise<FilialAcessivel[]> {
  const filiais = await filiaisDoUsuario(userId);
  if (!(await ehAdmin(userId))) return filiais;
  const extras: FilialAcessivel[] = [];
  for (const e of EMPRESAS_SO_ADMIN) {
    const id = await filialIdDoCnpj(e.cnpj);
    if (!id || filiais.some((f) => f.id === id)) continue;
    const dados = await filialDoCnpj(e.cnpj);
    extras.push({
      id,
      nome: dados?.nome ?? e.nome,
      cnpj: e.cnpj,
      organizacaoNome: e.nome,
      role: 'DONO',
      ultimoPing: null,
      agenteToken: '',
      dataInicioConciliacao: null,
    });
  }
  return [...filiais, ...extras];
}
