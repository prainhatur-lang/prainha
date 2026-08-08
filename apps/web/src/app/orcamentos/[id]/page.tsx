// Documento do orçamento de evento — pronto pra imprimir / salvar em PDF.

import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { numeroOrcamento, type StatusOrcamento } from '@/lib/orcamentos';
import { DocOrcamento } from '../doc-orcamento';
import { DocActions } from './doc-actions';
import { LinkAceiteBox } from './link-aceite-box';

export const dynamic = 'force-dynamic';

export default async function OrcamentoDocPage(props: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'orcamento.read');
  const podeEditar = await podeUsuario(user.id, 'orcamento.update');
  const podeDeletar = await podeUsuario(user.id, 'orcamento.delete');

  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [o] = await db
    .select()
    .from(schema.orcamentoEvento)
    .where(eq(schema.orcamentoEvento.id, id))
    .limit(1);
  if (!o) notFound();

  const filiais = await filiaisDoUsuario(user.id);
  const filial = filiais.find((f) => f.id === o.filialId);
  if (!filial) redirect('/orcamentos');

  // Origin real do request (localhost em dev, app.prainhabar.com em prod).
  const h = await headers();
  const host = h.get('host') ?? 'app.prainhabar.com';
  const proto = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https';
  const linkAceite = o.aceiteToken ? `${proto}://${host}/orcamento/${o.aceiteToken}` : null;

  return (
    <main className="min-h-screen bg-slate-100 print:bg-white">
      <DocActions
        id={o.id}
        status={(o.status as StatusOrcamento) ?? 'aberto'}
        podeEditar={podeEditar}
        podeDeletar={podeDeletar}
      />

      {linkAceite && (
        <LinkAceiteBox
          url={linkAceite}
          clienteTelefone={o.clienteTelefone}
          filialNome={filial.nome}
          numero={numeroOrcamento(o.numero)}
          entradaValor={o.entradaValor == null ? null : Number(o.entradaValor)}
          aceiteNome={o.aceiteNome}
          aceiteEm={o.aceiteEm ? o.aceiteEm.toISOString() : null}
          pagamentoStatus={o.pagamentoStatus}
          pagoEm={o.pagoEm ? o.pagoEm.toISOString() : null}
        />
      )}

      <DocOrcamento
        o={o}
        filialNome={filial.nome}
        filialCnpj={filial.cnpj}
        linkAceite={linkAceite}
      />
    </main>
  );
}
