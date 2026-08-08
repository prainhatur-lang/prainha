// Editar um orçamento de evento existente.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { numeroOrcamento } from '@/lib/orcamentos';
import { FormOrcamento, type OrcamentoInicial } from '../../form-orcamento';

export const dynamic = 'force-dynamic';

/** numeric do banco ("120.00") → string BR pro input ("120,00"). */
const brStr = (v: string | null) => (v == null ? '' : Number(v).toFixed(2).replace('.', ','));

export default async function EditarOrcamentoPage(props: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'orcamento.update');

  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [o] = await db
    .select()
    .from(schema.orcamentoEvento)
    .where(eq(schema.orcamentoEvento.id, id))
    .limit(1);
  if (!o) notFound();

  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === o.filialId)) redirect('/orcamentos');

  const inicial: OrcamentoInicial = {
    id: o.id,
    filialId: o.filialId,
    clienteNome: o.clienteNome,
    clienteTelefone: o.clienteTelefone ?? '',
    dataEvento: o.dataEvento,
    hora: o.hora ?? '',
    pessoas: o.pessoas,
    valorPessoa: brStr(o.valorPessoa),
    pratos: o.pratos ?? [],
    sobremesaIncluida: o.sobremesaIncluida,
    sobremesaDescricao: o.sobremesaDescricao ?? '',
    taxaEspaco: brStr(o.taxaEspaco),
    taxaExclusividade: brStr(o.taxaExclusividade),
    observacoes: o.observacoes ?? '',
    condicoes: o.condicoes ?? '',
    validoAte: o.validoAte ?? '',
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-5">
          <Link href={`/orcamentos/${o.id}`} className="text-sm text-blue-600 hover:underline">
            ← Voltar ao orçamento
          </Link>
          <h1 className="mt-1 text-xl font-bold text-slate-900">
            Editar orçamento Nº {numeroOrcamento(o.numero)}
          </h1>
        </div>
        <FormOrcamento
          filiais={filiais.map((f) => ({ id: f.id, nome: f.nome }))}
          inicial={inicial}
        />
      </section>
    </main>
  );
}
