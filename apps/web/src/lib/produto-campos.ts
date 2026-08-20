// CAMPOS DO CADASTRO DE PRODUTO que a tela do Concilia pode alterar.
//
// O Consumer é o dono do cadastro; a nuvem só enfileira e a loja aplica no
// Firebird. Esta lista é o contrato dos dois lados — a API valida por ela e a
// loja tem a mesma tabela (whitelist) antes de montar o UPDATE. Campo fora da
// lista não passa nem aqui nem lá.
//
// alvo 'produto'  → PRODUTOS       (uma linha por produto)
// alvo 'variante' → PRODUTODETALHE (uma linha por TAMANHO — é onde mora o
//                   preço de venda e a pausa, coisa que confunde quem acha
//                   que preço é do produto)
export type AlvoCampo = 'produto' | 'variante';
export type TipoCampo = 'texto' | 'numero' | 'inteiro' | 'bool';

export interface CampoProduto {
  alvo: AlvoCampo;
  tipo: TipoCampo;
  label: string;
  /** Ajuda curta pro usuário — só onde o campo engana. */
  dica?: string;
}

export const CAMPOS_PRODUTO: Record<string, CampoProduto> = {
  nome: { alvo: 'produto', tipo: 'texto', label: 'Nome' },
  descricao: { alvo: 'produto', tipo: 'texto', label: 'Descrição' },
  modo_preparo: { alvo: 'produto', tipo: 'texto', label: 'Modo de preparo' },
  preco_custo: { alvo: 'produto', tipo: 'numero', label: 'Preço de custo' },
  estoque_minimo: { alvo: 'produto', tipo: 'numero', label: 'Estoque mínimo' },
  estoque_controlado: { alvo: 'produto', tipo: 'bool', label: 'Controla estoque' },
  descontinuado: { alvo: 'produto', tipo: 'bool', label: 'Descontinuado' },
  categoria: { alvo: 'produto', tipo: 'inteiro', label: 'Categoria (etiqueta)' },
  cozinha: { alvo: 'produto', tipo: 'inteiro', label: 'Praça / cozinha' },
  preco_venda: {
    alvo: 'variante', tipo: 'numero', label: 'Preço de venda',
    dica: 'o preço é por tamanho — mudar aqui muda só este tamanho',
  },
  pausado: {
    alvo: 'variante', tipo: 'bool', label: 'Pausado',
    dica: 'pausado some do cardápio; descontinuado é definitivo',
  },
  comanda_mobile: { alvo: 'variante', tipo: 'bool', label: 'Aparece na comanda do garçom' },
  cardapio_digital: { alvo: 'variante', tipo: 'bool', label: 'Aparece no cardápio digital' },
};

/** Normaliza o valor pro formato que viaja na fila (string ou null). */
export function normalizaValor(campo: string, bruto: unknown): { ok: true; valor: string | null } | { ok: false; erro: string } {
  const def = CAMPOS_PRODUTO[campo];
  if (!def) return { ok: false, erro: `campo ${campo} não pode ser alterado por aqui` };
  if (bruto === null || bruto === '') return { ok: true, valor: null };
  if (def.tipo === 'bool') {
    if (typeof bruto !== 'boolean') return { ok: false, erro: `${def.label}: esperado sim/não` };
    return { ok: true, valor: bruto ? '1' : '0' };
  }
  if (def.tipo === 'numero' || def.tipo === 'inteiro') {
    const n = typeof bruto === 'number' ? bruto : Number(String(bruto).replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) return { ok: false, erro: `${def.label}: número inválido` };
    if (def.tipo === 'inteiro' && !Number.isInteger(n)) return { ok: false, erro: `${def.label}: precisa ser inteiro` };
    if (n > 9_999_999) return { ok: false, erro: `${def.label}: valor alto demais` };
    return { ok: true, valor: def.tipo === 'inteiro' ? String(Math.round(n)) : n.toFixed(4) };
  }
  const t = String(bruto).trim();
  if (t.length > 200) return { ok: false, erro: `${def.label}: máximo 200 caracteres` };
  return { ok: true, valor: t };
}
