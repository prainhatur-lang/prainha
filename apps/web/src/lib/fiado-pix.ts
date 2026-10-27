// Baixa de fiado amarrada ao Pix recebido no extrato (lancamento_banco).
//
// Caso que pediu (27/10/2026, Tabuará): empresa pagou o evento ANTES por Pix,
// no dia a conta passou do valor, a diferença foi paga na hora e o
// antecipado ficou no fiado. A baixa do fiado precisa dizer QUAL Pix pagou,
// e o mesmo Pix não pode quitar duas vezes.
//
// Regra: um Pix pode pagar mais de uma baixa (ex.: dois eventos), mas a soma
// das baixas ligadas a ele nunca passa do valor do Pix. Baixa com 'erro' na
// loja não conta (não abateu nada).
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { favorecidoDoPix } from '@/lib/pix-inter';
import { diasAtrasBr } from '@/lib/datas';

export interface PixRecebido {
  id: string;
  data: string; // YYYY-MM-DD
  valor: number;
  pagador: string | null;
  descricao: string;
  usado: number;
  restante: number;
  /** quanto o nome do pagador parece com o do cliente (0 = nada) */
  parecido: number;
}

const VAZIAS = new Set(
  'LTDA ME EPP EIRELI SA DE DA DO DOS DAS E EM COM COMERCIO SERVICOS SERVICO REPR REPRES REPRESENTACOES'.split(' '),
);

function palavras(s: string | null | undefined): string[] {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((w) => w.length >= 2 && !VAZIAS.has(w));
}

/** Palavras do nome do cliente que aparecem no pagador (aceita abreviação de 4+ letras: PRAI ~ PRAINHA). */
export function parecenca(cliente: string | null | undefined, pagador: string | null | undefined): number {
  const a = palavras(cliente);
  const b = palavras(pagador);
  if (!a.length || !b.length) return 0;
  let n = 0;
  for (const w of a) {
    if (b.some((x) => x === w || (x.length >= 4 && w.length >= 4 && (x.startsWith(w) || w.startsWith(x))))) n++;
  }
  return n;
}

/** Pix recebidos (crédito no extrato) da casa nos últimos `dias`, com o que já foi usado em baixa de fiado. */
export async function pixRecebidosParaFiado(args: {
  filialId: string;
  clienteNome: string | null;
  dias?: number;
}): Promise<PixRecebido[]> {
  const desde = diasAtrasBr(args.dias ?? 120);
  const r = await db.execute(sql`
    SELECT l.id, l.data_movimento::text AS data, l.valor::text AS valor, l.descricao,
           COALESCE((
             SELECT SUM(f.valor) FROM fiado_lancamento f
              WHERE f.lancamento_banco_id = l.id AND f.status <> 'erro'
           ), 0)::text AS usado
      FROM lancamento_banco l
     WHERE l.filial_id = ${args.filialId}
       AND l.tipo = 'C'
       AND l.data_movimento >= ${desde}
       AND l.descricao ILIKE 'Pix recebido%'
       AND l.descricao NOT ILIKE '%CIELO%'
     ORDER BY l.data_movimento DESC
     LIMIT 400
  `);
  const rows = r as unknown as Array<{ id: string; data: string; valor: string; descricao: string | null; usado: string }>;
  return rows
    .map((x) => {
      const valor = Number(x.valor);
      const usado = Number(x.usado);
      const pagador = favorecidoDoPix(x.descricao);
      return {
        id: x.id,
        data: x.data,
        valor,
        pagador,
        descricao: x.descricao ?? '',
        usado,
        restante: Math.max(0, Math.round((valor - usado) * 100) / 100),
        parecido: parecenca(args.clienteNome, pagador),
      };
    })
    .sort((a, b) => b.parecido - a.parecido || (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
}

/** Texto curto do Pix pra ir na observação do Consumer. */
export function pixRotulo(p: { data: string; valor: number; pagador: string | null }): string {
  const m = p.data.slice(5, 7);
  const d = p.data.slice(8, 10);
  const v = p.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return `Pix ${d}/${m} ${v}${p.pagador ? ` de ${p.pagador}` : ''}`;
}
