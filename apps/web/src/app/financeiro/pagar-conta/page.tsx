// /financeiro/pagar-conta — paga pelo sistema (Inter) a conta de consumo
// (energia, água, gás, telefone…) ou boleto que não chega pelo DDA: manda a
// foto/PDF da conta (lê o QR Pix ou o código de barras) ou cola/digita o
// código. Pedido do dono 23/11/2026. Só o Admin paga; os outros veem a lista.
// Rotas: /api/financeiro/conta-consumo/{pagar,conferir,resolver}.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { and, asc, desc, eq, gte, isNull, lte } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoFinanceiro } from '@/lib/eb/acesso-financeiro';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { podePagarPix } from '@/lib/pix-pagamento';
import { resolverCredenciaisInterPagamentos } from '@/lib/inter';
import { diasAtrasBr, hojeBr } from '@/lib/datas';
import { PagarContaCliente, type ContaAberta, type PagamentoLinha } from './pagar-conta-cliente';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  /** conta recém-lançada como QR / copia-e-cola: já chega escolhida */
  contaId?: string;
}

export default async function PagarContaPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'conta_pagar.read');
  const sp = await props.searchParams;
  const filiais = await filiaisDoFinanceiro(user.id);
  const escolhidaX = await escolherFilial(filiais, sp.filialId);
  if (!escolhidaX) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <section className="mx-auto max-w-4xl px-4 py-10">
          <p className="text-sm text-slate-500">Nenhuma filial disponível.</p>
        </section>
      </main>
    );
  }
  const filial = escolhidaX;
  const podePagar = await podePagarPix(user.id).catch(() => false);
  const temInter = !!resolverCredenciaisInterPagamentos(filial.id);

  // contas a pagar em aberto perto da data (120 dias pra trás até 60 pra frente)
  const ini = diasAtrasBr(120);
  const fim = diasAtrasBr(-60);
  const [contas, pagamentos] = await Promise.all([
    db
      .select({
        id: schema.contaPagar.id,
        descricao: schema.contaPagar.descricao,
        valor: schema.contaPagar.valor,
        dataVencimento: schema.contaPagar.dataVencimento,
        observacao: schema.contaPagar.observacao,
        fornecedor: schema.fornecedor.nome,
      })
      .from(schema.contaPagar)
      .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.contaPagar.fornecedorId))
      .where(
        and(
          eq(schema.contaPagar.filialId, filial.id),
          isNull(schema.contaPagar.dataPagamento),
          isNull(schema.contaPagar.dataDelete),
          gte(schema.contaPagar.dataVencimento, ini),
          lte(schema.contaPagar.dataVencimento, fim),
        ),
      )
      .orderBy(asc(schema.contaPagar.dataVencimento))
      .limit(400),
    db
      .select()
      .from(schema.contaConsumoPagamento)
      .where(eq(schema.contaConsumoPagamento.filialId, filial.id))
      .orderBy(desc(schema.contaConsumoPagamento.criadoEm))
      .limit(50)
      .catch(() => []),
  ]);
  // conta com pagamento saindo ou pago por esta tela não volta pro "Pagar esta"
  // (DAE da Lelis 23/11/2026: aprovado no Inter e ainda aparecia pra pagar)
  const emAndamento = new Set(
    pagamentos
      .filter((p) => p.contaPagarId && ['ENVIANDO', 'APROVACAO', 'AGENDADO', 'PAGO'].includes(p.status))
      .map((p) => p.contaPagarId as string),
  );
  const contasAbertas: ContaAberta[] = contas.map((c) => ({
      id: c.id,
      rotulo: `${c.dataVencimento.split('-').reverse().join('/')} · ${c.fornecedor ?? c.descricao ?? 'conta'}${c.fornecedor && c.descricao ? ` — ${c.descricao}` : ''}`.slice(0, 120),
      valor: Number(c.valor),
      vencimento: c.dataVencimento,
      // guia do contador / boleto lançado já traz o código na observação;
      // repasse entre casas não paga a guia (quem paga é a pagadora)
      codigo: (c.descricao ?? '').startsWith('Repasse ') || emAndamento.has(c.id)
        ? null
        : (c.observacao?.match(/C[óo]digo de barras:\s*(\d{44,48})/)?.[1] ??
          // conta lançada como QR / copia-e-cola (26/11/2026, recarga da Meta);
          // o código tem espaço (nome do favorecido): vai até o fim da linha
          c.observacao?.match(/Pix copia-e-cola:\s*(000201[^\n\r]+)/)?.[1] ??
          null),
    }));
  const linhas: PagamentoLinha[] = pagamentos.map((p) => ({
    id: p.id,
    tipo: p.tipo as 'BOLETO' | 'PIX',
    favorecido: p.favorecido,
    descricao: p.descricao,
    valor: Number(p.valor),
    dataPagamento: p.dataPagamento,
    status: p.status,
    statusInter: p.statusInter,
    erro: p.erro,
    usuarioEmail: p.usuarioEmail,
    criadoEm: p.criadoEm ? p.criadoEm.toISOString() : null,
    baixado: !!p.baixadoEm,
    contaPagarId: p.contaPagarId,
  }));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-4xl px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-slate-900">Pagar conta (código ou QR)</h1>
          <span className="text-sm text-slate-500">— {filial.nome}</span>
          <Link
            href={`/financeiro?filialId=${filial.id}`}
            className="ml-auto rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            ← Financeiro
          </Link>
        </div>
        {filiais.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-1">
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/financeiro/pagar-conta?filialId=${f.id}`}
                className={`rounded-full px-3 py-1 text-xs ${f.id === filial.id ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700'}`}
              >
                {f.nome}
              </Link>
            ))}
          </div>
        )}
        <p className="mb-4 text-sm text-slate-600">
          Pra conta de energia, água, gás, telefone ou boleto que não aparece no DDA. Mande a foto ou o PDF da conta (o
          sistema lê o QR do Pix ou o código de barras), ou cole a linha digitável. O pagamento sai pela conta do Inter
          desta casa.
        </p>
        <PagarContaCliente
          filialId={filial.id}
          podePagar={podePagar}
          temInter={temInter}
          hoje={hojeBr()}
          contas={contasAbertas}
          contaInicial={contasAbertas.find((c) => c.id === sp.contaId && c.codigo)?.id ?? null}
          pagamentos={linhas}
        />
      </section>
    </main>
  );
}
