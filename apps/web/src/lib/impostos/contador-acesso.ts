// Quem responde pelo link do contador: o usuário que gerou o link, enquanto
// ele tiver 'conta_pagar.create'. Casas = as dele, sem a de teste.

import { podeUsuario } from '@/lib/permissoes-runtime';
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
