// Cadastro único de funcionário — substitui os três cadastros desconexos
// (fornecedor_folha, colaborador, talento) por um só ponto de entrada.
//
// A remuneração da folha semanal também mora aqui (a antiga /folha-equipe/pessoas
// redireciona pra cá). O ACORDO É POR LOJA: a lista mostra quem tem lotação
// principal na filial escolhida E quem circula até ela (funcionario_filial_extra),
// e o bloco de pagamento edita o fornecedor_folha DESSA filial.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, asc, eq, exists, inArray, isNull, or, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { FUNCOES_TALENTO } from '@concilia/db/schema';
import { FuncionariosManager } from './manager';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
}

export default async function FuncionariosPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'funcionario.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialSelecionada = await escolherFilial(filiais, sp.filialId);

  if (!filialSelecionada) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-3xl px-6 py-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
      </main>
    );
  }

  const filialId = filialSelecionada.id;

  // Lotação principal AQUI ou vínculo extra pra cá (quem circula entre lojas).
  const funcionarios = await db
    .select()
    .from(schema.funcionario)
    .where(
      or(
        eq(schema.funcionario.filialId, filialId),
        exists(
          db
            .select({ n: schema.funcionarioFilialExtra.id })
            .from(schema.funcionarioFilialExtra)
            .where(
              and(
                eq(schema.funcionarioFilialExtra.funcionarioId, schema.funcionario.id),
                eq(schema.funcionarioFilialExtra.filialId, filialId),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(schema.funcionario.nome));

  const extras =
    funcionarios.length > 0
      ? await db
          .select({ funcionarioId: schema.funcionarioFilialExtra.funcionarioId, filialId: schema.funcionarioFilialExtra.filialId })
          .from(schema.funcionarioFilialExtra)
          .where(inArray(schema.funcionarioFilialExtra.funcionarioId, funcionarios.map((f) => f.id)))
      : [];
  const extrasPorFuncionario = new Map<string, string[]>();
  for (const e of extras) {
    const lista = extrasPorFuncionario.get(e.funcionarioId) ?? [];
    lista.push(e.filialId);
    extrasPorFuncionario.set(e.funcionarioId, lista);
  }

  // Fornecedor de cada pessoa NESTA filial: pelo FK quando a lotação é aqui,
  // senão pelo CPF (mesma regra do vínculo automático das filiais extras).
  const fornecedorNaFilial = new Map<string, string>();
  for (const f of funcionarios) {
    if (f.filialId === filialId && f.fornecedorId) fornecedorNaFilial.set(f.id, f.fornecedorId);
  }
  const cpfsExtras = funcionarios.filter((f) => f.filialId !== filialId && f.cpf).map((f) => f.cpf as string);
  if (cpfsExtras.length > 0) {
    const fornsPorCpf = await db
      .select({
        id: schema.fornecedor.id,
        cpf: sql<string>`regexp_replace(coalesce(${schema.fornecedor.cnpjOuCpf}, ''), '[^0-9]', '', 'g')`,
      })
      .from(schema.fornecedor)
      .where(
        and(
          eq(schema.fornecedor.filialId, filialId),
          isNull(schema.fornecedor.dataDelete),
          inArray(sql`regexp_replace(coalesce(${schema.fornecedor.cnpjOuCpf}, ''), '[^0-9]', '', 'g')`, cpfsExtras),
        ),
      );
    const porCpf = new Map(fornsPorCpf.map((r) => [r.cpf, r.id]));
    for (const f of funcionarios) {
      if (f.filialId !== filialId && f.cpf && porCpf.has(f.cpf)) fornecedorNaFilial.set(f.id, porCpf.get(f.cpf)!);
    }
  }

  // Dados de PAGAMENTO (folha) DESTA filial — unificados aqui pro cadastro ser um só
  const fornIds = [...new Set(fornecedorNaFilial.values())];
  const pagamentosRows = fornIds.length
    ? await db
        .select({
          fornecedorId: schema.fornecedorFolha.fornecedorId,
          clienteId: schema.fornecedorFolha.clienteId,
          clienteNome: schema.cliente.nome,
          papel: schema.fornecedorFolha.papel,
          ativo: schema.fornecedorFolha.ativo,
          gerenteModelo: schema.fornecedorFolha.gerenteModelo,
          gerenteValorFixoDia: schema.fornecedorFolha.gerenteValorFixoDia,
          diaristaModelo: schema.fornecedorFolha.diaristaModelo,
          diaristaTaxaHoraOverride: schema.fornecedorFolha.diaristaTaxaHoraOverride,
          diaristaValorFixoDia: schema.fornecedorFolha.diaristaValorFixoDia,
          bonusFixoSemanal: schema.fornecedorFolha.bonusFixoSemanal,
          bonusPorDia: schema.fornecedorFolha.bonusPorDia,
          chavePix: schema.fornecedor.chavePix,
          bancoNome: schema.fornecedor.bancoNome,
          bancoAgencia: schema.fornecedor.bancoAgencia,
          bancoConta: schema.fornecedor.bancoConta,
          codigoExterno: schema.fornecedor.codigoExterno,
        })
        .from(schema.fornecedorFolha)
        .innerJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.fornecedorFolha.fornecedorId))
        .leftJoin(schema.cliente, eq(schema.cliente.id, schema.fornecedorFolha.clienteId))
        .where(inArray(schema.fornecedorFolha.fornecedorId, fornIds))
    : [];
  const pagamentoPorFornecedor = new Map(pagamentosRows.map((r) => [r.fornecedorId, r]));

  // Resumo do acordo nas OUTRAS lojas (só leitura — pra ver de relance que a
  // pessoa é gerente fixo lá e diarista aqui, por exemplo).
  const cpfsTodos = funcionarios.filter((f) => f.cpf).map((f) => f.cpf as string);
  const acordosOutras = cpfsTodos.length
    ? await db
        .select({
          cpf: sql<string>`regexp_replace(coalesce(${schema.fornecedor.cnpjOuCpf}, ''), '[^0-9]', '', 'g')`,
          filialNome: schema.filial.nome,
          papel: schema.fornecedorFolha.papel,
          ativo: schema.fornecedorFolha.ativo,
        })
        .from(schema.fornecedorFolha)
        .innerJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.fornecedorFolha.fornecedorId))
        .innerJoin(schema.filial, eq(schema.filial.id, schema.fornecedor.filialId))
        .where(
          and(
            sql`${schema.fornecedor.filialId} <> ${filialId}`,
            inArray(schema.fornecedor.filialId, filiais.map((f) => f.id)),
            isNull(schema.fornecedor.dataDelete),
            eq(schema.fornecedorFolha.ativo, true),
            inArray(sql`regexp_replace(coalesce(${schema.fornecedor.cnpjOuCpf}, ''), '[^0-9]', '', 'g')`, cpfsTodos),
          ),
        )
    : [];
  const acordosPorCpf = new Map<string, { filialNome: string; papel: string }[]>();
  for (const a of acordosOutras) {
    const lista = acordosPorCpf.get(a.cpf) ?? [];
    lista.push({ filialNome: a.filialNome, papel: a.papel });
    acordosPorCpf.set(a.cpf, lista);
  }
  const nomeFilial = new Map(filiais.map((f) => [f.id, f.nome]));

  const ativos = funcionarios.filter((f) => f.ativo).length;
  const precisaRevisao = funcionarios.filter((f) => f.precisaRevisao).length;
  const semCpf = funcionarios.filter((f) => !f.cpf).length;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Funcionários</h1>
            <p className="mt-1 text-sm text-slate-600">
              Cadastro único — nome, contato, cargo, admissão e <b>pagamento</b> (papel na
              folha, diária, bônus e PIX). O acordo da folha é <b>por loja</b>: quem circula
              entre lojas aparece em cada uma, com o acordo daquela casa.
            </p>
          </div>
          <div className="flex gap-4 text-right text-xs text-slate-500">
            <span>
              <strong className="block text-lg text-slate-900">{ativos}</strong>ativos
            </span>
            {precisaRevisao > 0 && (
              <span>
                <strong className="block text-lg text-amber-600">{precisaRevisao}</strong>revisar
              </span>
            )}
            {semCpf > 0 && (
              <span>
                <strong className="block text-lg text-slate-900">{semCpf}</strong>sem CPF
              </span>
            )}
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

        <FuncionariosManager
          filialId={filialId}
          filialNome={filialSelecionada.nome}
          funcionarios={funcionarios.map((f) => {
            const fornId = fornecedorNaFilial.get(f.id) ?? null;
            const pg = fornId ? pagamentoPorFornecedor.get(fornId) ?? null : null;
            return {
              id: f.id,
              nome: f.nome,
              cpf: f.cpf,
              telefone: f.telefone,
              endereco: f.endereco,
              cargo: f.cargo,
              setor: f.setor,
              dataAdmissao: f.dataAdmissao,
              dataDesligamento: f.dataDesligamento,
              ativo: f.ativo,
              regimeSalarial: f.regimeSalarial,
              salarioBase: f.salarioBase,
              precisaRevisao: f.precisaRevisao,
              observacao: f.observacao,
              filialPrincipalId: f.filialId,
              filialPrincipalNome: nomeFilial.get(f.filialId) ?? 'outra loja',
              fornecedorId: fornId,
              temFornecedor: !!fornId,
              temCliente: !!pg?.clienteId,
              clienteNome: pg?.clienteNome ?? null,
              pagamento: pg
                ? {
                    papel: pg.papel,
                    ativo: pg.ativo,
                    gerenteModelo: pg.gerenteModelo,
                    gerenteValorFixoDia: pg.gerenteValorFixoDia,
                    diaristaModelo: pg.diaristaModelo,
                    diaristaTaxaHoraOverride: pg.diaristaTaxaHoraOverride,
                    diaristaValorFixoDia: pg.diaristaValorFixoDia,
                    bonusFixoSemanal: pg.bonusFixoSemanal,
                    bonusPorDia: pg.bonusPorDia,
                    chavePix: pg.chavePix,
                    bancoNome: pg.bancoNome,
                    bancoAgencia: pg.bancoAgencia,
                    bancoConta: pg.bancoConta,
                    noConsumer: pg.codigoExterno != null,
                  }
                : null,
              acordosOutrasLojas: f.cpf ? acordosPorCpf.get(f.cpf) ?? [] : [],
              temColaborador: !!f.colaboradorId,
              temUsuarioOperacao: !!f.usuarioOperacaoId,
              filiaisExtras: extrasPorFuncionario.get(f.id) ?? [],
            };
          })}
          cargos={[...FUNCOES_TALENTO]}
          filiais={filiais.map((f) => ({ id: f.id, nome: f.nome }))}
        />
      </section>
    </main>
  );
}
