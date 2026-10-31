import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { processarPermutas } from '@/lib/permuta';
import { Permutas, type CasaOpcao, type ContratoLinha } from './permutas';

export const dynamic = 'force-dynamic';

/**
 * Permutas / parcerias comerciais (31/10/2026): o parceiro entrega algo e
 * ganha crédito pra consumir nas casas. O dono sobe o contrato, divide o
 * valor entre as casas e o sistema cadastra o parceiro e lança o crédito na
 * conta corrente (fiado) dele em cada casa. Regra em lib/permuta.ts.
 */
export default async function PermutasPage(props: { searchParams: Promise<{ filialId?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'conta_receber.read');
  const podeCriar = await podeUsuario(user.id, 'conta_receber.create');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const x = await escolherFilial(filiais, sp.filialId);
  if (!x) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-7xl px-6 py-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
      </main>
    );
  }
  const ativa = x;

  // Casas da mesma empresa, sem ambiente de teste.
  const casas: CasaOpcao[] = filiais
    .filter((f) => f.organizacaoNome === ativa.organizacaoNome && !/teste/i.test(f.nome))
    .map((f) => ({ id: f.id, nome: f.nome }));
  const idsCasas = filiais.map((f) => f.id);

  // Conclui o que estiver esperando a loja (o cron também faz, de 5 em 5 min).
  await processarPermutas().catch(() => {});

  const credTodos = await db
    .select({
      id: schema.permutaCredito.id,
      contratoId: schema.permutaCredito.contratoId,
      filialId: schema.permutaCredito.filialId,
      valor: schema.permutaCredito.valor,
      status: schema.permutaCredito.status,
      codigo: schema.permutaCredito.clienteCodigoExterno,
      erro: schema.permutaCredito.erro,
      lancadoEm: schema.permutaCredito.lancadoEm,
      fiadoStatus: schema.fiadoLancamento.status,
      fiadoErro: schema.fiadoLancamento.erro,
      fiadoAplicadoEm: schema.fiadoLancamento.aplicadoEm,
    })
    .from(schema.permutaCredito)
    .leftJoin(schema.fiadoLancamento, eq(schema.fiadoLancamento.id, schema.permutaCredito.fiadoLancamentoId))
    .where(inArray(schema.permutaCredito.filialId, idsCasas));

  const contratoIds = [...new Set(credTodos.map((c) => c.contratoId))];
  const contratos = contratoIds.length
    ? await db
        .select()
        .from(schema.permutaContrato)
        .where(inArray(schema.permutaContrato.id, contratoIds))
        .orderBy(desc(schema.permutaContrato.criadoEm))
    : [];

  // Saldo atual da conta corrente do parceiro em cada casa (negativo = crédito).
  const comCodigo = credTodos.filter((c) => c.codigo != null);
  const saldos = comCodigo.length
    ? await db
        .select({
          filialId: schema.cliente.filialId,
          codigo: schema.cliente.codigoExterno,
          saldo: schema.cliente.saldoAtualContaCorrente,
          limite: schema.cliente.limiteCreditoContaCorrente,
        })
        .from(schema.cliente)
        .where(
          and(
            inArray(schema.cliente.filialId, [...new Set(comCodigo.map((c) => c.filialId))]),
            inArray(schema.cliente.codigoExterno, [...new Set(comCodigo.map((c) => c.codigo!))]),
            sql`${schema.cliente.dataDelete} IS NULL`,
          ),
        )
    : [];
  const saldoDe = (filialId: string, codigo: number | null) =>
    saldos.find((s) => s.filialId === filialId && s.codigo === codigo);

  const nomeCasa = new Map(filiais.map((f) => [f.id, f.nome]));
  const linhas: ContratoLinha[] = contratos.map((k) => ({
    id: k.id,
    parceiroNome: k.parceiroNome,
    documento: k.documento,
    contato: k.contato,
    telefone: k.telefone,
    email: k.email,
    valorTotal: Number(k.valorTotal),
    contrapartida: k.contrapartida,
    dataInicio: k.dataInicio,
    dataFim: k.dataFim,
    observacao: k.observacao,
    arquivoNome: k.arquivoNome,
    temArquivo: !!k.arquivoPath,
    criadoPor: k.criadoPor,
    criadoEm: k.criadoEm.toISOString(),
    cancelado: k.canceladoEm ? { em: k.canceladoEm.toISOString(), motivo: k.canceladoMotivo } : null,
    creditos: credTodos
      .filter((c) => c.contratoId === k.id)
      .map((c) => {
        const s = saldoDe(c.filialId, c.codigo);
        return {
          id: c.id,
          casa: nomeCasa.get(c.filialId) ?? '—',
          valor: Number(c.valor),
          status: c.status,
          codigo: c.codigo,
          erro: c.erro,
          fiadoStatus: c.fiadoStatus,
          fiadoErro: c.fiadoErro,
          saldo: s?.saldo != null ? Number(s.saldo) : null,
          fiadoDesligado: s ? !(Number(s.limite ?? 0) > 0) : false,
        };
      }),
  }));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <h1 className="text-xl font-semibold text-slate-900">Permutas e parcerias</h1>
        <p className="mt-1 text-sm text-slate-500">
          O parceiro entrega um serviço ou produto e ganha crédito pra consumir nas casas. Suba o contrato,
          divida o valor entre as casas e o sistema cadastra o parceiro e lança o crédito na conta corrente (fiado)
          dele em cada casa. O que ele consumir vai abatendo do crédito.
        </p>
        <Permutas casas={casas} contratos={linhas} podeCriar={podeCriar} />
      </div>
    </main>
  );
}
