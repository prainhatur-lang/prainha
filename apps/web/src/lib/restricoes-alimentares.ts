// Cardápio inclusivo completo (desenho de 15/10/2026).
//
// A marca diz o que o insumo / prato CONTÉM (comida e bebida). O prato herda
// dos insumos pela ficha técnica DA CASA; casa sem ficha daquele prato usa a
// ficha do prato de mesmo nome noutra casa (hoje só a Prainha Mar tem ficha
// na nuvem). Marca manual no prato soma o que não está na ficha (ex.: gergelim
// na finalização).
//
// Tudo é guardado pelo NOME normalizado → marca e revisão valem nas 3 casas.
// A revisão guarda exatamente a lista conferida: se o cálculo de uma casa der
// outra lista, o prato volta pra "a revisar" só lá.
//
// O cliente (QR da mesa) só vê o prato REVISADO que não contém nada do que ele
// marcou. Vegetariano e vegano são calculados.

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

export interface RestricaoDef {
  codigo: string;
  rotulo: string;
  emoji: string;
  grupo: 'Alergias' | 'Intolerâncias' | 'Dietas' | 'Bebidas';
}

/** Lista fixa, igual nas 3 casas. A ordem é a da tela. */
export const RESTRICOES: RestricaoDef[] = [
  { codigo: 'crustaceos', rotulo: 'Crustáceos', emoji: '🦐', grupo: 'Alergias' },
  { codigo: 'moluscos', rotulo: 'Moluscos', emoji: '🦪', grupo: 'Alergias' },
  { codigo: 'peixe', rotulo: 'Peixe', emoji: '🐟', grupo: 'Alergias' },
  { codigo: 'amendoim', rotulo: 'Amendoim', emoji: '🥜', grupo: 'Alergias' },
  { codigo: 'castanhas', rotulo: 'Castanhas e nozes', emoji: '🌰', grupo: 'Alergias' },
  { codigo: 'ovo', rotulo: 'Ovo', emoji: '🥚', grupo: 'Alergias' },
  { codigo: 'soja', rotulo: 'Soja', emoji: '🫘', grupo: 'Alergias' },
  { codigo: 'gergelim', rotulo: 'Gergelim', emoji: '⚪', grupo: 'Alergias' },
  { codigo: 'gluten', rotulo: 'Glúten', emoji: '🌾', grupo: 'Intolerâncias' },
  { codigo: 'lactose', rotulo: 'Lactose / leite', emoji: '🥛', grupo: 'Intolerâncias' },
  { codigo: 'carne', rotulo: 'Carne vermelha', emoji: '🥩', grupo: 'Dietas' },
  { codigo: 'porco', rotulo: 'Porco', emoji: '🐷', grupo: 'Dietas' },
  { codigo: 'frango', rotulo: 'Frango', emoji: '🍗', grupo: 'Dietas' },
  { codigo: 'alcool', rotulo: 'Álcool', emoji: '🍺', grupo: 'Bebidas' },
  { codigo: 'acucar', rotulo: 'Açúcar', emoji: '🍬', grupo: 'Bebidas' },
];
export const CODIGOS = new Set(RESTRICOES.map((r) => r.codigo));

/** Sem acento, minúsculo, espaços únicos — a chave que liga as casas. */
export function normNome(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export async function organizacaoDaFilial(filialId: string): Promise<string | null> {
  const r = (await db.execute(
    sql`SELECT organizacao_id FROM filial WHERE id = ${filialId}`,
  )) as unknown as Array<{ organizacao_id: string }>;
  return r[0]?.organizacao_id ?? null;
}

export interface PratoCalculado {
  produtoId: string;
  codigoExterno: number | null;
  nome: string;
  nomeNorm: string;
  noMenu: boolean;
  /** categoria do cardápio (etiqueta do Consumer: Pratos, Petiscos, Vinho…) */
  categoria: string;
  /** de onde veio a ficha: 'casa', nome da outra casa, ou null (sem ficha) */
  fichaFonte: string | null;
  insumos: string[];
  /** restrição → de onde veio ("Aratu catado", "marcado no prato") */
  contem: Record<string, string[]>;
  manual: string[];
  /** lista ordenada que vai pra revisão */
  assinatura: string;
  revisado: boolean;
  /** já foi revisado (nesta ou noutra casa) com OUTRA lista */
  revisaoDiverge: boolean;
  revisadoPor: string | null;
  revisadoEm: string | null;
}

export interface InsumoLinha {
  nome: string;
  nomeNorm: string;
  marcas: string[];
  /** quantos pratos desta casa usam (pela ficha que vale pra casa) */
  pratosNaCasa: number;
}

export interface CalculoCasa {
  organizacaoId: string;
  ligado: boolean;
  pratos: PratoCalculado[];
  insumos: InsumoLinha[];
}

/**
 * Calcula, pra uma casa, o que cada prato contém e se está revisado.
 * `soMenu` = só o que está no cardápio (menu_dino) — é o que a tela mostra;
 * a loja recebe todos os produtos com código do PDV.
 */
export async function calcularCasa(filialId: string): Promise<CalculoCasa | null> {
  const org = await organizacaoDaFilial(filialId);
  if (!org) return null;

  const [filialRow, filiaisOrg, produtos, fichas, marcas, revisoes] = await Promise.all([
    db.execute(sql`SELECT cardapio_restricoes FROM filial WHERE id = ${filialId}`) as unknown as Promise<
      Array<{ cardapio_restricoes: boolean }>
    >,
    db.execute(sql`SELECT id, nome FROM filial WHERE organizacao_id = ${org}`) as unknown as Promise<
      Array<{ id: string; nome: string }>
    >,
    db.execute(sql`
      SELECT p.id, p.nome, p.codigo_externo,
             (SELECT e.nome FROM produto_etiqueta e
               WHERE e.filial_id = p.filial_id AND e.codigo_externo::text = p.codigo_etiqueta
               LIMIT 1) AS categoria,
             EXISTS (SELECT 1 FROM produto_variante pv
                     WHERE pv.produto_id = p.id AND pv.menu_dino AND pv.data_delete IS NULL
                       AND pv.preco_venda > 0) AS no_menu
      FROM produto p
      WHERE p.filial_id = ${filialId}
        AND p.descontinuado IS NOT TRUE
        AND p.tipo <> 'INSUMO'
        AND (p.codigo_externo IS NOT NULL
             OR EXISTS (SELECT 1 FROM produto_variante pv WHERE pv.produto_id = p.id AND pv.menu_dino))
    `) as unknown as Promise<Array<{ id: string; nome: string | null; codigo_externo: number | null; categoria: string | null; no_menu: boolean }>>,
    db.execute(sql`
      SELECT ft.filial_id, p.nome AS prato, i.nome AS insumo
      FROM ficha_tecnica ft
      JOIN produto p ON p.id = ft.produto_id
      JOIN produto i ON i.id = ft.insumo_id
      JOIN filial f ON f.id = ft.filial_id
      WHERE f.organizacao_id = ${org}
    `) as unknown as Promise<Array<{ filial_id: string; prato: string | null; insumo: string | null }>>,
    db.execute(sql`
      SELECT alvo, nome_norm, restricao, nome FROM restricao_marca WHERE organizacao_id = ${org}
    `) as unknown as Promise<Array<{ alvo: string; nome_norm: string; restricao: string; nome: string | null }>>,
    db.execute(sql`
      SELECT nome_norm, conferido, revisado_por, revisado_em::text AS revisado_em
      FROM restricao_revisao WHERE organizacao_id = ${org}
    `) as unknown as Promise<Array<{ nome_norm: string; conferido: string; revisado_por: string | null; revisado_em: string }>>,
  ]);

  const nomeFilial = new Map(filiaisOrg.map((f) => [f.id, f.nome]));

  // ficha: casa → prato (norm) → insumos (nome de exibição, sem repetir)
  const fichaPor = new Map<string, Map<string, Map<string, string>>>();
  const nomeInsumo = new Map<string, string>(); // norm → nome
  for (const f of fichas) {
    const pn = normNome(f.prato);
    const inN = normNome(f.insumo);
    if (!pn || !inN) continue;
    if (!fichaPor.has(f.filial_id)) fichaPor.set(f.filial_id, new Map());
    const m = fichaPor.get(f.filial_id)!;
    if (!m.has(pn)) m.set(pn, new Map());
    m.get(pn)!.set(inN, f.insumo || inN);
    if (!nomeInsumo.has(inN)) nomeInsumo.set(inN, f.insumo || inN);
  }

  /** Insumos do prato (com um nível de sub-receita: insumo que tem ficha). */
  function fichaDoPrato(pn: string): { fonte: string | null; insumos: Map<string, string> } {
    const casas = [filialId, ...filiaisOrg.map((f) => f.id).filter((id) => id !== filialId)];
    for (const c of casas) {
      const m = fichaPor.get(c);
      const base = m?.get(pn);
      if (!m || !base || !base.size) continue;
      const tudo = new Map(base);
      for (const [inN] of base) {
        const sub = m.get(inN);
        if (sub && inN !== pn) for (const [sN, sNome] of sub) if (!tudo.has(sN)) tudo.set(sN, sNome);
      }
      return { fonte: c === filialId ? 'casa' : nomeFilial.get(c) ?? 'outra casa', insumos: tudo };
    }
    return { fonte: null, insumos: new Map() };
  }

  const marcaInsumo = new Map<string, Set<string>>();
  const marcaPrato = new Map<string, Set<string>>();
  for (const m of marcas) {
    if (!CODIGOS.has(m.restricao)) continue;
    const alvo = m.alvo === 'insumo' ? marcaInsumo : marcaPrato;
    if (!alvo.has(m.nome_norm)) alvo.set(m.nome_norm, new Set());
    alvo.get(m.nome_norm)!.add(m.restricao);
    if (m.alvo === 'insumo' && m.nome && !nomeInsumo.has(m.nome_norm)) nomeInsumo.set(m.nome_norm, m.nome);
  }
  const revPor = new Map(revisoes.map((r) => [r.nome_norm, r]));

  const usoNaCasa = new Map<string, number>();
  const pratos: PratoCalculado[] = [];
  for (const p of produtos) {
    const nome = p.nome || '';
    const pn = normNome(nome);
    if (!pn) continue;
    const ficha = fichaDoPrato(pn);
    const contem: Record<string, string[]> = {};
    for (const [inN, inNome] of ficha.insumos) {
      if (p.no_menu) usoNaCasa.set(inN, (usoNaCasa.get(inN) ?? 0) + 1);
      for (const r of marcaInsumo.get(inN) ?? []) (contem[r] ??= []).push(inNome);
    }
    const manual = [...(marcaPrato.get(pn) ?? [])];
    for (const r of manual) (contem[r] ??= []).push('marcado no prato');
    const assinatura = RESTRICOES.map((r) => r.codigo).filter((c) => contem[c]).join(',');
    const rev = revPor.get(pn);
    pratos.push({
      produtoId: p.id,
      codigoExterno: p.codigo_externo == null ? null : Number(p.codigo_externo),
      nome,
      nomeNorm: pn,
      noMenu: !!p.no_menu,
      categoria: (p.categoria ?? '').trim() || 'Sem categoria',
      fichaFonte: ficha.fonte,
      insumos: [...ficha.insumos.values()],
      contem,
      manual,
      assinatura,
      revisado: !!rev && rev.conferido === assinatura,
      revisaoDiverge: !!rev && rev.conferido !== assinatura,
      revisadoPor: rev?.revisado_por ?? null,
      revisadoEm: rev?.revisado_em ?? null,
    });
  }
  pratos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const insumos: InsumoLinha[] = [...nomeInsumo.entries()]
    .map(([n, nome]) => ({
      nome,
      nomeNorm: n,
      marcas: [...(marcaInsumo.get(n) ?? [])],
      pratosNaCasa: usoNaCasa.get(n) ?? 0,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  return { organizacaoId: org, ligado: !!filialRow[0]?.cardapio_restricoes, pratos, insumos };
}

export async function definirMarca(
  org: string,
  alvo: 'insumo' | 'produto',
  nome: string,
  restricao: string,
  ligado: boolean,
  quem: string | null,
): Promise<void> {
  const n = normNome(nome);
  if (!n || !CODIGOS.has(restricao)) throw new Error('marca inválida');
  if (ligado) {
    await db.execute(sql`
      INSERT INTO restricao_marca (organizacao_id, alvo, nome_norm, restricao, nome, marcado_por)
      VALUES (${org}, ${alvo}, ${n}, ${restricao}, ${nome}, ${quem})
      ON CONFLICT (organizacao_id, alvo, nome_norm, restricao) DO NOTHING
    `);
  } else {
    await db.execute(sql`
      DELETE FROM restricao_marca
      WHERE organizacao_id = ${org} AND alvo = ${alvo} AND nome_norm = ${n} AND restricao = ${restricao}
    `);
  }
}

export async function marcarRevisado(
  org: string,
  filialId: string,
  nome: string,
  assinatura: string | null,
  quem: string | null,
): Promise<void> {
  const n = normNome(nome);
  if (!n) throw new Error('nome vazio');
  if (assinatura === null) {
    await db.execute(sql`DELETE FROM restricao_revisao WHERE organizacao_id = ${org} AND nome_norm = ${n}`);
    return;
  }
  await db.execute(sql`
    INSERT INTO restricao_revisao (organizacao_id, nome_norm, conferido, nome, filial_id, revisado_por, revisado_em)
    VALUES (${org}, ${n}, ${assinatura}, ${nome}, ${filialId}, ${quem}, now())
    ON CONFLICT (organizacao_id, nome_norm) DO UPDATE SET
      conferido = excluded.conferido, nome = excluded.nome, filial_id = excluded.filial_id,
      revisado_por = excluded.revisado_por, revisado_em = now()
  `);
}
