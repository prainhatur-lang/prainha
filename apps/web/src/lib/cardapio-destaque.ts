// Destaques do cardápio do QR da mesa (tabela cardapio_destaque, 26/10/2026):
// "Almoço executivo" (Bar e Mar), "Almoço convidativo" (Tabuará), "Happy hour".
// Cada um diz os dias e a hora em que vale e liga os itens (código do PDV da
// variante). Só aparece no QR com `mostrar` ligado.

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

export type Destaque = {
  id: string;
  filialId: string;
  titulo: string;
  texto: string | null;
  dias: number[];
  horaInicio: string | null;
  horaFim: string | null;
  codigos: number[];
  mostrar: boolean;
  ordem: number;
  atualizadoPor: string | null;
  atualizadoEm: string | null;
};

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function hh(h: string | null): string {
  if (!h) return '';
  const [H, M] = h.slice(0, 5).split(':');
  return M === '00' ? `${Number(H)}h` : `${Number(H)}h${M}`;
}

/** "seg a sex, 11h às 15h" / "sáb e dom" / "todos os dias, a partir das 17h". */
export function quandoTexto(dias: number[], ini: string | null, fim: string | null): string {
  const d = [...new Set(dias)].filter((x) => x >= 0 && x <= 6).sort((a, b) => a - b);
  let dt = '';
  if (d.length === 0 || d.length === 7) dt = 'todos os dias';
  else {
    // sequência contínua (considera dom no fim: sex, sáb, dom)
    const ord = d.map((x) => (x === 0 ? 7 : x)).sort((a, b) => a - b);
    const seguido = ord.length >= 3 && ord.every((x, i) => i === 0 || x === ord[i - 1] + 1);
    const nome = (x: number) => DIAS[x % 7];
    if (seguido) dt = `${nome(ord[0])} a ${nome(ord[ord.length - 1])}`;
    else if (ord.length === 1) dt = nome(ord[0]);
    else dt = ord.slice(0, -1).map(nome).join(', ') + ' e ' + nome(ord[ord.length - 1]);
  }
  let ht = '';
  if (ini && fim) ht = `${hh(ini)} às ${hh(fim)}`;
  else if (ini) ht = `a partir das ${hh(ini)}`;
  else if (fim) ht = `até as ${hh(fim)}`;
  return ht ? `${dt}, ${ht}` : dt;
}

type Linha = {
  id: string; filial_id: string; titulo: string; texto: string | null; dias_semana: number[] | null;
  hora_inicio: string | null; hora_fim: string | null; codigos: number[] | null; mostrar: boolean;
  ordem: number; atualizado_por: string | null; atualizado_em: string | null;
};

export async function listarDestaques(filialId: string, soLigados = false): Promise<Destaque[]> {
  let rows: Linha[] = [];
  try {
    rows = (await db.execute(sql`
      SELECT id, filial_id, titulo, texto, dias_semana, hora_inicio::text, hora_fim::text, codigos,
             mostrar, ordem, atualizado_por, atualizado_em::text
        FROM cardapio_destaque
       WHERE filial_id = ${filialId} ${soLigados ? sql`AND mostrar` : sql``}
       ORDER BY ordem, titulo`)) as unknown as Linha[];
  } catch {
    return []; // tabela ainda não existe
  }
  return rows.map((r) => ({
    id: r.id,
    filialId: r.filial_id,
    titulo: r.titulo,
    texto: r.texto,
    dias: (r.dias_semana ?? []).map(Number),
    horaInicio: r.hora_inicio ? r.hora_inicio.slice(0, 5) : null,
    horaFim: r.hora_fim ? r.hora_fim.slice(0, 5) : null,
    codigos: (r.codigos ?? []).map(Number),
    mostrar: !!r.mostrar,
    ordem: Number(r.ordem) || 0,
    atualizadoPor: r.atualizado_por,
    atualizadoEm: r.atualizado_em,
  }));
}

export type DestaqueEntrada = {
  id?: string | null;
  filialId: string;
  titulo: string;
  texto: string | null;
  dias: number[];
  horaInicio: string | null;
  horaFim: string | null;
  codigos: number[];
  mostrar: boolean;
  ordem: number;
};

function arr(xs: number[]): string {
  return '{' + xs.map((x) => Math.trunc(x)).join(',') + '}';
}

export async function salvarDestaque(d: DestaqueEntrada, quem: string | null): Promise<string> {
  const dias = arr([...new Set(d.dias)].sort((a, b) => a - b));
  const cods = arr([...new Set(d.codigos)]);
  if (d.id) {
    const r = (await db.execute(sql`
      UPDATE cardapio_destaque SET titulo = ${d.titulo}, texto = ${d.texto}, dias_semana = ${dias}::smallint[],
             hora_inicio = ${d.horaInicio}::time, hora_fim = ${d.horaFim}::time, codigos = ${cods}::int[],
             mostrar = ${d.mostrar}, ordem = ${d.ordem}, atualizado_por = ${quem}, atualizado_em = now()
       WHERE id = ${d.id} AND filial_id = ${d.filialId}
       RETURNING id`)) as unknown as Array<{ id: string }>;
    if (!r[0]) throw new Error('destaque não encontrado');
    return r[0].id;
  }
  const r = (await db.execute(sql`
    INSERT INTO cardapio_destaque (filial_id, titulo, texto, dias_semana, hora_inicio, hora_fim, codigos, mostrar, ordem, atualizado_por)
    VALUES (${d.filialId}, ${d.titulo}, ${d.texto}, ${dias}::smallint[], ${d.horaInicio}::time, ${d.horaFim}::time,
            ${cods}::int[], ${d.mostrar}, ${d.ordem}, ${quem})
    RETURNING id`)) as unknown as Array<{ id: string }>;
  return r[0].id;
}

export async function excluirDestaque(filialId: string, id: string): Promise<boolean> {
  const r = (await db.execute(sql`
    DELETE FROM cardapio_destaque WHERE id = ${id} AND filial_id = ${filialId} RETURNING id`)) as unknown as Array<{ id: string }>;
  return r.length > 0;
}

/** Itens da casa pra ligar no destaque: código do PDV da variante + nome. */
export async function itensDaCasa(filialId: string): Promise<Array<{ codigo: number; nome: string; preco: number; noQr: boolean }>> {
  const rows = (await db.execute(sql`
    SELECT v.codigo_externo AS codigo, p.nome, COALESCE(v.preco_venda, 0)::float AS preco, COALESCE(v.cardapio_digital, false) AS qr
      FROM produto_variante v JOIN produto p ON p.id = v.produto_id
     WHERE v.filial_id = ${filialId} AND v.data_delete IS NULL AND v.codigo_externo IS NOT NULL
     ORDER BY p.nome`)) as unknown as Array<{ codigo: number; nome: string; preco: number; qr: boolean }>;
  const vistos = new Set<number>();
  const out: Array<{ codigo: number; nome: string; preco: number; noQr: boolean }> = [];
  for (const r of rows) {
    const c = Number(r.codigo);
    if (!Number.isFinite(c) || vistos.has(c)) continue;
    vistos.add(c);
    out.push({ codigo: c, nome: r.nome, preco: Number(r.preco) || 0, noQr: !!r.qr });
  }
  return out;
}
