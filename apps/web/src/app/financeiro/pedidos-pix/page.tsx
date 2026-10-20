// /financeiro/pedidos-pix — pedidos que se pagam por Pix (pedido sem nota,
// hortifruti, peixe, carne…), agrupados por fornecedor, com a chave Pix pra
// copiar e o valor. Quem paga é o dono, no app do Inter; aqui ele copia chave e
// valor, cadastra a chave que falta e dá a baixa depois de pagar.
// Pedido do dono (20/10/2026), começando pela Prainha Mar.
//
// O que entra (padrão): conta em aberto com "Pedido sem nota" na descrição, ou
// lançada à mão (MANUAL), ou de fornecedor com chave Pix — menos o que tem
// cara de boleto/guia (parcela "2/4", DARF/FGTS/INSS, boleto anexado). "Todas"
// mostra também essas e as NF-e. Folha, transferência, encontro de contas e
// conta do Consumer ficam de fora (têm fluxo próprio).
// Nada aqui manda dinheiro: a baixa usa a rota de sempre
// (/api/financeiro/contas/[id]/baixas) e a chave, a do cadastro de fornecedor.
// EXCEÇÃO desde 20/10/2026 (pedido do dono): "💸 Pagar" (um Pix por conta) manda o Pix
// pela API de pagamentos do Inter (só Admin, tabela pix_pagamento) e dá a
// baixa quando o banco confirma. O caminho de copiar + baixa continua igual.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, eq, isNull, lte, notInArray, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl } from '@/lib/format';
import { hojeBr, diasAtrasBr } from '@/lib/datas';
import { GrupoPix, type GrupoPedidos } from './grupo-pix';
import { PixEnviados, type PixEnviado } from './pix-enviados';
import { contasEmPixAberto, podePagarPix } from '@/lib/pix-pagamento';
import { resolverCredenciaisInterPagamentos } from '@/lib/inter';
import { urlFotoPedido } from '@/lib/pedido-sem-nota';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  ate?: string;
  ver?: string;
}

const ORIGENS_FORA = ['CONSUMER', 'FOLHA', 'TRANSFERENCIA', 'ENCONTRO_CONTAS'];

/** Conta com cara de boleto ou guia — não se paga por Pix ao fornecedor. */
function pareceBoleto(descricao: string, fornecedor: string, temBoleto: boolean) {
  if (temBoleto) return true;
  if (/(darf|fgts|inss|guia|boleto)/i.test(descricao)) return true;
  if (/\b\d{1,2}\s*\/\s*\d{1,2}\b/.test(descricao)) return true; // parcela "2/4"
  if (/^receita\b/i.test(fornecedor.trim())) return true;
  return false;
}

export default async function PedidosPixPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'conta_pagar.read');

  const sp = await props.searchParams;
  const filiais = await filiaisDoUsuario(user.id);
  const escolhidaX = await escolherFilial(filiais, sp.filialId);

  const hoje = hojeBr();
  const ate = sp.ate && /^\d{4}-\d{2}-\d{2}$/.test(sp.ate) ? sp.ate : diasAtrasBr(-7);
  const verTodas = sp.ver === 'todas';

  const [podeBaixar, podeEditarFornecedor] = await Promise.all([
    podeUsuario(user.id, 'conta_pagar.marcar_pago'),
    podeUsuario(user.id, 'fornecedor.update'),
  ]);

  function href(next: Partial<SP>): string {
    const qs = new URLSearchParams();
    const f = next.filialId ?? escolhidaX?.id;
    if (f) qs.set('filialId', f);
    qs.set('ate', next.ate ?? ate);
    const v = next.ver ?? (verTodas ? 'todas' : '');
    if (v === 'todas') qs.set('ver', 'todas');
    return `/financeiro/pedidos-pix?${qs.toString()}`;
  }

  if (!escolhidaX) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <section className="mx-auto max-w-5xl px-4 py-10">
          <p className="text-sm text-slate-500">Nenhuma filial disponível.</p>
        </section>
      </main>
    );
  }
  const escolhida = escolhidaX;

  // Pix pelo sistema (20/10/2026). Se a tabela falhar, a tela segue sem isso.
  const pagaPix = await podePagarPix(user.id).catch(() => false);
  const temInterPix = !!resolverCredenciaisInterPagamentos(escolhida.id);
  let travadas: string[] = [];
  let enviados: PixEnviado[] = [];
  try {
    travadas = [...(await contasEmPixAberto(escolhida.id))];
    type Row = {
      id: string;
      quando: string;
      favorecido: string | null;
      chave: string;
      valor: string;
      status: string;
      status_inter: string | null;
      codigo_solicitacao: string | null;
      erro: string | null;
      quem: string | null;
      baixado: boolean;
      qtd: number;
    };
    const rows = (await db.execute(sql`
      SELECT p.id, to_char(p.criado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS quando,
             p.favorecido, p.chave, p.valor::text AS valor, p.status, p.status_inter, p.codigo_solicitacao,
             p.erro, coalesce(u.nome, p.usuario_email) AS quem, (p.baixado_em IS NOT NULL) AS baixado,
             jsonb_array_length(p.conta_ids) AS qtd
        FROM pix_pagamento p
        LEFT JOIN usuario u ON u.id = p.usuario_id
       WHERE p.filial_id = ${escolhida.id}::uuid
         AND (p.criado_em > now() - interval '30 days'
              OR (p.baixado_em IS NULL AND p.status NOT IN ('ERRO','CANCELADO')))
       ORDER BY p.criado_em DESC
       LIMIT 50
    `)) as unknown as Row[];
    enviados = rows.map((r) => ({
      id: r.id,
      quando: r.quando,
      favorecido: r.favorecido,
      chave: r.chave,
      valor: Number(r.valor),
      status: r.status,
      statusInter: r.status_inter,
      codigo: r.codigo_solicitacao,
      erro: r.erro,
      quem: r.quem && r.quem.includes('@') ? r.quem.split('@')[0]! : r.quem,
      baixado: r.baixado,
      qtdContas: Number(r.qtd),
    }));
  } catch (e) {
    console.error('[pedidos-pix] pix enviados', e);
  }

  const c = schema.contaPagar;
  const f = schema.fornecedor;
  const linhas = await db
    .select({
      id: c.id,
      venc: sql<string>`${c.dataVencimento}::text`,
      valor: c.valor,
      descricao: c.descricao,
      origem: c.origem,
      temBoleto: sql<boolean>`(${c.boletoStoragePath} is not null)`,
      jaPago: sql<string>`coalesce((select sum(b.valor) from conta_pagar_baixa b where b.conta_pagar_id = ${c.id}), 0)::text`,
      fornecedorId: c.fornecedorId,
      fornecedorNome: f.nome,
      chavePix: f.chavePix,
      pixFavorecido: f.pixFavorecido,
      documento: f.cnpjOuCpf,
    })
    .from(c)
    .leftJoin(f, eq(f.id, c.fornecedorId))
    .where(
      and(
        eq(c.filialId, escolhida.id),
        isNull(c.dataPagamento),
        isNull(c.dataDelete),
        notInArray(c.origem, ORIGENS_FORA),
        lte(c.dataVencimento, ate),
      ),
    )
    .orderBy(c.dataVencimento);

  // Pedido ligado, quem lançou e quem conferiu (dono 20/10/2026). Consulta à
  // parte: se falhar, a tela continua igual, só sem essas linhas.
  type Origem = {
    id: string;
    nota_id: string | null;
    nota_numero: number | null;
    nota_origem: string | null;
    lancou_conta: string | null;
    lancou_estoque: string | null;
    conferida_em: string | null;
    conferiu: string | null;
    foto_pedido: string | null;
    fotos_extras: string[] | null;
    foto_boleto: string | null;
  };
  const origens = new Map<string, Origem>();
  if (linhas.length > 0) {
    try {
      const rows = (await db.execute(sql`
        SELECT c.id,
               n.id AS nota_id, n.numero AS nota_numero, n.origem_importacao AS nota_origem,
               coalesce(uc.nome, uc.email) AS lancou_conta,
               (SELECT coalesce(u2.nome, u2.email)
                  FROM movimento_estoque m
                  JOIN nota_compra_item i ON i.id = m.nota_compra_item_id
                  JOIN usuario u2 ON u2.id = m.criado_por
                 WHERE i.nota_compra_id = n.id
                 ORDER BY m.criado_em LIMIT 1) AS lancou_estoque,
               to_char(n.conferida_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS conferida_em,
               coalesce(ucf.nome, ucf.email) AS conferiu,
               CASE WHEN n.origem_importacao IN ('PEDIDO_FOTO', 'NFSE_PDF') THEN n.xml_storage_path END AS foto_pedido,
               CASE WHEN n.origem_importacao = 'PEDIDO_FOTO' THEN n.fotos_extras END AS fotos_extras,
               c.boleto_storage_path AS foto_boleto
          FROM conta_pagar c
          LEFT JOIN usuario uc ON uc.id = c.criado_por
          LEFT JOIN nota_compra n ON n.id = coalesce(
                 c.nota_compra_id,
                 (SELECT d.nota_compra_id FROM nota_compra_duplicata d WHERE d.conta_pagar_id = c.id LIMIT 1))
          LEFT JOIN usuario ucf ON ucf.id = n.conferida_por
         WHERE c.id IN (${sql.join(
           linhas.map((l) => sql`${l.id}::uuid`),
           sql`, `,
         )})
      `)) as unknown as Origem[];
      for (const r of rows) origens.set(r.id, r);
    } catch (e) {
      console.error('[pedidos-pix] origem dos pedidos', e);
    }
  }

  let escondidas = 0;
  const grupos = new Map<string, GrupoPedidos>();
  for (const l of linhas) {
    const descricao = l.descricao ?? '';
    const nome = l.fornecedorNome ?? '';
    const temChave = !!l.chavePix?.trim();
    const semNota = /pedido sem nota/i.test(descricao);
    const boleto = pareceBoleto(descricao, nome, l.temBoleto);
    const ehPix = semNota || (!boleto && (l.origem === 'MANUAL' || temChave));
    if (!ehPix && !verTodas) {
      escondidas += 1;
      continue;
    }
    const saldo = Number(l.valor) - Number(l.jaPago);
    if (saldo <= 0.005) continue;
    const chave = l.fornecedorId ?? 'sem-fornecedor';
    let g = grupos.get(chave);
    if (!g) {
      g = {
        fornecedorId: l.fornecedorId,
        nome: l.fornecedorNome ?? 'Sem fornecedor',
        documento: l.documento,
        chavePix: l.chavePix,
        pixFavorecido: l.pixFavorecido,
        contas: [],
      };
      grupos.set(chave, g);
    }
    g.contas.push({
      id: l.id,
      venc: l.venc,
      descricao: descricao || '—',
      valor: Number(l.valor),
      saldo,
      parcial: Number(l.jaPago) > 0,
      pareceBoleto: !ehPix,
      origem: (() => {
        const o = origens.get(l.id);
        if (!o) return undefined;
        return {
          notaId: o.nota_id,
          notaNumero: o.nota_numero,
          ehPedidoFoto: o.nota_origem === 'PEDIDO_FOTO',
          lancouConta: o.lancou_conta,
          lancouEstoque: o.lancou_estoque,
          conferidaEm: o.conferida_em,
          conferiu: o.conferiu,
          // Foto do pedido (tirada ou subida no lançamento) e do boleto anexado
          // na conta, pra conferir antes de pagar (dono 20/10/2026).
          fotos: [
            ...[o.foto_pedido, ...(o.fotos_extras ?? [])].flatMap((p, i) => {
              const url = urlFotoPedido(p);
              return url ? [{ url, rotulo: i === 0 ? (o.nota_origem === 'NFSE_PDF' ? 'nota' : 'pedido') : `pedido ${i + 1}` }] : [];
            }),
            ...(urlFotoPedido(o.foto_boleto) ? [{ url: urlFotoPedido(o.foto_boleto)!, rotulo: 'boleto' }] : []),
          ],
        };
      })(),
    });
  }

  // mais atrasado primeiro
  const lista = [...grupos.values()].sort((a, b) => a.contas[0]!.venc.localeCompare(b.contas[0]!.venc));
  const total = lista.reduce((s, g) => s + g.contas.reduce((t, x) => t + x.saldo, 0), 0);
  const vencido = lista.reduce(
    (s, g) => s + g.contas.filter((x) => x.venc <= hoje).reduce((t, x) => t + x.saldo, 0),
    0,
  );
  const qtd = lista.reduce((s, g) => s + g.contas.length, 0);
  const semChave = lista.filter((g) => g.fornecedorId && !g.chavePix?.trim()).length;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900">Pedidos a pagar por Pix</h1>
          <div className="flex shrink-0 gap-2">
            <Link
              href={`/financeiro/pix-inter?filialId=${escolhida.id}`}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Pix pagos no Inter
            </Link>
            <Link
              href={`/financeiro?filialId=${escolhida.id}`}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Contas a pagar
            </Link>
          </div>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Pedidos em aberto por fornecedor, com a chave Pix e o valor pra copiar. Você paga no app
          do Inter e volta aqui pra dar a baixa. Nenhum dinheiro sai por esta tela.
          {pagaPix && (
            <>
              {' '}
              <b className="font-medium text-violet-800">
                Exceção: o botão 💸 Pagar de cada conta manda o Pix daquela conta pelo Inter (um Pix por nota)
                {temInterPix ? '' : ' (esta casa ainda não tem a integração de pagamentos do Inter)'}.
              </b>
            </>
          )}
        </p>

        {filiais.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Casa:</span>
            {filiais.map((fl) => (
              <Link
                key={fl.id}
                href={href({ filialId: fl.id })}
                className={`rounded-md border px-3 py-1 text-xs ${
                  fl.id === escolhida.id
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {fl.nome}
              </Link>
            ))}
          </div>
        )}

        <form
          action="/financeiro/pedidos-pix"
          method="GET"
          className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <input type="hidden" name="filialId" value={escolhida.id} />
          {verTodas && <input type="hidden" name="ver" value="todas" />}
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Vencendo até
            </label>
            <input
              type="date"
              name="ate"
              defaultValue={ate}
              className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm"
            />
          </div>
          <button className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
            Ver
          </button>
          <div className="ml-auto flex gap-1 text-xs">
            <Link
              href={href({ ver: '' })}
              className={`rounded-md border px-3 py-1.5 ${
                !verTodas ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700'
              }`}
            >
              Só pedidos
            </Link>
            <Link
              href={href({ ver: 'todas' })}
              className={`rounded-md border px-3 py-1.5 ${
                verTodas ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700'
              }`}
            >
              Todas (com boletos e NF-e)
            </Link>
          </div>
        </form>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Resumo rotulo="Em aberto" valor={brl(total)} sub={`${qtd} conta(s)`} />
          <Resumo rotulo="Vencido até hoje" valor={brl(vencido)} destaque={vencido > 0} />
          <Resumo rotulo="Fornecedores" valor={String(lista.length)} />
          <Resumo
            rotulo="Sem chave Pix"
            valor={String(semChave)}
            sub={semChave > 0 ? 'cadastre no card' : undefined}
            destaque={semChave > 0}
          />
        </div>
        {!verTodas && escondidas > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            {escondidas} conta(s) com cara de boleto, guia ou NF-e ficaram de fora —{' '}
            <Link href={href({ ver: 'todas' })} className="underline">
              ver todas
            </Link>
            .
          </p>
        )}

        <div className="mt-6 space-y-4">
          {lista.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
              Nenhum pedido em aberto vencendo até {ate.split('-').reverse().join('/')}.
            </p>
          ) : (
            lista.map((g) => (
              <GrupoPix
                key={g.fornecedorId ?? 'sem-fornecedor'}
                grupo={g}
                hoje={hoje}
                podeBaixar={podeBaixar}
                podeEditarFornecedor={podeEditarFornecedor}
                filialId={escolhida.id}
                podePagarPix={pagaPix}
                temInterPix={temInterPix}
                contasTravadas={travadas}
              />
            ))
          )}
        </div>

        <PixEnviados itens={enviados} podeMexer={pagaPix} />
      </section>
    </main>
  );
}

function Resumo({
  rotulo,
  valor,
  sub,
  destaque,
}: {
  rotulo: string;
  valor: string;
  sub?: string;
  destaque?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3 shadow-sm ${
        destaque ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{rotulo}</div>
      <div className="mt-0.5 text-lg font-bold text-slate-900">{valor}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}
