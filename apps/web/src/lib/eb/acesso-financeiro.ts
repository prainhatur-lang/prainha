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

let ebIdCache: string | null = null;

/** id da filial da E.B. (cacheado: não muda). */
export async function ebFilialId(): Promise<string | null> {
  if (ebIdCache) return ebIdCache;
  const eb = await filialDoCnpj(EB_CNPJ);
  ebIdCache = eb?.id ?? null;
  return ebIdCache;
}

/** O usuário pode mexer nas contas dessa filial por ela ser a E.B.? (complementa usuario_filial) */
export async function ebLiberadaNoFinanceiro(userId: string, filialId: string | null | undefined): Promise<boolean> {
  if (!filialId) return false;
  const eb = await ebFilialId();
  if (!eb || eb !== filialId) return false;
  return ehAdmin(userId);
}

/** Casas do usuário + a E.B. no fim (só pro Admin). Só pras telas de contas. */
export async function filiaisDoFinanceiro(userId: string): Promise<FilialAcessivel[]> {
  const filiais = await filiaisDoUsuario(userId);
  const eb = await ebFilialId();
  if (!eb || filiais.some((f) => f.id === eb)) return filiais;
  if (!(await ehAdmin(userId))) return filiais;
  const dados = await filialDoCnpj(EB_CNPJ);
  return [
    ...filiais,
    {
      id: eb,
      nome: dados?.nome ?? 'E.B. Serviços',
      cnpj: EB_CNPJ,
      organizacaoNome: 'E.B. Serviços',
      role: 'DONO',
      ultimoPing: null,
      agenteToken: '',
      dataInicioConciliacao: null,
    },
  ];
}
