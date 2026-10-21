import { redirect } from 'next/navigation';
import { idsComGemea } from '@/lib/juntar-pedido-foto';
import { tipoCompra } from '@/lib/nota-tipo';
import { exigirPerm } from '@/lib/exigir-perm';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, count, desc, eq, gte, ilike, lte, sql, sum } from 'drizzle-orm';
import { buscaIlike } from '@/lib/texto';
import { AppHeader } from '@/components/app-header';
import { brl, int, maskCnpj } from '@/lib/format';
import { hojeBr, diasAtrasBr } from '@/lib/datas';
import { UploadNotasForm } from './upload-form';
import { PedidoFotoForm } from './pedido-foto-form';
import { ManifestarBtn } from './manifestar-btn';
import { ManifestarUmaBtn } from './manifestar-uma-btn';
import { ConfirmarOperacaoBtn } from './confirmar-operacao-btn';
import { BuscarXmlBtn } from './buscar-xml-btn';
import { TrazerPorChaveForm } from './trazer-por-chave-form';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  q?: string;
  dataIni?: string;
  dataFim?: string;
  origem?: string;
  tipo?: string;
  page?: string;
}

// Filtro em linguagem simples: nota fiscal de verdade × pedido sem nota (foto).
type TipoFiltro = 'TODOS' | 'NF' | 'PEDIDO';
const TIPO_SQL_NF = ['PEDIDO_FOTO', 'NFSE_PDF'];

type OrigemFiltro = 'TODAS' | 'UPLOAD' | 'SEFAZ_DFE' | 'SEFAZ_DFE_RESUMO' | 'SEFAZ_DFE_RESUMO_CIENTE' | 'PEDIDO_FOTO';

const ORIGEM_LABEL: Record<string, { label: string; curto: string; cls: string }> = {
  UPLOAD: {
    label: 'Upload manual',
    curto: 'Manual',
    cls: 'bg-slate-100 text-slate-700',
  },
  SEFAZ_DFE: {
    label: 'SEFAZ DF-e (completa)',
    curto: 'SEFAZ',
    cls: 'bg-sky-100 text-sky-800',
  },
  SEFAZ_DFE_RESUMO: {
    label: 'SEFAZ DF-e (resumo — precisa ciência)',
    curto: 'Resumo',
    cls: 'bg-amber-100 text-amber-800',
  },
  SEFAZ_DFE_RESUMO_CIENTE: {
    label: 'Ciência enviada — aguardando XML completo',
    curto: 'Aguard.',
    cls: 'bg-violet-100 text-violet-800',
  },
  PEDIDO_FOTO: {
    label: 'Pedido sem nota (foto lida pelo sistema)',
    curto: 'Sem nota',
    cls: 'bg-emerald-100 text-emerald-800',
  },
  NFSE_PDF: {
    label: 'Nota de serviço (PDF lido pelo sistema — só contas a pagar)',
    curto: 'Serviço',
    cls: 'bg-indigo-100 text-indigo-800',
  },
};

const PAGE_SIZE = 50;

export default async function EntradaNotasPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
   await exigirPerm(user.id, 'nota_compra.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialSelecionada =
    await escolherFilial(filiais, sp.filialId);
  const q = (sp.q ?? '').trim();
  // Filtro padrao 365 dias — cobre praticamente todas as NFes do ano fiscal.
  // 90 dias era curto demais: notas atrasadas (Manifesto SEFAZ, fornecedor que
  // demorou pra entregar, NFe de devolucao antiga) sumiam da grade.
  const dataIni = sp.dataIni && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataIni) ? sp.dataIni : diasAtrasBr(365);
  const dataFim = sp.dataFim && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataFim) ? sp.dataFim : hojeBr();
  const origem = (sp.origem ?? 'TODAS') as OrigemFiltro;
  const tipo: TipoFiltro = sp.tipo === 'NF' || sp.tipo === 'PEDIDO' ? sp.tipo : 'TODOS';
  const page = Math.max(0, Number(sp.page ?? '0') || 0);

  if (!filialSelecionada) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-7xl px-6 py-10 text-sm text-slate-500">
          Nenhuma filial disponível.
        </p>
      </main>
    );
  }

  const dtIni = new Date(dataIni + 'T00:00:00-03:00');
  const dtFim = new Date(dataFim + 'T23:59:59-03:00');

  // Mesmo fix do bug do CNPJ vazio (matchar tudo com %%) na lista de fornecedores
  const qDigits = q.replace(/\D/g, '');
  const where = and(
    eq(schema.notaCompra.filialId, filialSelecionada.id),
    gte(schema.notaCompra.dataEmissao, dtIni),
    lte(schema.notaCompra.dataEmissao, dtFim),
    origem !== 'TODAS' ? eq(schema.notaCompra.origemImportacao, origem) : undefined,
    tipo === 'PEDIDO' ? eq(schema.notaCompra.origemImportacao, 'PEDIDO_FOTO') : undefined,
    tipo === 'NF'
      ? sql`coalesce(${schema.notaCompra.origemImportacao}, 'UPLOAD') NOT IN (${sql.join(
          TIPO_SQL_NF.map((o) => sql`${o}`),
          sql`, `,
        )})`
      : undefined,
    q
      ? qDigits.length > 0
        ? sql`(${buscaIlike(schema.notaCompra.emitNome, q)} OR ${ilike(
            schema.notaCompra.emitCnpj,
            `%${qDigits}%`,
          )} OR ${ilike(schema.notaCompra.chave, `%${qDigits}%`)})`
        : buscaIlike(schema.notaCompra.emitNome, q)
      : undefined,
  );

  // Contador de resumos AINDA não manifestados (precisa ação manual).
  // SEFAZ_DFE_RESUMO_CIENTE já foi manifestado — aguarda XML completo chegar na próxima consulta.
  const [resumosPendentes] = await db
    .select({ qtd: count() })
    .from(schema.notaCompra)
    .where(
      and(
        eq(schema.notaCompra.filialId, filialSelecionada.id),
        gte(schema.notaCompra.dataEmissao, dtIni),
        lte(schema.notaCompra.dataEmissao, dtFim),
        eq(schema.notaCompra.origemImportacao, 'SEFAZ_DFE_RESUMO'),
      ),
    );

  // Prazos da SEFAZ contados da autorização: ciência só até 10 dias (depois
  // responde 596); confirmação até 180, mas o XML só desce até ~90 dias (632).
  // Entre 10 e 88 dias o caminho é a Confirmação da Operação; depois disso, só
  // subindo o XML na mão.
  const idadeSql = sql`extract(epoch from now() - coalesce(${schema.notaCompra.dataAutorizacao}, ${schema.notaCompra.dataEmissao})) / 86400`;
  const naoCancelada = sql`coalesce(${schema.notaCompra.situacao}, '') <> 'CANCELADA'`;
  const confirmaveis = await db
    .select({
      chave: schema.notaCompra.chave,
      emitNome: schema.notaCompra.emitNome,
      valorTotal: schema.notaCompra.valorTotal,
    })
    .from(schema.notaCompra)
    .where(
      and(
        eq(schema.notaCompra.filialId, filialSelecionada.id),
        gte(schema.notaCompra.dataEmissao, dtIni),
        lte(schema.notaCompra.dataEmissao, dtFim),
        eq(schema.notaCompra.origemImportacao, 'SEFAZ_DFE_RESUMO'),
        naoCancelada,
        sql`${idadeSql} > 10`,
        sql`${idadeSql} <= 88`,
      ),
    )
    .orderBy(desc(schema.notaCompra.dataEmissao))
    .limit(50);
  const [foraDoPrazo] = await db
    .select({ qtd: count() })
    .from(schema.notaCompra)
    .where(
      and(
        eq(schema.notaCompra.filialId, filialSelecionada.id),
        gte(schema.notaCompra.dataEmissao, dtIni),
        lte(schema.notaCompra.dataEmissao, dtFim),
        eq(schema.notaCompra.origemImportacao, 'SEFAZ_DFE_RESUMO'),
        naoCancelada,
        sql`${idadeSql} > 88`,
      ),
    );
  const [cientesAguardando] = await db
    .select({ qtd: count() })
    .from(schema.notaCompra)
    .where(
      and(
        eq(schema.notaCompra.filialId, filialSelecionada.id),
        gte(schema.notaCompra.dataEmissao, dtIni),
        lte(schema.notaCompra.dataEmissao, dtFim),
        eq(schema.notaCompra.origemImportacao, 'SEFAZ_DFE_RESUMO_CIENTE'),
        naoCancelada,
        sql`${idadeSql} <= 90`,
      ),
    );
  const fornecedoresConfirmaveis = [
    ...new Set(confirmaveis.map((c) => (c.emitNome ?? '').split(' ').slice(0, 2).join(' '))),
  ]
    .filter(Boolean)
    .slice(0, 6)
    .join(', ');
  const totalConfirmaveis = confirmaveis.reduce((a, c) => a + Number(c.valorTotal ?? 0), 0);

  const [stats] = await db
    .select({
      qtd: count(),
      total: sum(schema.notaCompra.valorTotal),
    })
    .from(schema.notaCompra)
    .where(where);

  const notas = await db
    .select({
      id: schema.notaCompra.id,
      chave: schema.notaCompra.chave,
      serie: schema.notaCompra.serie,
      numero: schema.notaCompra.numero,
      dataEmissao: schema.notaCompra.dataEmissao,
      emitNome: schema.notaCompra.emitNome,
      emitCnpj: schema.notaCompra.emitCnpj,
      emitUf: schema.notaCompra.emitUf,
      valorTotal: schema.notaCompra.valorTotal,
      valorProdutos: schema.notaCompra.valorProdutos,
      situacao: schema.notaCompra.situacao,
      origemImportacao: schema.notaCompra.origemImportacao,
      idadeDias: sql<number>`(${idadeSql})::float8`,
    })
    .from(schema.notaCompra)
    .where(where)
    .orderBy(desc(schema.notaCompra.dataEmissao))
    .limit(PAGE_SIZE)
    .offset(page * PAGE_SIZE);

  // Pedido sem nota (foto do DANFE) e NF-e da SEFAZ da mesma compra: selo "em dobro".
  const emDobro = await idsComGemea(notas.map((n) => n.id)).catch(() => new Set<string>());

  // Quantos itens de cada nota já entraram no estoque — vira o "O que fazer".
  const lancamento = new Map<string, { itens: number; lancados: number }>();
  if (notas.length > 0) {
    const rows = await db
      .execute(
        sql`SELECT i.nota_compra_id AS nota_id,
                   count(*)::int AS itens,
                   count(*) FILTER (WHERE EXISTS (
                     SELECT 1 FROM movimento_estoque m WHERE m.nota_compra_item_id = i.id
                   ))::int AS lancados
              FROM nota_compra_item i
             WHERE i.nota_compra_id IN (${sql.join(
               notas.map((n) => sql`${n.id}::uuid`),
               sql`, `,
             )})
             GROUP BY i.nota_compra_id`,
      )
      .catch(() => []);
    for (const r of rows as unknown as { nota_id: string; itens: number; lancados: number }[]) {
      lancamento.set(r.nota_id, { itens: Number(r.itens), lancados: Number(r.lancados) });
    }
  }
  const proximoPasso = (n: (typeof notas)[number]): { texto: string; cls: string } => {
    if (n.situacao === 'CANCELADA' || n.situacao === 'DENEGADA')
      return { texto: 'Cancelada pelo fornecedor — não lançar', cls: 'text-rose-700' };
    if (n.origemImportacao === 'SEFAZ_DFE_RESUMO')
      return { texto: 'Só o resumo chegou: dê ciência pra SEFAZ mandar os itens', cls: 'text-amber-700' };
    if (n.origemImportacao === 'SEFAZ_DFE_RESUMO_CIENTE')
      return { texto: 'Esperando a SEFAZ mandar os itens', cls: 'text-violet-700' };
    if (n.origemImportacao === 'NFSE_PDF') return { texto: 'Serviço: só conta a pagar', cls: 'text-slate-500' };
    const l = lancamento.get(n.id);
    if (!l || l.itens === 0) return { texto: 'Sem itens — abra pra ver', cls: 'text-slate-500' };
    if (l.lancados >= l.itens) return { texto: '✓ Já está no estoque', cls: 'text-emerald-700' };
    if (l.lancados > 0)
      return { texto: `Lançada em parte (${l.lancados} de ${l.itens}) — abra e termine`, cls: 'text-amber-700' };
    return { texto: '→ Abrir, conferir e lançar no estoque', cls: 'font-semibold text-sky-700' };
  };

  const totalPag = Math.max(1, Math.ceil(Number(stats?.qtd ?? 0) / PAGE_SIZE));
  const hrefPag = (p: number) => {
    const qs = new URLSearchParams();
    qs.set('filialId', filialSelecionada.id);
    if (q) qs.set('q', q);
    if (dataIni) qs.set('dataIni', dataIni);
    if (dataFim) qs.set('dataFim', dataFim);
    if (origem !== 'TODAS') qs.set('origem', origem);
    if (tipo !== 'TODOS') qs.set('tipo', tipo);
    if (p > 0) qs.set('page', String(p));
    return `/movimento/entrada-notas?${qs.toString()}`;
  };

  const hrefOrigem = (o: OrigemFiltro) => {
    const qs = new URLSearchParams();
    qs.set('filialId', filialSelecionada.id);
    if (q) qs.set('q', q);
    if (dataIni) qs.set('dataIni', dataIni);
    if (dataFim) qs.set('dataFim', dataFim);
    if (o !== 'TODAS') qs.set('origem', o);
    if (tipo !== 'TODOS') qs.set('tipo', tipo);
    return `/movimento/entrada-notas?${qs.toString()}`;
  };

  const hrefTipo = (t: TipoFiltro) => {
    const qs = new URLSearchParams();
    qs.set('filialId', filialSelecionada.id);
    if (q) qs.set('q', q);
    if (dataIni) qs.set('dataIni', dataIni);
    if (dataFim) qs.set('dataFim', dataFim);
    if (origem !== 'TODAS') qs.set('origem', origem);
    if (t !== 'TODOS') qs.set('tipo', t);
    return `/movimento/entrada-notas?${qs.toString()}`;
  };

  const hrefFilial = (filialId: string) => {
    const qs = new URLSearchParams();
    qs.set('filialId', filialId);
    if (q) qs.set('q', q);
    if (dataIni) qs.set('dataIni', dataIni);
    if (dataFim) qs.set('dataFim', dataFim);
    if (origem !== 'TODAS') qs.set('origem', origem);
    if (tipo !== 'TODOS') qs.set('tipo', tipo);
    return `/movimento/entrada-notas?${qs.toString()}`;
  };

  // Transferências de outra casa a caminho desta (aguardando conferência)
  const [transfACaminho] = await db
    .select({ n: count() })
    .from(schema.transferenciaFilial)
    .where(
      and(
        eq(schema.transferenciaFilial.filialDestinoId, filialSelecionada.id),
        eq(schema.transferenciaFilial.status, 'ENVIADA'),
      ),
    );

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-7xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Entrada de notas fiscais</h1>
        <p className="mt-1 text-sm text-slate-600">
          Controle histórico de compras. Via upload de XML manual ou{' '}
          <Link href="/configuracoes/certificados" className="text-sky-700 underline-offset-2 hover:underline">
            SEFAZ automático (Distribuição DF-e)
          </Link>
          .
        </p>

        {/* Guia em linguagem simples: o que é cada coisa e por onde entra. */}
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">Chegou mercadoria? Veja qual é o seu caso:</p>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
              <p className="text-sm font-semibold">🧾 Veio com nota fiscal</p>
              <p className="mt-1 text-sky-800">
                É o papel do fornecedor com <b>DANFE</b> escrito e um código de barras com a chave de 44
                números. Na maioria das vezes ela <b>já aparece sozinha</b> na lista abaixo (a SEFAZ manda).
              </p>
              <ul className="mt-2 list-disc space-y-0.5 pl-4 text-sky-800">
                <li>Está na lista → abra a nota, confira e lance no estoque.</li>
                <li>
                  Não está →{' '}
                  <a href="#por-chave" className="font-semibold underline">
                    📱 ler a chave pelo celular ou digitar
                  </a>
                  .
                </li>
                <li>
                  O fornecedor mandou o arquivo XML →{' '}
                  <a href="#xml" className="font-semibold underline">
                    importar XML
                  </a>
                  .
                </li>
              </ul>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
              <p className="text-sm font-semibold">📸 Veio sem nota fiscal</p>
              <p className="mt-1 text-emerald-800">
                Só um pedido, romaneio ou recibo, <b>sem DANFE e sem chave</b>. Fotografe em{' '}
                <a href="#pedido-foto" className="font-semibold underline">
                  📸 Pedido sem nota
                </a>
                : o sistema lê os itens, dá entrada no estoque e cria a conta a pagar.
              </p>
              <p className="mt-2 rounded-md bg-white/70 px-2 py-1 text-[11px] text-emerald-900">
                ⚠ Tem DANFE? Então <b>é nota fiscal</b> — use o caminho da esquerda, senão a compra entra
                duas vezes.
              </p>
              <p className="mt-2 rounded-md bg-white/70 px-2 py-1 text-[11px] text-emerald-900">
                🛠 <b>Serviço</b> (aluguel de espaço, andaime, conserto, manutenção de computador): mesmo botão
                📸. Recibo ou nota de serviço não tem produto pra vincular — vai direto pro contas a pagar.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">
              <p className="text-sm font-semibold">🔁 Veio de outra casa</p>
              <p className="mt-1 text-slate-600">
                Mercadoria mandada por outra casa do grupo não entra por aqui: confira em{' '}
                <Link
                  href={`/movimento/transferencias?filialId=${filialSelecionada.id}`}
                  className="font-semibold underline"
                >
                  Transferências
                </Link>
                .
              </p>
            </div>
          </div>
        </div>

        {(transfACaminho?.n ?? 0) > 0 && (
          <Link
            href={`/movimento/transferencias?filialId=${filialSelecionada.id}`}
            className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-900 hover:bg-sky-100"
          >
            <span>
              📦 <b>{transfACaminho?.n} transferência(s)</b> de outra casa a caminho de {filialSelecionada.nome} —
              confira os itens pra dar entrada no estoque.
            </span>
            <span className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white">Conferir e receber</span>
          </Link>
        )}

        {/* Seletor de filial */}
        {filiais.length > 1 && (
          <div className="mt-3 flex flex-wrap items-center gap-1 text-xs">
            <span className="mr-1 text-slate-500">Filial:</span>
            {filiais.map((f) => {
              const ativo = f.id === filialSelecionada.id;
              return (
                <Link
                  key={f.id}
                  href={hrefFilial(f.id)}
                  className={`rounded-md border px-2 py-1 ${
                    ativo
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {f.nome}
                </Link>
              );
            })}
          </div>
        )}

        {Number(resumosPendentes?.qtd ?? 0) > 0 && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="font-semibold">
              ⚠ {int(Number(resumosPendentes?.qtd ?? 0))} nota(s) estão como resumo
            </p>
            <p className="mt-1 text-amber-800">
              A SEFAZ só devolve XML completo depois que você der ciência da operação. Enquanto isso,
              você tem chave + fornecedor + valor, mas sem itens/impostos detalhados. Dar ciência
              não compromete a empresa.{' '}
              <Link href={hrefOrigem('SEFAZ_DFE_RESUMO')} className="underline">
                Ver só os resumos →
              </Link>
            </p>
            <ManifestarBtn filialId={filialSelecionada.id} />
            {confirmaveis.length > 0 && (
              <div className="mt-3 border-t border-amber-200 pt-3">
                <p className="font-semibold">
                  {int(confirmaveis.length)} resumo(s) passaram dos 10 dias da ciência (a SEFAZ
                  responde &quot;596 … prazo permitido [10 dias]&quot;)
                </p>
                <p className="mt-1 text-amber-800">
                  Pra essas, o que libera o XML é a <b>Confirmação da Operação</b> (vale até 180
                  dias). Ela declara à SEFAZ que a mercadoria chegou e não se desfaz — confirme só
                  o que foi recebido. Também dá pra confirmar uma a uma na lista.
                  {fornecedoresConfirmaveis && <> Fornecedores: {fornecedoresConfirmaveis}.</>}
                </p>
                <div className="mt-2">
                  <ConfirmarOperacaoBtn
                    filialId={filialSelecionada.id}
                    chaves={confirmaveis.map((c) => c.chave)}
                    resumo={`${brl(totalConfirmaveis)}${
                      fornecedoresConfirmaveis ? ` — ${fornecedoresConfirmaveis}` : ''
                    }`}
                    lote
                  />
                </div>
              </div>
            )}
            {Number(foraDoPrazo?.qtd ?? 0) > 0 && (
              <p className="mt-3 border-t border-amber-200 pt-3 text-amber-800">
                {int(Number(foraDoPrazo?.qtd ?? 0))} resumo(s) têm mais de 88 dias: a SEFAZ não
                entrega mais o XML (só até 90 dias). Pra ter os itens, peça o XML ao fornecedor e
                suba no upload aqui do lado.
              </p>
            )}
          </div>
        )}

        {Number(cientesAguardando?.qtd ?? 0) > 0 && (
          <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
            <p className="font-semibold">
              {int(Number(cientesAguardando?.qtd ?? 0))} nota(s) já têm ciência e o XML não veio
            </p>
            <p className="mt-1 text-sky-800">
              A consulta automática agora também pede o XML pela chave (até 10 por casa a cada
              rodada). Dá pra puxar na hora: a SEFAZ aceita ~20 consultas por hora — se passar,
              bloqueia por 1 hora.{' '}
              <Link href={hrefOrigem('SEFAZ_DFE_RESUMO_CIENTE')} className="underline">
                Ver só essas →
              </Link>
            </p>
            <div className="mt-2">
              <BuscarXmlBtn filialId={filialSelecionada.id} />
            </div>
          </div>
        )}

        <div id="por-chave" className="scroll-mt-20">
          <TrazerPorChaveForm filialId={filialSelecionada.id} />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[380px_1fr]">
          {/* Coluna esquerda: upload + filtro */}
          <div className="space-y-4">
            <div id="xml" className="scroll-mt-20">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-sky-700">
                🧾 Com nota fiscal (arquivo XML)
              </p>
              <UploadNotasForm
                filialId={filialSelecionada.id}
                filiais={filiais.map((f) => ({ id: f.id, nome: f.nome }))}
              />
            </div>

            <div id="pedido-foto" className="scroll-mt-20">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                📸 Sem nota fiscal (foto do pedido)
              </p>
              <PedidoFotoForm
                filialId={filialSelecionada.id}
                filiais={filiais.map((f) => ({ id: f.id, nome: f.nome }))}
              />
            </div>

          </div>

          {/* Coluna direita: busca + lista */}
          <div className="space-y-4">
            {filiais.length > 1 && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-slate-500">Filial:</span>
                {filiais.map((f) => (
                  <Link
                    key={f.id}
                    href={`/movimento/entrada-notas?filialId=${f.id}`}
                    className={`rounded-md border px-3 py-1 text-xs ${
                      f.id === filialSelecionada.id
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {f.nome}
                  </Link>
                ))}
              </div>
            )}

            {/* KPIs */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600">
                  Notas no período
                </p>
                <p className="mt-1 text-2xl font-bold text-slate-900">
                  {int(Number(stats?.qtd ?? 0))}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600">
                  Total comprado
                </p>
                <p className="mt-1 text-2xl font-bold text-slate-900">
                  {brl(Number(stats?.total ?? 0))}
                </p>
              </div>
            </div>

            {/* Filtro simples por tipo */}
            <div className="flex flex-wrap items-center gap-1 text-xs">
              <span className="mr-1 text-slate-500">Mostrar:</span>
              {(
                [
                  ['TODOS', 'Tudo'],
                  ['NF', '🧾 Notas fiscais'],
                  ['PEDIDO', '📸 Pedidos sem nota'],
                ] as const
              ).map(([t, label]) => (
                <Link
                  key={t}
                  href={hrefTipo(t)}
                  className={`rounded-md border px-2.5 py-1 font-medium ${
                    t === tipo
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </Link>
              ))}
            </div>

            {/* Tabs de origem */}
            <div className="flex flex-wrap items-center gap-1 text-xs">
              <span className="mr-1 text-slate-500">Origem:</span>
              {(['TODAS', 'UPLOAD', 'SEFAZ_DFE', 'SEFAZ_DFE_RESUMO', 'SEFAZ_DFE_RESUMO_CIENTE', 'PEDIDO_FOTO'] as const).map((o) => {
                const ativo = o === origem;
                const label =
                  o === 'TODAS'
                    ? 'Todas'
                    : ORIGEM_LABEL[o]?.curto ?? o;
                return (
                  <Link
                    key={o}
                    href={hrefOrigem(o)}
                    className={`rounded-md border px-2 py-1 ${
                      ativo
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {label}
                  </Link>
                );
              })}
            </div>

            {/* Filtros */}
            <form method="GET" className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="filialId" value={filialSelecionada.id} />
              {origem !== 'TODAS' && <input type="hidden" name="origem" value={origem} />}
              {tipo !== 'TODOS' && <input type="hidden" name="tipo" value={tipo} />}
              <label className="text-xs text-slate-600">
                Busca
                <input
                  type="text"
                  name="q"
                  defaultValue={q}
                  placeholder="Fornecedor, CNPJ ou chave..."
                  className="ml-2 w-72 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs text-slate-600">
                De
                <input
                  type="date"
                  name="dataIni"
                  defaultValue={dataIni}
                  className="ml-2 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs text-slate-600">
                Até
                <input
                  type="date"
                  name="dataFim"
                  defaultValue={dataFim}
                  className="ml-2 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
              </label>
              <button
                type="submit"
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                Filtrar
              </button>
            </form>

            {/* Lista */}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Tipo</th>
                    <th className="px-4 py-2">Emissão</th>
                    <th className="px-4 py-2">Nº / Série</th>
                    <th className="px-4 py-2">Fornecedor</th>
                    <th className="px-4 py-2">CNPJ</th>
                    <th className="px-4 py-2 text-right">Valor</th>
                    <th className="px-4 py-2">Situação</th>
                    <th className="px-4 py-2">Origem</th>
                    <th className="px-4 py-2">O que fazer</th>
                  </tr>
                </thead>
                <tbody>
                  {notas.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-xs text-slate-500">
                        {q ? 'Nenhuma nota com esse filtro.' : 'Nenhuma nota no período. Faça upload de um XML pra começar.'}
                      </td>
                    </tr>
                  ) : (
                    notas.map((n) => (
                      <tr key={n.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-2">
                          {(() => {
                            const t = tipoCompra(n.origemImportacao);
                            return (
                              <span
                                className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${t.cls}`}
                                title={t.dica}
                              >
                                {t.icone} {t.texto}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-700">
                          {n.dataEmissao ? new Date(n.dataEmissao).toLocaleDateString('pt-BR') : '—'}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-700">
                          <Link
                            href={`/movimento/entrada-notas/${n.id}`}
                            className="hover:text-slate-900 hover:underline"
                          >
                            {n.numero ?? '—'}/{n.serie ?? '—'}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-800">
                          <Link
                            href={`/movimento/entrada-notas/${n.id}`}
                            className="hover:text-slate-900 hover:underline"
                          >
                            {n.emitNome ?? '—'}
                          </Link>
                          {n.emitUf && (
                            <span className="ml-1 text-[10px] text-slate-400">{n.emitUf}</span>
                          )}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-600">
                          {n.emitCnpj ? maskCnpj(n.emitCnpj) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-sm font-medium text-slate-900">
                          {brl(n.valorTotal)}
                        </td>
                        <td className="px-4 py-2">
                          {n.situacao === 'AUTORIZADA' ? (
                            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                              ✓ Autorizada
                            </span>
                          ) : n.situacao === 'CANCELADA' || n.situacao === 'DENEGADA' ? (
                            <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-800">
                              {n.situacao}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400">{n.situacao ?? '—'}</span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {(() => {
                            const cfg = ORIGEM_LABEL[n.origemImportacao ?? 'UPLOAD'];
                            if (!cfg) {
                              return (
                                <span className="text-[10px] text-slate-400">
                                  {n.origemImportacao ?? '—'}
                                </span>
                              );
                            }
                            return (
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cfg.cls}`}
                                title={cfg.label}
                              >
                                {cfg.curto}
                              </span>
                            );
                          })()}
                          {emDobro.has(n.id) && (
                            <Link
                              href={`/movimento/entrada-notas/${n.id}`}
                              className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 hover:bg-amber-200"
                              title="Mesma compra como Pedido sem nota e como NF-e da SEFAZ — abra e use 🔗 Juntar na NF-e"
                            >
                              em dobro
                            </Link>
                          )}
                          {n.origemImportacao === 'SEFAZ_DFE_RESUMO' && (
                            <div className="mt-1">
                              <ManifestarUmaBtn
                                filialId={filialSelecionada.id}
                                chave={n.chave}
                              />
                            </div>
                          )}
                          {n.origemImportacao === 'SEFAZ_DFE_RESUMO' &&
                            n.situacao !== 'CANCELADA' &&
                            Number(n.idadeDias) > 10 &&
                            Number(n.idadeDias) <= 88 && (
                              <div className="mt-1">
                                <ConfirmarOperacaoBtn
                                  filialId={filialSelecionada.id}
                                  chaves={[n.chave]}
                                  resumo={`${n.emitNome ?? ''} ${brl(n.valorTotal)}`.trim()}
                                />
                              </div>
                            )}
                          {n.origemImportacao === 'SEFAZ_DFE_RESUMO' &&
                            n.situacao !== 'CANCELADA' &&
                            Number(n.idadeDias) > 88 && (
                              <div className="mt-1 max-w-[180px] whitespace-normal text-[10px] leading-tight text-slate-500">
                                fora do prazo da SEFAZ (90 dias) — suba o XML
                              </div>
                            )}
                          {n.origemImportacao === 'SEFAZ_DFE_RESUMO_CIENTE' &&
                            n.situacao !== 'CANCELADA' &&
                            Number(n.idadeDias) <= 90 && (
                              <div className="mt-1">
                                <BuscarXmlBtn filialId={filialSelecionada.id} chave={n.chave} />
                              </div>
                            )}
                        </td>
                        <td className="px-4 py-2">
                          {(() => {
                            const ps = proximoPasso(n);
                            return (
                              <Link
                                href={`/movimento/entrada-notas/${n.id}`}
                                className={`block max-w-[200px] whitespace-normal text-[11px] leading-tight hover:underline ${ps.cls}`}
                              >
                                {emDobro.has(n.id) ? '⚠ Está em dobro: abra e junte na NF-e' : ps.texto}
                              </Link>
                            );
                          })()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              {totalPag > 1 && (
                <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs">
                  <span className="text-slate-600">
                    Página {page + 1} de {totalPag} · {int(Number(stats?.qtd ?? 0))} notas
                  </span>
                  <div className="flex gap-2">
                    {page > 0 ? (
                      <Link href={hrefPag(page - 1)} className="rounded-md border border-slate-300 bg-white px-2 py-1 hover:bg-white">
                        ← Anterior
                      </Link>
                    ) : (
                      <span className="rounded-md border border-slate-200 px-2 py-1 text-slate-400">← Anterior</span>
                    )}
                    {page < totalPag - 1 ? (
                      <Link href={hrefPag(page + 1)} className="rounded-md border border-slate-300 bg-white px-2 py-1 hover:bg-white">
                        Próxima →
                      </Link>
                    ) : (
                      <span className="rounded-md border border-slate-200 px-2 py-1 text-slate-400">Próxima →</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
