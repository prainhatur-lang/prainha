// Dois cadastros, uma empresa só.
//
// O Consumer traz o mesmo distribuidor mais de uma vez (matriz e filial, ou o
// mesmo nome escrito de dois jeitos) e os dois vêm com ativo_compras. Aí a
// cotação convoca os dois: o vendedor recebe DOIS links, preenche os dois, e
// os preços dele disputam contra ele mesmo. Foi o "tem 2 asa branca" —
// "Asa Branca Distribuidora - Bebidas" e "ASA BRANCA INDUSTRIAL COMERCIAL E
// IMPORTADORA LTDA", ambos caindo no WhatsApp da Laryssa.
//
// Sinais usados (só os que não erram):
//  - raiz do CNPJ (8 primeiros dígitos) — matriz e filial da mesma empresa;
//  - MESMO número de WhatsApp de destino — quem recebe é a mesma pessoa,
//    que é o que importa na prática.
// Nome parecido NÃO entra: "Distribuidora Sul" e "Distribuidora Norte" viram
// falso positivo e o aviso perde a credibilidade.

export interface CandidatoDup {
  id: string;
  nome: string | null;
  cnpjOuCpf?: string | null;
  fone?: string | null;
}

function raizCnpj(v: string | null | undefined): string | null {
  const d = (v ?? '').replace(/\D/g, '');
  return d.length === 14 ? d.slice(0, 8) : null;
}

function foneNorm(v: string | null | undefined): string | null {
  let d = (v ?? '').replace(/\D/g, '');
  if (d.length < 10) return null;
  if (d.length <= 11) d = '55' + d;
  return d;
}

/** Grupos com 2+ cadastros que são, na prática, o mesmo fornecedor. */
export function agruparDuplicados<T extends CandidatoDup>(lista: T[]): T[][] {
  // union-find por chave compartilhada
  const pai = new Map<string, string>();
  const acha = (x: string): string => {
    const p = pai.get(x);
    if (!p || p === x) return x;
    const r = acha(p);
    pai.set(x, r);
    return r;
  };
  const une = (a: string, b: string) => {
    const ra = acha(a);
    const rb = acha(b);
    if (ra !== rb) pai.set(ra, rb);
  };

  for (const f of lista) pai.set(f.id, f.id);
  const porChave = new Map<string, string[]>();
  for (const f of lista) {
    const chaves = [raizCnpj(f.cnpjOuCpf) && `c:${raizCnpj(f.cnpjOuCpf)}`, foneNorm(f.fone) && `f:${foneNorm(f.fone)}`]
      .filter((k): k is string => !!k);
    for (const k of chaves) {
      if (!porChave.has(k)) porChave.set(k, []);
      porChave.get(k)!.push(f.id);
    }
  }
  for (const ids of porChave.values()) {
    for (let i = 1; i < ids.length; i++) une(ids[0], ids[i]);
  }

  const grupos = new Map<string, T[]>();
  for (const f of lista) {
    const r = acha(f.id);
    if (!grupos.has(r)) grupos.set(r, []);
    grupos.get(r)!.push(f);
  }
  return [...grupos.values()].filter((g) => g.length > 1);
}
