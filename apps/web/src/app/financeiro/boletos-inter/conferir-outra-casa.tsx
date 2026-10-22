// Conferência dos boletos pagos por este Inter com a conta lançada em OUTRA
// casa (pedido do dono 22/10/2026): antes de mandar pro encontro de contas,
// abrir lado a lado o que o banco pagou, a conta que o sistema casou, a nota
// fiscal (pra quem ela foi emitida) e o pedido de compra. Só leitura.
//
// O sinal mais forte é o destinatário da NF-e: se a nota foi emitida pro CNPJ
// desta casa, a conta foi lançada na casa errada (não é encontro de contas).

import Link from 'next/link';
import { db, schema } from '@concilia/db';
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { brl, formatDate } from '@/lib/format';
import { centavos, soDigitos, somaDias, type ContaJanela } from '@/lib/boletos-inter';
import type { InterPagamento } from '@/lib/inter';

export type LinhaOutraCasa = {
  p: InterPagamento;
  conta: ContaJanela;
  casaDaConta: string;
  encontro: { status: string; competencia: string } | null;
};

type Casa = { id: string; nome: string; cnpj: string };

const fmtCnpj = (v: string | null | undefined) => {
  const d = soDigitos(v);
  if (d.length !== 14) return d || '—';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};

export async function ConferirOutraCasa({
  linhas,
  casas,
  filialPagadoraId,
}: {
  linhas: LinhaOutraCasa[];
  casas: Casa[];
  filialPagadoraId: string;
}) {
  if (linhas.length === 0) return null;
  const casaPorId = new Map(casas.map((c) => [c.id, c]));
  const casaPorCnpj = new Map(casas.map((c) => [soDigitos(c.cnpj), c]));
  const pagadora = casaPorId.get(filialPagadoraId);

  // Dados extras das contas (nota de origem, referência, observação)
  const contaIds = linhas.map((l) => l.conta.id);
  const extras = await db
    .select({
      id: schema.contaPagar.id,
      notaCompraId: schema.contaPagar.notaCompraId,
      codigoReferencia: schema.contaPagar.codigoReferencia,
      observacao: schema.contaPagar.observacao,
      parcela: schema.contaPagar.parcela,
      totalParcelas: schema.contaPagar.totalParcelas,
      criadoEm: schema.contaPagar.criadoEm,
    })
    .from(schema.contaPagar)
    .where(inArray(schema.contaPagar.id, contaIds));
  const extraPorConta = new Map(extras.map((e) => [e.id, e]));

  // Nota de origem da conta (origem NFE) ou duplicata da nota que gerou a conta
  const dupDaConta = await db
    .select({
      contaPagarId: schema.notaCompraDuplicata.contaPagarId,
      notaCompraId: schema.notaCompraDuplicata.notaCompraId,
    })
    .from(schema.notaCompraDuplicata)
    .where(inArray(schema.notaCompraDuplicata.contaPagarId, contaIds));
  const notaDaConta = new Map<string, string>();
  for (const e of extras) if (e.notaCompraId) notaDaConta.set(e.id, e.notaCompraId);
  for (const d of dupDaConta)
    if (d.contaPagarId && !notaDaConta.has(d.contaPagarId)) notaDaConta.set(d.contaPagarId, d.notaCompraId);

  // Conta sem nota ligada: procura nota do mesmo emitente (CNPJ do boleto) com
  // valor total ou duplicata do valor do boleto, em qualquer casa do usuário.
  const semNota = linhas.filter((l) => !notaDaConta.has(l.conta.id));
  const cnpjsSemNota = [...new Set(semNota.map((l) => soDigitos(l.p.cpfCnpjBeneficiario)).filter(Boolean))];
  const datas = linhas.map((l) => l.p.dataPagamento?.slice(0, 10) ?? l.conta.dataVencimento).sort();
  const candidatas =
    cnpjsSemNota.length > 0
      ? await db
          .select({
            id: schema.notaCompra.id,
            emitCnpj: schema.notaCompra.emitCnpj,
            valorTotal: schema.notaCompra.valorTotal,
            dataEmissao: schema.notaCompra.dataEmissao,
          })
          .from(schema.notaCompra)
          .where(
            and(
              inArray(schema.notaCompra.filialId, casas.map((c) => c.id)),
              inArray(schema.notaCompra.emitCnpj, cnpjsSemNota),
              gte(schema.notaCompra.dataEmissao, new Date(`${somaDias(datas[0]!, -90)}T00:00:00-03:00`)),
              lte(schema.notaCompra.dataEmissao, new Date(`${somaDias(datas[datas.length - 1]!, 5)}T23:59:59-03:00`)),
            ),
          )
      : [];
  const dupCandidatas =
    candidatas.length > 0
      ? await db
          .select({
            notaCompraId: schema.notaCompraDuplicata.notaCompraId,
            valor: schema.notaCompraDuplicata.valor,
            dataVencimento: schema.notaCompraDuplicata.dataVencimento,
          })
          .from(schema.notaCompraDuplicata)
          .where(inArray(schema.notaCompraDuplicata.notaCompraId, candidatas.map((n) => n.id)))
      : [];
  const possiveis = new Map<string, string[]>(); // contaId -> notaIds
  for (const l of semNota) {
    const cnpj = soDigitos(l.p.cpfCnpjBeneficiario);
    const valores = new Set([centavos(l.p.valorNominal), centavos(l.p.valorPago), centavos(l.conta.valor)]);
    const ids = candidatas
      .filter(
        (n) =>
          soDigitos(n.emitCnpj) === cnpj &&
          (valores.has(centavos(n.valorTotal)) ||
            dupCandidatas.some((d) => d.notaCompraId === n.id && valores.has(centavos(d.valor)))),
      )
      .map((n) => n.id);
    if (ids.length) possiveis.set(l.conta.id, ids.slice(0, 3));
  }

  // Carrega as notas (ligadas + possíveis), duplicatas e pedidos
  const notaIds = [...new Set([...notaDaConta.values(), ...[...possiveis.values()].flat()])];
  const notas =
    notaIds.length > 0
      ? await db
          .select({
            id: schema.notaCompra.id,
            filialId: schema.notaCompra.filialId,
            numero: schema.notaCompra.numero,
            serie: schema.notaCompra.serie,
            chave: schema.notaCompra.chave,
            emitNome: schema.notaCompra.emitNome,
            emitCnpj: schema.notaCompra.emitCnpj,
            destNome: schema.notaCompra.destNome,
            destCnpj: schema.notaCompra.destCnpj,
            valorTotal: schema.notaCompra.valorTotal,
            dataEmissao: schema.notaCompra.dataEmissao,
            situacao: schema.notaCompra.situacao,
          })
          .from(schema.notaCompra)
          .where(inArray(schema.notaCompra.id, notaIds))
      : [];
  const notaPorId = new Map(notas.map((n) => [n.id, n]));
  const dups =
    notaIds.length > 0
      ? await db
          .select({
            notaCompraId: schema.notaCompraDuplicata.notaCompraId,
            numero: schema.notaCompraDuplicata.numero,
            valor: schema.notaCompraDuplicata.valor,
            dataVencimento: schema.notaCompraDuplicata.dataVencimento,
          })
          .from(schema.notaCompraDuplicata)
          .where(inArray(schema.notaCompraDuplicata.notaCompraId, notaIds))
      : [];
  const pedidos =
    notaIds.length > 0
      ? await db
          .select({
            id: schema.pedidoCompra.id,
            filialId: schema.pedidoCompra.filialId,
            numero: schema.pedidoCompra.numero,
            status: schema.pedidoCompra.status,
            valorTotal: schema.pedidoCompra.valorTotal,
            enviadoEm: schema.pedidoCompra.enviadoEm,
            criadoEm: schema.pedidoCompra.criadoEm,
            notaCompraId: schema.pedidoCompra.notaCompraId,
          })
          .from(schema.pedidoCompra)
          .where(inArray(schema.pedidoCompra.notaCompraId, notaIds))
      : [];

  // Pedido aberto do mesmo fornecedor na casa da conta, quando não há nota
  // ligada (pode ter sido comprado e a nota ainda não entrou).
  const cnpjsBoletos = [...new Set(linhas.map((l) => soDigitos(l.p.cpfCnpjBeneficiario)).filter(Boolean))];
  const fornIds = await db
    .select({ id: schema.fornecedor.id, filialId: schema.fornecedor.filialId, cnpj: schema.fornecedor.cnpjOuCpf })
    .from(schema.fornecedor)
    .where(
      and(
        inArray(schema.fornecedor.filialId, casas.map((c) => c.id)),
        inArray(schema.fornecedor.cnpjOuCpf, cnpjsBoletos.length ? cnpjsBoletos : ['-']),
      ),
    );
  const pedidosSemNota =
    fornIds.length > 0
      ? await db
          .select({
            id: schema.pedidoCompra.id,
            filialId: schema.pedidoCompra.filialId,
            fornecedorId: schema.pedidoCompra.fornecedorId,
            numero: schema.pedidoCompra.numero,
            status: schema.pedidoCompra.status,
            valorTotal: schema.pedidoCompra.valorTotal,
            criadoEm: schema.pedidoCompra.criadoEm,
          })
          .from(schema.pedidoCompra)
          .where(
            and(
              inArray(schema.pedidoCompra.fornecedorId, fornIds.map((f) => f.id)),
              isNull(schema.pedidoCompra.notaCompraId),
              gte(schema.pedidoCompra.criadoEm, new Date(`${somaDias(datas[0]!, -90)}T00:00:00-03:00`)),
            ),
          )
      : [];
  const cnpjDoForn = new Map(fornIds.map((f) => [f.id, soDigitos(f.cnpj)]));

  let alertas = 0;
  const cards = linhas.map((l) => {
    const { p, conta } = l;
    const extra = extraPorConta.get(conta.id);
    const cnpjBoleto = soDigitos(p.cpfCnpjBeneficiario);
    const valoresBoleto = new Set([centavos(p.valorNominal), centavos(p.valorPago)]);
    const okCnpj = !!cnpjBoleto && soDigitos(conta.fornecedorCnpj) === cnpjBoleto;
    const okValor = valoresBoleto.has(centavos(conta.valor));
    const okVenc =
      conta.dataVencimento === p.dataVencimentoTitulo || conta.dataVencimento === p.dataVencimentoDigitada;

    const notaId = notaDaConta.get(conta.id);
    const nota = notaId ? notaPorId.get(notaId) : undefined;
    const notasPossiveis = (possiveis.get(conta.id) ?? []).map((id) => notaPorId.get(id)).filter(Boolean) as typeof notas;
    const destino = nota ? casaPorCnpj.get(soDigitos(nota.destCnpj)) : undefined;
    const notaDaPagadora = !!nota && destino?.id === filialPagadoraId;
    const notaDaCasaConta = !!nota && destino?.id === conta.filialId;
    if (notaDaPagadora || !okCnpj || !okValor) alertas++;

    const pedidosDaNota = nota ? pedidos.filter((pd) => pd.notaCompraId === nota.id) : [];
    const pedidosAbertos = nota
      ? []
      : pedidosSemNota.filter(
          (pd) =>
            cnpjDoForn.get(pd.fornecedorId) === cnpjBoleto &&
            (pd.filialId === conta.filialId || pd.filialId === filialPagadoraId),
        );

    // Veredito
    let veredito: { cor: string; texto: string };
    if (notaDaPagadora) {
      veredito = {
        cor: 'bg-rose-100 text-rose-900 border-rose-300',
        texto: `A nota foi emitida pra ${pagadora?.nome ?? 'esta casa'}: a conta parece lançada na casa errada (${l.casaDaConta}). Não é encontro de contas — corrija a casa da conta.`,
      };
    } else if (notaDaCasaConta && okCnpj && okValor) {
      veredito = {
        cor: 'bg-emerald-100 text-emerald-900 border-emerald-300',
        texto: `Confere: nota emitida pra ${l.casaDaConta}, mesmo fornecedor e valor. ${pagadora?.nome ?? 'Esta casa'} pagou a conta da ${l.casaDaConta} → encontro de contas.`,
      };
    } else if (!okCnpj || !okValor) {
      veredito = {
        cor: 'bg-rose-100 text-rose-900 border-rose-300',
        texto: `Casou fraco (${!okCnpj ? 'CNPJ diferente' : ''}${!okCnpj && !okValor ? ' e ' : ''}${!okValor ? 'valor diferente' : ''}). Confira antes de lançar no encontro.`,
      };
    } else {
      veredito = {
        cor: 'bg-amber-100 text-amber-900 border-amber-300',
        texto: nota
          ? `Mesmo fornecedor e valor, mas o destinatário da nota (${fmtCnpj(nota.destCnpj)}) não é de nenhuma casa conhecida. Confira a nota.`
          : `Mesmo fornecedor e valor${okVenc ? ' e vencimento' : ''}, mas a conta não tem nota ligada. Confira pela nota/pedido abaixo ou pela descrição.`,
      };
    }

    return (
      <div key={p.codigoTransacao} className="rounded-lg border border-violet-200 bg-white p-3 text-xs text-slate-800">
        <div className={`mb-2 rounded-md border px-2 py-1.5 font-medium ${veredito.cor}`}>{veredito.texto}</div>
        <div className="grid gap-3 md:grid-cols-2">
          {/* Banco */}
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              🏦 O que o Inter da {pagadora?.nome ?? 'casa'} pagou
            </p>
            <p className="font-medium">{p.nomeBeneficiario ?? '—'}</p>
            <p className="font-mono text-[11px] text-slate-500">{fmtCnpj(p.cpfCnpjBeneficiario)}</p>
            <p className="mt-1">
              Valor do boleto <b>{brl(p.valorNominal)}</b> · pago <b>{brl(p.valorPago)}</b>
            </p>
            <p>
              Venc. {formatDate(p.dataVencimentoTitulo ?? null)} · pago em {formatDate(p.dataPagamento ?? null)}
            </p>
            {p.codigoBarra && (
              <p className="mt-1 break-all font-mono text-[10px] text-slate-400" title="Código de barras">
                {p.codigoBarra}
              </p>
            )}
          </div>
          {/* Conta */}
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              📄 Conta lançada na {l.casaDaConta}
            </p>
            <p className="font-medium">
              <Link href={`/financeiro/conta/${conta.id}`} className="text-violet-800 underline">
                {conta.fornecedorNome ?? 'sem fornecedor'}
              </Link>
            </p>
            <p className="font-mono text-[11px] text-slate-500">{fmtCnpj(conta.fornecedorCnpj)}</p>
            <p className="mt-1">
              Valor <b>{brl(conta.valor)}</b> · venc. {formatDate(conta.dataVencimento)}
              {extra?.parcela ? ` · parcela ${extra.parcela}/${extra.totalParcelas ?? '?'}` : ''}
            </p>
            <p>
              {conta.dataPagamento ? `✓ baixada em ${formatDate(conta.dataPagamento)}` : '⚠ em aberto'} · origem{' '}
              {conta.origem}
            </p>
            {conta.descricao && <p className="mt-1 text-slate-600">{conta.descricao}</p>}
            {extra?.observacao && <p className="text-slate-500">Obs.: {extra.observacao}</p>}
            {extra?.codigoReferencia && <p className="text-slate-500">Ref.: {extra.codigoReferencia}</p>}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chk ok={okCnpj} txt="CNPJ do boleto = fornecedor da conta" />
          <Chk ok={okValor} txt="valor bate" />
          <Chk ok={okVenc} txt="vencimento bate" />
          {nota && <Chk ok={notaDaCasaConta} txt={`nota emitida pra ${destino?.nome ?? 'CNPJ desconhecido'}`} />}
          {l.encontro && (
            <span className="rounded bg-violet-700 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              ⚖️ {l.encontro.status === 'COMPENSADO' ? 'compensado no' : 'no'} encontro {l.encontro.competencia}
            </span>
          )}
        </div>

        {/* Nota */}
        <div className="mt-2 border-t border-slate-100 pt-2">
          {nota ? (
            <NotaLinha nota={nota} casa={casaPorId.get(nota.filialId)?.nome} dups={dups.filter((d) => d.notaCompraId === nota.id)} rotulo="🧾 Nota da conta" />
          ) : notasPossiveis.length > 0 ? (
            notasPossiveis.map((n) => (
              <NotaLinha
                key={n.id}
                nota={n}
                casa={casaPorId.get(n.filialId)?.nome}
                dups={dups.filter((d) => d.notaCompraId === n.id)}
                rotulo="🧾 Nota provável (mesmo emitente e valor, não ligada à conta)"
                destinoCasa={casaPorCnpj.get(soDigitos(n.destCnpj))?.nome}
              />
            ))
          ) : (
            <p className="text-slate-500">🧾 Nenhuma nota ligada à conta nem nota do mesmo emitente com esse valor.</p>
          )}
        </div>

        {/* Pedido */}
        <div className="mt-2 border-t border-slate-100 pt-2">
          {pedidosDaNota.length > 0 ? (
            pedidosDaNota.map((pd) => (
              <p key={pd.id}>
                🛒 Pedido{' '}
                <Link href={`/compras/pedidos/${pd.id}`} className="font-medium text-violet-800 underline">
                  nº {pd.numero}
                </Link>{' '}
                da {casaPorId.get(pd.filialId)?.nome ?? '—'} · {pd.status.toLowerCase()} · {brl(pd.valorTotal)} · feito em{' '}
                {formatDate(pd.criadoEm)}
              </p>
            ))
          ) : pedidosAbertos.length > 0 ? (
            <>
              <p className="text-slate-500">🛒 Sem pedido ligado à nota. Pedidos sem nota do mesmo fornecedor:</p>
              {pedidosAbertos.slice(0, 4).map((pd) => (
                <p key={pd.id} className="ml-4">
                  <Link href={`/compras/pedidos/${pd.id}`} className="font-medium text-violet-800 underline">
                    nº {pd.numero}
                  </Link>{' '}
                  da {casaPorId.get(pd.filialId)?.nome ?? '—'} · {pd.status.toLowerCase()} · {brl(pd.valorTotal)} ·{' '}
                  {formatDate(pd.criadoEm)}
                </p>
              ))}
            </>
          ) : (
            <p className="text-slate-500">🛒 Nenhum pedido de compra ligado.</p>
          )}
        </div>
      </div>
    );
  });

  return (
    <details className="mt-3 rounded-lg border border-violet-300 bg-violet-100/60 p-2">
      <summary className="cursor-pointer select-none text-xs font-semibold text-violet-900">
        🔎 Conferir as {linhas.length} {linhas.length === 1 ? 'conta' : 'contas'} pagas pela outra casa (nota, pedido e
        casa de destino)
        {alertas > 0 && (
          <span className="ml-2 rounded bg-rose-600 px-1.5 py-0.5 text-[10px] text-white">
            {alertas} pra olhar com atenção
          </span>
        )}
      </summary>
      <div className="mt-2 space-y-2">{cards}</div>
    </details>
  );
}

function Chk({ ok, txt }: { ok: boolean; txt: string }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
        ok ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
      }`}
    >
      {ok ? '✓' : '✗'} {txt}
    </span>
  );
}

function NotaLinha({
  nota,
  casa,
  dups,
  rotulo,
  destinoCasa,
}: {
  nota: {
    id: string;
    numero: number | null;
    serie: number | null;
    emitNome: string | null;
    destNome: string | null;
    destCnpj: string | null;
    valorTotal: string | null;
    dataEmissao: Date | null;
    situacao: string | null;
  };
  casa: string | undefined;
  dups: Array<{ numero: string | null; valor: string; dataVencimento: string }>;
  rotulo: string;
  destinoCasa?: string;
}) {
  return (
    <div className="mb-1">
      <p>
        {rotulo}:{' '}
        <Link href={`/movimento/entrada-notas/${nota.id}`} className="font-medium text-violet-800 underline">
          NF-e {nota.numero ?? '—'}
          {nota.serie != null ? `/${nota.serie}` : ''}
        </Link>{' '}
        · {brl(nota.valorTotal)} · emitida {formatDate(nota.dataEmissao)}
        {nota.situacao && nota.situacao !== 'AUTORIZADA' ? ` · ${nota.situacao.toLowerCase()}` : ''} · lançada na{' '}
        {casa ?? '—'}
      </p>
      <p className="ml-4 text-slate-600">
        Destinatário: <b>{nota.destNome ?? '—'}</b> <span className="font-mono text-[10px]">{fmtCnpj(nota.destCnpj)}</span>
        {destinoCasa && <span className="ml-1 text-violet-800">({destinoCasa})</span>}
      </p>
      {dups.length > 0 && (
        <p className="ml-4 text-slate-500">
          Duplicatas:{' '}
          {dups
            .sort((a, b) => a.dataVencimento.localeCompare(b.dataVencimento))
            .map((d) => `${d.numero ?? '—'} ${formatDate(d.dataVencimento)} ${brl(d.valor)}`)
            .join(' · ')}
        </p>
      )}
    </div>
  );
}
