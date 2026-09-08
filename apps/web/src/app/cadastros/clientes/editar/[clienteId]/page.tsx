// Edição do cadastro do cliente (linha do Consumer). Salva na nuvem e manda a
// alteração pra loja — ver /api/clientes/[id].

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { eq, inArray, and, desc, sql, isNull, ne } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { ClienteForm, type ValoresCliente } from '../../cliente-form';

export const dynamic = 'force-dynamic';

function txt(v: string | null | undefined): string {
  return v ?? '';
}

export default async function EditarClientePage(props: {
  params: Promise<{ clienteId: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'cliente.update');

  const { clienteId } = await props.params;
  const filiais = await filiaisDoUsuario(user.id);

  const [cliente] = await db
    .select()
    .from(schema.cliente)
    .where(eq(schema.cliente.id, clienteId))
    .limit(1);

  // Só edita cliente de filial que o usuário acessa.
  const filial = cliente ? filiais.find((f) => f.id === cliente.filialId) : undefined;
  if (!cliente || !filial) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-3xl px-6 py-10 text-sm text-slate-500">
          Cliente não encontrado nesta conta.
        </p>
      </main>
    );
  }

  const podeFiado = await podeUsuario(user.id, 'conta_receber.update');

  // Cadastro único: essa pessoa já tem papel de fornecedor (vendedor)?
  const docCliente = (cliente.cpfOuCnpj ?? '').replace(/\D/g, '');
  const jaFornecedor = docCliente
    ? (
        await db
          .select({ id: schema.fornecedor.id })
          .from(schema.fornecedor)
          .where(
            and(
              eq(schema.fornecedor.filialId, cliente.filialId),
              sql`regexp_replace(coalesce(${schema.fornecedor.cnpjOuCpf}, ''), '[^0-9]', '', 'g') = ${docCliente}`,
            ),
          )
          .limit(1)
      ).length > 0
    : false;

  // DE ONDE é o cliente + quem mais é a mesma pessoa (mesmo CPF; senão, mesmo
  // telefone): nas outras casas (o espelho manda a edição pra elas) e as
  // duplicatas na própria loja. Em 07/09/2026 o dono deu limite no cadastro da
  // Tabuará achando que era o da Prainha Bar, onde havia 5 com o mesmo CPF.
  const foneCliente = (cliente.celular ?? cliente.telefone ?? '').replace(/\D/g, '');
  const nomeFilial = new Map(filiais.map((f) => [f.id, f.nome]));
  const parecidos =
    docCliente || foneCliente
      ? await db
          .select({
            id: schema.cliente.id,
            filialId: schema.cliente.filialId,
            codigo: schema.cliente.codigoExterno,
            saldo: schema.cliente.saldoAtualContaCorrente,
          })
          .from(schema.cliente)
          .where(
            and(
              inArray(schema.cliente.filialId, filiais.map((f) => f.id)),
              isNull(schema.cliente.dataDelete),
              ne(schema.cliente.id, cliente.id),
              docCliente
                ? sql`regexp_replace(coalesce(${schema.cliente.cpfOuCnpj}, ''), '[^0-9]', '', 'g') = ${docCliente}`
                : sql`regexp_replace(coalesce(${schema.cliente.celular}, ${schema.cliente.telefone}, ''), '[^0-9]', '', 'g') = ${foneCliente}`,
            ),
          )
          .orderBy(schema.cliente.filialId, schema.cliente.codigoExterno)
      : [];
  const fmtSaldo = (v: string | null) =>
    v != null && Number(v) !== 0
      ? `, fiado ${Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`
      : '';
  const irmaos = parecidos
    .filter((p) => p.filialId !== cliente.filialId)
    .map((p) => ({ ...p, loja: nomeFilial.get(p.filialId) ?? '?' }));
  const duplicados = parecidos.filter((p) => p.filialId === cliente.filialId);

  // Últimas alterações mandadas pra loja — mostra se alguma travou e, o mais
  // traiçoeiro, se a loja aplicou só PARTE dos campos: o agente < v1.4.0 só
  // conhece nome e CPF, descarta o resto e responde "sucesso" do mesmo jeito.
  const comandos = await db
    .select({
      id: schema.agenteComando.id,
      status: schema.agenteComando.status,
      payload: schema.agenteComando.payload,
      resultado: schema.agenteComando.resultado,
      criadoEm: schema.agenteComando.criadoEm,
    })
    .from(schema.agenteComando)
    .where(
      and(
        eq(schema.agenteComando.filialId, cliente.filialId),
        inArray(schema.agenteComando.tipo, ['atualizar_cliente', 'criar_cliente']),
      ),
    )
    .orderBy(desc(schema.agenteComando.criadoEm))
    .limit(10);

  const pendentes = comandos.filter((c) =>
    ['pendente', 'executando', 'erro'].includes(c.status),
  );

  const ultimoOk = comandos.find(
    (c) =>
      c.status === 'sucesso' &&
      (c.payload as { codigoExterno?: number } | null)?.codigoExterno === cliente.codigoExterno,
  );
  const enviados = Object.keys(
    (ultimoOk?.payload as { campos?: Record<string, unknown> } | null)?.campos ?? {},
  ).length;
  const aplicados = Object.keys(
    (ultimoOk?.resultado as { campos?: Record<string, unknown> } | null)?.campos ?? {},
  ).length;
  const parcial = !!ultimoOk && enviados > 0 && aplicados > 0 && aplicados < enviados;

  const iniciais: ValoresCliente = {
    nome: txt(cliente.nome),
    cpfOuCnpj: txt(cliente.cpfOuCnpj),
    email: txt(cliente.email),
    telefone: txt(cliente.telefone),
    celular: txt(cliente.celular),
    dataNascimento: txt(cliente.dataNascimento),
    endereco: txt(cliente.endereco),
    numero: txt(cliente.numero),
    complemento: txt(cliente.complemento),
    bairro: txt(cliente.bairro),
    cidade: txt(cliente.cidade),
    uf: txt(cliente.uf),
    cep: txt(cliente.cep),
    observacao: txt(cliente.observacao),
    limiteCreditoContaCorrente:
      cliente.limiteCreditoContaCorrente != null
        ? String(Number(cliente.limiteCreditoContaCorrente).toFixed(2)).replace('.', ',')
        : '',
    bloquearVendaAposLimite: cliente.bloquearVendaAposLimite ?? false,
    arquivarFiado: cliente.arquivarFiado ?? false,
  };

  const saldo =
    cliente.saldoAtualContaCorrente != null ? Number(cliente.saldoAtualContaCorrente) : null;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-4xl px-6 py-8">
        <Link href="/cadastros/clientes" className="text-sm text-slate-500 hover:text-slate-700">
          ← Voltar para Clientes
        </Link>
        <h1 className="mt-3 text-2xl font-bold text-slate-900">{cliente.nome ?? 'Cliente'}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 font-semibold text-amber-800">
            Cadastro da {filial.nome}
          </span>
          <span className="text-slate-600">código {cliente.codigoExterno} no PDV</span>
        </div>
        <p className="mb-6 mt-1 text-xs text-slate-600">
          {irmaos.length > 0 ? (
            <>
              Mesma pessoa em:{' '}
              {irmaos.map((k, i) => (
                <span key={k.id}>
                  {i > 0 && ' · '}
                  <Link href={`/cadastros/clientes/editar/${k.id}`} className="text-sky-700 hover:underline">
                    {k.loja} (cód. {k.codigo}{fmtSaldo(k.saldo)})
                  </Link>
                </span>
              ))}
              . Limite e fiado são por loja; salvar aqui espelha a alteração lá.
            </>
          ) : (
            <>Só tem cadastro nesta loja; ao salvar, as outras casas recebem um cadastro novo.</>
          )}
          {duplicados.length > 0 && (
            <>
              {' '}
              <span className="text-amber-800">
                Outros cadastros nesta loja com o mesmo {docCliente ? 'CPF' : 'telefone'}:
              </span>{' '}
              {duplicados.map((k, i) => (
                <span key={k.id}>
                  {i > 0 && ' · '}
                  <Link href={`/cadastros/clientes/editar/${k.id}`} className="text-sky-700 hover:underline">
                    cód. {k.codigo}{fmtSaldo(k.saldo)}
                  </Link>
                </span>
              ))}
              .
            </>
          )}
        </p>

        {parcial && (
          <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            A loja aplicou <b>{aplicados} de {enviados}</b> campos da última alteração — o agente
            dela está desatualizado e ignora os campos novos (limite de fiado, endereço, e-mail).
            Atualize o agente pra v1.4.0 e salve de novo.
          </p>
        )}

        {pendentes.some((p) => p.status === 'erro') && (
          <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            Alguma alteração recente não foi aplicada na loja. Salvar de novo reenvia.
          </p>
        )}

        <ClienteForm
          filialId={cliente.filialId}
          filialNome={filial.nome}
          clienteId={cliente.id}
          iniciais={iniciais}
          podeFiado={podeFiado}
          jaFornecedor={jaFornecedor}
          saldo={saldo}
          voltarHref="/cadastros/clientes"
        />
      </section>
    </main>
  );
}
