// Quem responde pelo link do contador: o usuário que gerou o link, enquanto
// ele tiver 'conta_pagar.create'. Casas = as dele, sem a de teste.

import { podeUsuario } from '@/lib/permissoes-runtime';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { PERM_IMPOSTO_LANCAR } from '@/lib/impostos/guia';
import { validarTokenContador } from '@/lib/impostos/contador-link';

export async function acessoContador(token: unknown) {
  const usuarioId = validarTokenContador(token);
  if (!usuarioId) return null;
  if (!(await podeUsuario(usuarioId, PERM_IMPOSTO_LANCAR))) return null;
  const filiais = (await filiaisDoUsuario(usuarioId)).filter((f) => !/TESTE/i.test(f.nome));
  return { usuarioId, filiais };
}

/** Permissão de quem só ENVIA guias (contabilidade): não abre o Financeiro. */
export const PERM_IMPOSTO_ENVIAR = 'imposto.enviar';

/**
 * Sem link: a contabilidade logada com 'imposto.enviar' (dono 19/11/2026 — o
 * contador não tem o Financeiro pra pegar o link). Lança no nome dela, nas
 * casas dela, sem a de teste.
 */
export async function acessoContadorLogado() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  if (!(await podeUsuario(user.id, PERM_IMPOSTO_ENVIAR))) return null;
  const filiais = (await filiaisDoUsuario(user.id)).filter((f) => !/TESTE/i.test(f.nome));
  return { usuarioId: user.id, filiais };
}

/** Link assinado (como sempre) ou, sem link válido, o login com 'imposto.enviar'. */
export async function acessoContadorOuLogado(token: unknown) {
  return (await acessoContador(token)) ?? (await acessoContadorLogado());
}
