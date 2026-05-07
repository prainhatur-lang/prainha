// Cadastro/manutencao das pessoas que recebem folha por filial.
// Reutiliza fornecedor (categoria salarios) — esta tela e um satelite
// pra adicionar info especifica de folha (papel, taxas, vinculo cliente).

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { PessoasManager } from './manager';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
}

export default async function FolhaPessoasPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialSelecionada =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ??
    filiais[0] ??
    null;

  if (!filialSelecionada) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-3xl px-6 py-10 text-sm text-slate-500">
          Nenhuma filial disponível.
        </p>
      </main>
    );
  }

  // Pessoas ja vinculadas a folha (com info do fornecedor + cliente)
  const pessoasFolha = await db
    .select({
      fornecedorId: schema.fornecedorFolha.fornecedorId,
      papel: schema.fornecedorFolha.papel,
      gerenteModelo: schema.fornecedorFolha.gerenteModelo,
      gerenteValorFixoDia: schema.fornecedorFolha.gerenteValorFixoDia,
      diaristaTaxaHoraOverride: schema.fornecedorFolha.diaristaTaxaHoraOverride,
      ativo: schema.fornecedorFolha.ativo,
      clienteId: schema.fornecedorFolha.clienteId,
      fornecedorNome: schema.fornecedor.nome,
      fornecedorCpf: schema.fornecedor.cnpjOuCpf,
      clienteNome: schema.cliente.nome,
      clienteCpf: schema.cliente.cpfOuCnpj,
    })
    .from(schema.fornecedorFolha)
    .innerJoin(
      schema.fornecedor,
      eq(schema.fornecedor.id, schema.fornecedorFolha.fornecedorId),
    )
    .leftJoin(schema.cliente, eq(schema.cliente.id, schema.fornecedorFolha.clienteId))
    .where(eq(schema.fornecedor.filialId, filialSelecionada.id))
    .orderBy(asc(schema.fornecedor.nome));

  // Fornecedores candidatos: TODOS os ativos da filial, exceto os ja
  // cadastrados. Marca quais tem CPF e historico de folha pra ajudar
  // o user a identificar quem realmente recebe folha vs outros tipos
  // (locador, fornecedor de produto, etc). Filtro visual fica na UI.
  //
  // Query em 2 etapas (rapido) em vez de subquery correlacionada (timeout
  // em filiais com 2k fornecedores):
  //  1. Lista todos os fornecedores ativos da filial
  //  2. Lista IDs dos que tem historico de folha (DISTINCT)
  //  3. Combina via Set lookup em JS
  const jaCadastradosIds = new Set(pessoasFolha.map((p) => p.fornecedorId));
  const [fornecedoresAtivos, idsComHistoricoFolha] = await Promise.all([
    db
      .select({
        id: schema.fornecedor.id,
        nome: schema.fornecedor.nome,
        cpf: schema.fornecedor.cnpjOuCpf,
      })
      .from(schema.fornecedor)
      .where(
        and(
          eq(schema.fornecedor.filialId, filialSelecionada.id),
          sql`${schema.fornecedor.dataDelete} IS NULL`,
        ),
      )
      .orderBy(asc(schema.fornecedor.nome)),
    db
      .selectDistinct({ fornecedorId: schema.contaPagar.fornecedorId })
      .from(schema.contaPagar)
      .innerJoin(
        schema.categoriaConta,
        eq(schema.categoriaConta.id, schema.contaPagar.categoriaId),
      )
      .where(
        and(
          eq(schema.contaPagar.filialId, filialSelecionada.id),
          sql`(${schema.categoriaConta.descricao} ILIKE '%comiss%'
            OR ${schema.categoriaConta.descricao} ILIKE '%diaria%'
            OR ${schema.categoriaConta.descricao} ILIKE '%diári%'
            OR ${schema.categoriaConta.descricao} ILIKE '%salar%'
            OR ${schema.categoriaConta.descricao} ILIKE '%gratif%')`,
        ),
      ),
  ]);
  const setHistorico = new Set(
    idsComHistoricoFolha.map((r) => r.fornecedorId).filter((x): x is string => !!x),
  );
  const candidatosRaw = fornecedoresAtivos.map((f) => ({
    ...f,
    temHistoricoFolha: setHistorico.has(f.id),
  }));

  const candidatosFiltered = candidatosRaw.filter((c) => !jaCadastradosIds.has(c.id));

  // Pra cada candidato, busca o cliente correspondente por CPF (auto-vinculo)
  const cpfsCandidatos = candidatosFiltered.map((c) => c.cpf!).filter(Boolean);
  const clientesPorCpf =
    cpfsCandidatos.length > 0
      ? await db
          .select({
            id: schema.cliente.id,
            cpf: schema.cliente.cpfOuCnpj,
            nome: schema.cliente.nome,
          })
          .from(schema.cliente)
          .where(
            and(
              eq(schema.cliente.filialId, filialSelecionada.id),
              inArray(schema.cliente.cpfOuCnpj, cpfsCandidatos),
            ),
          )
      : [];
  const clienteByCpf = new Map(clientesPorCpf.map((c) => [c.cpf, c]));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Pessoas da folha</h1>
            <p className="mt-1 text-sm text-slate-600">
              Quem recebe folha (fornecedores com CPF) e configurações por pessoa.
            </p>
          </div>
        </div>

        {filiais.length > 1 && (
          <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
            <label className="text-xs font-medium text-slate-500">Filial</label>
            <div className="mt-1 flex flex-wrap gap-2">
              {filiais.map((f) => {
                const active = f.id === filialSelecionada.id;
                return (
                  <a
                    key={f.id}
                    href={`?filialId=${f.id}`}
                    className={`rounded-md border px-3 py-1.5 text-sm ${
                      active
                        ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {f.nome}
                  </a>
                );
              })}
            </div>
          </div>
        )}

        <PessoasManager
          filialId={filialSelecionada.id}
          pessoas={pessoasFolha.map((p) => ({
            fornecedorId: p.fornecedorId,
            papel: p.papel,
            gerenteModelo: p.gerenteModelo,
            gerenteValorFixoDia: p.gerenteValorFixoDia ? Number(p.gerenteValorFixoDia) : null,
            diaristaTaxaHoraOverride: p.diaristaTaxaHoraOverride ? Number(p.diaristaTaxaHoraOverride) : null,
            ativo: p.ativo,
            clienteId: p.clienteId,
            fornecedorNome: p.fornecedorNome ?? '(sem nome)',
            fornecedorCpf: p.fornecedorCpf ?? '',
            clienteNome: p.clienteNome,
            clienteCpf: p.clienteCpf,
          }))}
          candidatos={candidatosFiltered.map((c) => {
            const cli = c.cpf ? clienteByCpf.get(c.cpf) : null;
            return {
              fornecedorId: c.id,
              fornecedorNome: c.nome ?? '',
              fornecedorCpf: c.cpf ?? '',
              clienteIdSugerido: cli?.id ?? null,
              clienteNomeSugerido: cli?.nome ?? null,
              temHistoricoFolha: !!c.temHistoricoFolha,
            };
          })}
        />
      </section>
    </main>
  );
}
