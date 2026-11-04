// Documento do RH em HTML (TRCT gerado pelo sistema, 04/11/2026). O bucket
// não serve HTML como página, então a rota baixa e devolve aqui, travado:
// sem script, sem rede (só estilo embutido), em sandbox.

import { createAdminClient } from '@/lib/supabase/server';
import { BUCKET_DOC_RH, extensaoDoc } from '@/lib/rh/documento-vinculo';

export const ehDocHtml = (nomeOuPath: string | null | undefined) => {
  const e = extensaoDoc(nomeOuPath ?? '');
  return e === 'html' || e === 'htm';
};

export async function responderDocHtml(path: string): Promise<Response> {
  const admin = await createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET_DOC_RH).download(path);
  if (error || !data) return new Response('Não consegui abrir o documento.', { status: 500 });
  const buf = Buffer.from(await data.arrayBuffer());
  return new Response(buf, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; sandbox",
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    },
  });
}
