// Cadastro único de funcionário — substitui os três cadastros desconexos
// (fornecedor_folha, colaborador, talento) por um só ponto de entrada.
// A configuração de remuneração da folha continua em /folha-equipe/pessoas.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { asc, eq, inArray } from 'drizzle-orm';
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

  const funcionarios = await db
    .select()
    .from(schema.funcionario)
    .where(eq(schema.funcionario.filialId, filialSelecionada.id))
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

  // Dados de PAGAMENTO (folha) — unificados aqui pro cadastro ser um só
  const fornIds = funcionarios.map((f) => f.fornecedorId).filter((x): x is string => !!x);
  const pagamentosRows = fornIds.length
    ? await db
        .select({
          fornecedorId: schema.fornecedorFolha.fornecedorId,
          papel: schema.fornecedorFolha.papel,
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
        })
        .from(schema.fornecedorFolha)
        .innerJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.fornecedorFolha.fornecedorId))
        .where(inArray(schema.fornecedorFolha.fornecedorId, fornIds))
    : [];
  const pagamentoPorFornecedor = new Map(pagamentosRows.map((r) => [r.fornecedorId, r]));

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
              folha, diária, bônus e PIX ficam dentro do cadastro de cada pessoa).
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
          filialId={filialSelecionada.id}
          funcionarios={funcionarios.map((f) => ({
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
            temFornecedor: !!f.fornecedorId,
            pagamento: f.fornecedorId ? pagamentoPorFornecedor.get(f.fornecedorId) ?? null : null,
            temColaborador: !!f.colaboradorId,
            temUsuarioOperacao: !!f.usuarioOperacaoId,
            filiaisExtras: extrasPorFuncionario.get(f.id) ?? [],
          }))}
          cargos={[...FUNCOES_TALENTO]}
          outrasFiliais={filiais.filter((f) => f.id !== filialSelecionada.id).map((f) => ({ id: f.id, nome: f.nome }))}
        />
      </section>
    </main>
  );
}
