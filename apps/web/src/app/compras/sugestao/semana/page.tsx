// Lista da semana (cozinha): a lista que a cozinha manda fica salva como
// SUGESTÃO (lista_compra), ao lado do que foi pedido nas semanas anteriores,
// do estoque e da última entrada. Nada é disparado sozinho: a cotação de cada
// grupo sai no clique, com os fornecedores da última vez já marcados.
// Semana sem lista → a sugestão é montada pelo histórico (mediana das últimas
// 3 semanas, só o que apareceu em pelo menos 2 delas).
// Pelo ritmo de pedido (dono 20/10/2026): de quanto em quanto tempo cada item é
// pedido — o que vence nesta semana aparece num bloco à parte, com "+ pôr na
// lista". Pedir toda semana com estoque no sistema = estoque errado (⚠).

import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, asc, eq, ilike, isNull, not, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { diasAtrasBr, hojeBr } from '@/lib/datas';
import { fornecedoresDeOutrasCasas } from '@/lib/fornecedor-unico';
import type { FornecedorOpt } from '../sugestao-client';
import { ListaSemanaClient, type LinhaLista, type SemanaCol } from './lista-semana-client';
import { GRUPOS } from './grupos';
import { calcularRitmo, type OcorrenciaCompra } from '@/lib/ritmo-compra';
import type { LinhaRitmo } from './lista-semana-client';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  lista?: string;
}

type Row = Record<string, unknown>;

/** Grupo da cotação pelo começo da observação ("PROTEÍNAS, PESCADOS... — lista da cozinha de 08/09"). */
function grupoDaObs(obs: string | null): string | null {
  const o = (obs ?? '').toUpperCase();
  if (o.startsWith('PROTE') || o.startsWith('PEIXES') || o.startsWith('PESCADOS')) return 'PROTEINAS';
  if (o.startsWith('MERCEARIA')) return 'MERCEARIA';
  if (o.startsWith('HORTI') || o.startsWith('VERDURAS')) return 'HORTIFRUTI';
  if (o.startsWith('LIMPEZA')) return 'LIMPEZA';
  return null;
}

/** Segunda-feira da semana de uma data YYYY-MM-DD (mesma conta do date_trunc('week')). */
function segundaDe(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function mediana(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export default async function ListaSemanaPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'cotacao.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialEscolhida = await escolherFilial(filiais, sp.filialId);
  if (!filialEscolhida) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-7xl px-6 py-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
      </main>
    );
  }
  const filial = filialEscolhida;

  // ——— Lista atual: a pedida na URL, senão a ABERTA mais recente, senão a última.
  const listas = (await db.execute(sql`
    SELECT id, data, titulo, origem, status
    FROM lista_compra
    WHERE filial_id = ${filial.id}
    ORDER BY data DESC, criado_em DESC
    LIMIT 12
  `)) as unknown as Row[];
  const lista =
    (sp.lista && listas.find((l) => String(l.id) === sp.lista)) ||
    listas.find((l) => l.status === 'ABERTA') ||
    null;

  // ——— Histórico por semana: cotações da cozinha (observação "lista da cozinha" /
  // "lista da Marcia", sem as reaberturas) + as outras listas salvas.
  const histCot = (await db.execute(sql`
    SELECT c.id AS cotacao_id, c.numero, c.observacao,
           (c.aberta_em AT TIME ZONE 'America/Sao_Paulo')::date::text AS data,
           ci.produto_id, ci.quantidade, ci.unidade
    FROM cotacao c
    JOIN cotacao_item ci ON ci.cotacao_id = c.id
    WHERE c.filial_id = ${filial.id}
      AND (c.observacao ILIKE '%lista da cozinha%' OR c.observacao ILIKE '%lista da marcia%' OR c.observacao ILIKE '%lista da márcia%')
      AND c.observacao NOT ILIKE 'reabertura%'
      AND c.observacao NOT ILIKE '%rodada%'
      AND c.observacao NOT ILIKE '%teste%'
      AND NOT EXISTS (SELECT 1 FROM lista_compra_item li WHERE li.cotacao_id = c.id)
  `)) as unknown as Row[];
  const histLista = (await db.execute(sql`
    SELECT l.id AS lista_id, l.data, li.produto_id, li.quantidade, li.unidade, li.grupo
    FROM lista_compra l
    JOIN lista_compra_item li ON li.lista_id = l.id
    WHERE l.filial_id = ${filial.id}
      AND li.produto_id IS NOT NULL
      ${lista ? sql`AND l.id <> ${String(lista.id)}` : sql``}
  `)) as unknown as Row[];

  // semana (data) → produto → { qtd, unidade }
  const porSemana = new Map<string, Map<string, { q: number; u: string | null }>>();
  const grupoPorProduto = new Map<string, string>();
  function soma(data: string, pid: string, q: number, u: string | null) {
    if (!porSemana.has(data)) porSemana.set(data, new Map());
    const m = porSemana.get(data)!;
    const ja = m.get(pid);
    m.set(pid, { q: (ja?.q ?? 0) + q, u: u ?? ja?.u ?? null });
  }
  for (const r of histCot) {
    if (!r.produto_id) continue;
    soma(String(r.data), String(r.produto_id), Number(r.quantidade ?? 0), r.unidade ? String(r.unidade) : null);
    const g = grupoDaObs(r.observacao ? String(r.observacao) : null);
    if (g) grupoPorProduto.set(String(r.produto_id), g);
  }
  for (const r of histLista) {
    soma(String(r.data), String(r.produto_id), Number(r.quantidade ?? 0), r.unidade ? String(r.unidade) : null);
    if (r.grupo) grupoPorProduto.set(String(r.produto_id), String(r.grupo));
  }
  const dataLista = lista ? String(lista.data) : null;
  const semanas = Array.from(porSemana.keys())
    .filter((d) => !dataLista || d < dataLista)
    .sort()
    .reverse()
    .slice(0, 4);
  const semanaCols: SemanaCol[] = semanas.map((d) => ({ data: d, rotulo: `${d.slice(8, 10)}/${d.slice(5, 7)}` }));

  // ——— Linhas: da lista atual, ou montadas pelo histórico.
  interface Base {
    listaItemId: string | null;
    produtoId: string | null;
    textoOriginal: string | null;
    quantidade: number;
    unidade: string;
    observacao: string;
    grupo: string;
    cotacaoNumero: number | null;
    cotacaoId: string | null;
    ordem: number;
  }
  let base: Base[] = [];
  if (lista) {
    const itens = (await db.execute(sql`
      SELECT li.id, li.produto_id, li.texto_original, li.quantidade, li.unidade, li.observacao,
             li.grupo, li.ordem, li.cotacao_id, c.numero AS cotacao_numero
      FROM lista_compra_item li
      LEFT JOIN cotacao c ON c.id = li.cotacao_id
      WHERE li.lista_id = ${String(lista.id)}
      ORDER BY li.ordem NULLS LAST, li.criado_em
    `)) as unknown as Row[];
    base = itens.map((r, i) => ({
      listaItemId: String(r.id),
      produtoId: r.produto_id ? String(r.produto_id) : null,
      textoOriginal: r.texto_original ? String(r.texto_original) : null,
      quantidade: Number(r.quantidade ?? 0),
      unidade: r.unidade ? String(r.unidade) : '',
      observacao: r.observacao ? String(r.observacao) : '',
      grupo: r.grupo ? String(r.grupo) : 'MERCEARIA',
      cotacaoNumero: r.cotacao_numero != null ? Number(r.cotacao_numero) : null,
      cotacaoId: r.cotacao_id ? String(r.cotacao_id) : null,
      ordem: Number(r.ordem ?? i),
    }));
  } else {
    const ultimas3 = semanas.slice(0, 3);
    const pids = new Set<string>();
    for (const d of ultimas3) for (const pid of porSemana.get(d)!.keys()) pids.add(pid);
    let ordem = 0;
    for (const pid of pids) {
      const vals = ultimas3.map((d) => porSemana.get(d)!.get(pid)).filter((x): x is { q: number; u: string | null } => !!x);
      if (vals.length < 2) continue;
      base.push({
        listaItemId: null,
        produtoId: pid,
        textoOriginal: null,
        quantidade: mediana(vals.map((v) => v.q)),
        unidade: vals[0].u ?? '',
        observacao: '',
        grupo: grupoPorProduto.get(pid) ?? 'MERCEARIA',
        cotacaoNumero: null,
        cotacaoId: null,
        ordem: ordem++,
      });
    }
  }

  // ——— Ritmo de pedido: listas + cotações da cozinha + pedidos de compra,
  // por semana (segunda-feira). Pedido só conta pra produto que já esteve numa
  // lista da cozinha (os outros pedidos da casa são do bar).
  const semanaRef = segundaDe(dataLista ?? hojeBr());
  const occRows = (await db.execute(sql`
    SELECT date_trunc('week', (c.aberta_em AT TIME ZONE 'America/Sao_Paulo')::date)::date::text AS sem,
           ci.produto_id::text AS pid, ci.quantidade::float AS q, ci.unidade AS u, 'L' AS f,
           c.observacao AS obs, NULL::text AS grupo
    FROM cotacao c JOIN cotacao_item ci ON ci.cotacao_id = c.id
    WHERE c.filial_id = ${filial.id}
      AND (c.observacao ILIKE '%lista da cozinha%' OR c.observacao ILIKE '%lista da marcia%' OR c.observacao ILIKE '%lista da márcia%')
      AND c.observacao NOT ILIKE 'reabertura%'
      AND c.observacao NOT ILIKE '%rodada%'
      AND c.observacao NOT ILIKE '%teste%'
      AND ci.produto_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM lista_compra_item li WHERE li.cotacao_id = c.id)
    UNION ALL
    SELECT date_trunc('week', l.data::date)::date::text, li.produto_id::text, li.quantidade::float, li.unidade, 'L',
           NULL, li.grupo
    FROM lista_compra l JOIN lista_compra_item li ON li.lista_id = l.id
    WHERE l.filial_id = ${filial.id} AND li.produto_id IS NOT NULL
    UNION ALL
    SELECT date_trunc('week', (pc.criado_em AT TIME ZONE 'America/Sao_Paulo')::date)::date::text, pci.produto_id::text,
           pci.quantidade::float, pci.unidade, 'P', NULL, NULL
    FROM pedido_compra pc JOIN pedido_compra_item pci ON pci.pedido_compra_id = pc.id
    WHERE pc.filial_id = ${filial.id} AND pc.status <> 'CANCELADO'
      AND pc.criado_em > now() - interval '120 days'
      AND pci.produto_id IS NOT NULL
  `)) as unknown as Row[];
  const grupoRitmo = new Map<string, string>();
  for (const r of occRows) {
    const g = r.grupo ? String(r.grupo) : grupoDaObs(r.obs ? String(r.obs) : null);
    if (g) grupoRitmo.set(String(r.pid), g);
  }
  const ocorrencias: OcorrenciaCompra[] = occRows
    .filter((r) => r.f !== 'P' || grupoRitmo.has(String(r.pid)))
    .map((r) => ({
      semana: String(r.sem),
      produtoId: String(r.pid),
      quantidade: Number(r.q ?? 0),
      unidade: r.u ? String(r.u) : null,
      fonte: r.f === 'P' ? 'P' : 'L',
    }));
  const ritmoItens = calcularRitmo(ocorrencias, (pid) => grupoRitmo.get(pid) ?? 'MERCEARIA', semanaRef);

  // ——— Produto: nome, estoque. Última entrada: nota casada, senão movimento.
  const ids = Array.from(
    new Set([...base.map((b) => b.produtoId), ...ritmoItens.map((r) => r.produtoId)].filter((x): x is string => !!x)),
  );
  const idsSql = ids.length ? sql.raw(`(${ids.map((i) => `'${i}'`).join(',')})`) : null;
  const produtos = idsSql
    ? ((await db.execute(sql`
        SELECT id, nome, unidade_estoque, estoque_atual, categoria_compras
        FROM produto WHERE filial_id = ${filial.id} AND id IN ${idsSql}
      `)) as unknown as Row[])
    : [];
  const prodPorId = new Map(produtos.map((p) => [String(p.id), p]));
  const ultEntrada = new Map<string, { q: number; data: string; fornecedor: string | null }>();
  if (idsSql) {
    const notas = (await db.execute(sql`
      SELECT DISTINCT ON (nci.produto_id) nci.produto_id, nci.quantidade, nci.unidade,
             -- quantidade na unidade do produto (10 CX → 240 un): o que entrou
             -- no estoque, senão o fator do vínculo com a mesma unidade da nota
             COALESCE(
               (SELECT SUM(m.quantidade) FROM movimento_estoque m
                 WHERE m.nota_compra_item_id = nci.id AND m.tipo = 'ENTRADA_COMPRA'),
               nci.quantidade * (SELECT pf.fator_conversao FROM produto_fornecedor pf
                 WHERE pf.produto_id = nci.produto_id AND UPPER(pf.unidade_fornecedor) = UPPER(nci.unidade)
                   AND pf.fator_conversao > 0 LIMIT 1)
             ) AS qtd_produto,
             COALESCE(nc.data_entrada, nc.data_emissao)::date::text AS data, nc.emit_nome
      FROM nota_compra_item nci JOIN nota_compra nc ON nc.id = nci.nota_compra_id
      WHERE nci.filial_id = ${filial.id} AND nci.produto_id IN ${idsSql}
      ORDER BY nci.produto_id, COALESCE(nc.data_entrada, nc.data_emissao) DESC
    `)) as unknown as Row[];
    for (const r of notas)
      ultEntrada.set(String(r.produto_id), {
        q: Number(r.qtd_produto ?? r.quantidade ?? 0),
        data: String(r.data),
        fornecedor: r.emit_nome ? String(r.emit_nome) : null,
      });
    const movs = (await db.execute(sql`
      SELECT DISTINCT ON (m.produto_id) m.produto_id, m.quantidade, m.data_hora::date::text AS data
      FROM movimento_estoque m
      WHERE m.filial_id = ${filial.id} AND m.tipo = 'ENTRADA_COMPRA' AND m.produto_id IN ${idsSql}
      ORDER BY m.produto_id, m.data_hora DESC
    `)) as unknown as Row[];
    for (const r of movs) {
      const pid = String(r.produto_id);
      const ja = ultEntrada.get(pid);
      if (!ja || String(r.data) > ja.data)
        ultEntrada.set(pid, { q: Number(r.quantidade ?? 0), data: String(r.data), fornecedor: ja?.fornecedor ?? null });
    }
  }

  const linhas: LinhaLista[] = base.map((b, i) => {
    const p = b.produtoId ? prodPorId.get(b.produtoId) : undefined;
    const ent = b.produtoId ? ultEntrada.get(b.produtoId) : undefined;
    return {
      chave: b.listaItemId ?? `h${i}`,
      listaItemId: b.listaItemId,
      produtoId: b.produtoId,
      nome: p?.nome ? String(p.nome) : b.textoOriginal ?? '(sem produto)',
      textoOriginal: b.textoOriginal,
      quantidade: b.quantidade,
      unidade: b.unidade || (p?.unidade_estoque ? String(p.unidade_estoque) : 'un'),
      observacao: b.observacao,
      grupo: GRUPOS.some((g) => g.codigo === b.grupo) ? b.grupo : 'MERCEARIA',
      cotacaoNumero: b.cotacaoNumero,
      cotacaoId: b.cotacaoId,
      historico: Object.fromEntries(
        semanas.map((d) => {
          const h = b.produtoId ? porSemana.get(d)?.get(b.produtoId) : undefined;
          return [d, h ? { q: h.q, u: h.u } : null];
        }),
      ),
      estoque: p?.estoque_atual != null ? Number(p.estoque_atual) : null,
      unidadeEstoque: p?.unidade_estoque ? String(p.unidade_estoque) : null,
      ultEntradaQtd: ent?.q ?? null,
      ultEntradaData: ent?.data ?? null,
      ultEntradaFornecedor: ent?.fornecedor ?? null,
    };
  });

  // ——— Linhas do ritmo: prontas pra entrar na lista no "+ pôr na lista".
  // Entradas de compra no estoque nos últimos 60 dias, pra apontar quando a
  // cozinha pede sempre e o estoque não registra a compra.
  const entradas60 = new Map<string, number>();
  if (idsSql) {
    const ents = (await db.execute(sql`
      SELECT m.produto_id, COUNT(*)::int AS n
      FROM movimento_estoque m
      WHERE m.filial_id = ${filial.id} AND m.tipo = 'ENTRADA_COMPRA' AND m.produto_id IN ${idsSql}
        AND m.data_hora >= ${diasAtrasBr(60)}::date
      GROUP BY m.produto_id
    `)) as unknown as Row[];
    for (const r of ents) entradas60.set(String(r.produto_id), Number(r.n));
  }
  const ritmo: LinhaRitmo[] = [];
  for (const r of ritmoItens) {
    const p = prodPorId.get(r.produtoId);
    if (!p) continue;
    const ent = ultEntrada.get(r.produtoId);
    const estoque = p.estoque_atual != null ? Number(p.estoque_atual) : null;
    const uEst = p.unidade_estoque ? String(p.unidade_estoque) : '';
    let alerta: string | null = null;
    if ((r.ritmo === 'SEMANAL' || r.ritmo === 'QUINZENAL') && r.vezes >= 2) {
      if (estoque != null && estoque > 0)
        alerta = `estoque não confere: o sistema diz ${estoque.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${uEst} e a cozinha pede ${r.ritmo === 'SEMANAL' ? 'toda semana' : 'de 15 em 15 dias'}`;
      else if (!entradas60.get(r.produtoId))
        alerta = 'compra não dá entrada no estoque (nenhuma entrada em 60 dias)';
    }
    ritmo.push({
      linha: {
        chave: `r-${r.produtoId}`,
        listaItemId: null,
        produtoId: r.produtoId,
        nome: p.nome ? String(p.nome) : '(sem nome)',
        textoOriginal: null,
        quantidade: r.quantidade,
        unidade: r.unidade || uEst || 'un',
        observacao: '',
        grupo: GRUPOS.some((g) => g.codigo === r.grupo) ? r.grupo : 'MERCEARIA',
        cotacaoNumero: null,
        cotacaoId: null,
        historico: Object.fromEntries(
          semanas.map((d) => {
            const h = porSemana.get(d)?.get(r.produtoId);
            return [d, h ? { q: h.q, u: h.u } : null];
          }),
        ),
        estoque,
        unidadeEstoque: uEst || null,
        ultEntradaQtd: ent?.q ?? null,
        ultEntradaData: ent?.data ?? null,
        ultEntradaFornecedor: ent?.fornecedor ?? null,
      },
      ritmo: r.ritmo,
      vezes: r.vezes,
      semanas: r.semanas,
      marcas: r.marcas,
      intervalo: r.intervalo,
      desde: r.desde,
      ultimaSemana: r.ultimaSemana,
      vence: r.vence,
      alerta,
    });
  }

  // ——— Fornecedores da última cotação de cada grupo (já marcados no clique).
  const ultimosForn = (await db.execute(sql`
    SELECT c.observacao, c.numero, cf.fornecedor_id
    FROM cotacao c JOIN cotacao_fornecedor cf ON cf.cotacao_id = c.id
    WHERE c.filial_id = ${filial.id}
      AND c.observacao ILIKE '%lista da cozinha%'
    ORDER BY c.aberta_em DESC
  `)) as unknown as Row[];
  const fornPorGrupo: Record<string, string[]> = {};
  const cotacaoDoGrupo: Record<string, number> = {};
  for (const r of ultimosForn) {
    const g = grupoDaObs(r.observacao ? String(r.observacao) : null);
    if (!g) continue;
    const n = Number(r.numero);
    if (cotacaoDoGrupo[g] == null) cotacaoDoGrupo[g] = n;
    if (cotacaoDoGrupo[g] !== n) continue;
    (fornPorGrupo[g] ??= []).push(String(r.fornecedor_id));
  }

  // Fornecedor de categoria "Pescados" (mariscos, catados, camarão) entra
  // marcado na cotação de proteínas mesmo sem ter ido na última — sem repetir
  // número de WhatsApp que já está na lista (1 convite por número).
  const pescados = (await db.execute(sql`
    SELECT f.id,
           COALESCE(
             (SELECT v.whatsapp FROM vendedor_fornecedor vf JOIN vendedor v ON v.id = vf.vendedor_id
               WHERE vf.fornecedor_id = f.id AND v.ativo AND v.whatsapp IS NOT NULL
               ORDER BY vf.principal DESC LIMIT 1),
             NULLIF(f.fone_whatsapp, ''), NULLIF(f.fone_principal, '')
           ) AS zap
    FROM fornecedor f
    WHERE f.filial_id = ${filial.id}
      AND f.ativo_compras AND f.data_delete IS NULL
      AND f.categoria_compras = 'Pescados'
  `)) as unknown as Row[];
  if (pescados.length) {
    const ja = new Set(fornPorGrupo.PROTEINAS ?? []);
    const zapsJa = (await db.execute(sql`
      SELECT DISTINCT COALESCE(
        (SELECT v.whatsapp FROM vendedor_fornecedor vf JOIN vendedor v ON v.id = vf.vendedor_id
          WHERE vf.fornecedor_id = f.id AND v.ativo AND v.whatsapp IS NOT NULL
          ORDER BY vf.principal DESC LIMIT 1),
        NULLIF(f.fone_whatsapp, ''), NULLIF(f.fone_principal, '')
      ) AS zap
      FROM fornecedor f
      WHERE f.id = ANY(ARRAY[${sql.join([...ja, '00000000-0000-0000-0000-000000000000'].map((x) => sql`${x}`), sql`, `)}]::uuid[])
    `)) as unknown as Row[];
    const so = (z: unknown) => String(z ?? '').replace(/\D/g, '').slice(-8);
    const zaps = new Set(zapsJa.map((r) => so(r.zap)).filter(Boolean));
    for (const p of pescados) {
      const id = String(p.id);
      const z = so(p.zap);
      if (ja.has(id) || (z && zaps.has(z))) continue;
      (fornPorGrupo.PROTEINAS ??= []).push(id);
      ja.add(id);
      if (z) zaps.add(z);
    }
  }

  const fornecedores = await db
    .select({
      id: schema.fornecedor.id,
      nome: schema.fornecedor.nome,
      categoria: schema.fornecedor.categoriaCompras,
      valorPedidoMinimo: schema.fornecedor.valorPedidoMinimo,
    })
    .from(schema.fornecedor)
    .where(
      and(
        eq(schema.fornecedor.filialId, filial.id),
        eq(schema.fornecedor.ativoCompras, true),
        isNull(schema.fornecedor.dataDelete),
        not(ilike(schema.fornecedor.nome, '%*excluído%')),
        not(ilike(schema.fornecedor.nome, '%excluido%')),
      ),
    )
    .orderBy(asc(schema.fornecedor.nome));
  const fornecedorOpts: FornecedorOpt[] = fornecedores.map((f) => ({
    id: f.id,
    nome: f.nome ?? '(sem nome)',
    categoria: f.categoria,
    valorPedidoMinimo: f.valorPedidoMinimo != null ? Number(f.valorPedidoMinimo) : null,
  }));
  for (const f of await fornecedoresDeOutrasCasas(filial.id)) {
    fornecedorOpts.push({
      id: f.id,
      nome: f.nome ?? '(sem nome)',
      categoria: f.categoria,
      valorPedidoMinimo: f.valorPedidoMinimo != null ? Number(f.valorPedidoMinimo) : null,
      outraCasa: f.casa,
    });
  }

  // ——— O que saiu: faturamento dos últimos 7 dias × média das 4 semanas antes.
  const [fat] = (await db.execute(sql`
    SELECT
      COALESCE(SUM(valor_total) FILTER (WHERE data_fechamento >= ${diasAtrasBr(7)}::date), 0) AS semana,
      COALESCE(SUM(valor_total) FILTER (WHERE data_fechamento < ${diasAtrasBr(7)}::date), 0) / 4 AS media
    FROM pedido
    WHERE filial_id = ${filial.id}
      AND data_delete IS NULL
      AND data_fechamento >= ${diasAtrasBr(35)}::date
  `)) as unknown as Row[];
  const fatSemana = Number(fat?.semana ?? 0);
  const fatMedia = Number(fat?.media ?? 0);
  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Lista da semana — cozinha</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              {filial.nome} ·{' '}
              {lista
                ? `${String(lista.titulo ?? 'Lista')} · ${linhas.length} item(ns) · ${
                    lista.status === 'COTADA' ? 'já cotada' : 'sugestão aberta'
                  }`
                : `sem lista salva — sugestão pelo histórico (${linhas.length} item(ns))`}
            </p>
          </div>
          <a href={`/compras/sugestao?filialId=${filial.id}`} className="text-xs text-blue-700 underline">
            ← Sugestão pela venda e estoque mínimo
          </a>
        </div>

        {filiais.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {filiais.map((f) => (
              <a
                key={f.id}
                href={`?filialId=${f.id}`}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  f.id === filial.id
                    ? 'border-blue-500 bg-blue-50 font-medium text-blue-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {f.nome}
              </a>
            ))}
          </div>
        )}

        {listas.length > 1 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">Listas salvas:</span>
            {listas.map((l) => (
              <a
                key={String(l.id)}
                href={`?filialId=${filial.id}&lista=${String(l.id)}`}
                className={`rounded border px-2 py-1 ${
                  lista && String(l.id) === String(lista.id)
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                {String(l.data).slice(8, 10)}/{String(l.data).slice(5, 7)}
                {l.status === 'COTADA' ? ' ✓' : ''}
              </a>
            ))}
          </div>
        )}

        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600">
          <b className="text-slate-800">O que saiu:</b> faturamento dos últimos 7 dias {brl(fatSemana)} · média
          semanal das 4 semanas anteriores {brl(fatMedia)}
          {fatMedia > 0 && (
            <>
              {' '}
              (
              <b className={fatSemana >= fatMedia ? 'text-emerald-700' : 'text-amber-700'}>
                {fatSemana >= fatMedia ? '+' : ''}
                {Math.round(((fatSemana - fatMedia) / fatMedia) * 100)}%
              </b>
              )
            </>
          )}
          . Os insumos da cozinha quase não têm baixa de estoque, então a base da sugestão são as listas e
          os pedidos das semanas anteriores; estoque e última entrada aparecem pra conferir.
          {' '}O bloco <b className="text-slate-800">Pelo ritmo de pedido</b> mostra o que a cozinha costuma pedir
          toda semana, de 15 em 15 dias ou 1 vez por mês, e o que vence nesta semana.
        </div>

        {/* key: ao salvar a sugestão, a tela troca pra lista salva e remonta com os
            ids dos itens — sem isso a cotação seguinte saía sem ligar aos itens (20/10). */}
        <ListaSemanaClient
          key={lista ? String(lista.id) : 'historico'}
          filialId={filial.id}
          listaId={lista ? String(lista.id) : null}
          dataLista={dataLista}
          hoje={hojeBr()}
          linhas={linhas}
          semanas={semanaCols}
          fornecedores={fornecedorOpts}
          fornecedoresPorGrupo={fornPorGrupo}
          cotacaoAnteriorPorGrupo={cotacaoDoGrupo}
          ritmo={ritmo}
        />
      </div>
    </main>
  );
}
