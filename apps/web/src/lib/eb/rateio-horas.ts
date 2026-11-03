// Rateio do líquido da folha da E.B. pelas horas de cada casa (pedido do dono,
// 03/11/2026). Hoje cada pessoa pesa 100% na casa do cadastro; aqui o líquido
// de quem trabalhou em mais de uma casa é dividido pela proporção das horas
// batidas no ponto em cada uma. Quem não tem ponto no mês (administrativo)
// fica 100% na casa do cadastro.
//
// Só leitura: é um quadro ao lado do encontro de contas, não muda repasse,
// conta nem guia.

import { db, schema } from '@concilia/db';
import { and, asc, eq } from 'drizzle-orm';
import { minutosPorCasaDoMes } from '@/lib/rh/folha-mensal-dados';

export interface PessoaRateioHoras {
  folhaId: string;
  funcionarioId: string | null;
  nome: string;
  cadastroFilialId: string;
  liquido: number;
  /** Minutos e valor por casa (vazio = sem ponto no mês → 100% no cadastro). */
  casas: { filialId: string; min: number; valor: number }[];
}

export interface CasaRateioHoras {
  filialId: string;
  /** Líquido de quem é cadastrado na casa (o jeito de hoje). */
  peloCadastro: number;
  /** Líquido pelas horas trabalhadas na casa. */
  pelasHoras: number;
  /** pelasHoras − peloCadastro: positivo = a casa deve repassar a mais. */
  diferenca: number;
}

function ultimoDia(comp: string): string {
  const [a, m] = comp.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${comp}-${String(d).padStart(2, '0')}`;
}

export async function rateioFolhaPelasHoras(
  cnpj: string,
  competencia: string,
  filialIds: string[],
): Promise<{ pessoas: PessoaRateioHoras[]; casas: CasaRateioHoras[] }> {
  const folha = (
    await db
      .select({
        id: schema.folhaContador.id,
        filialId: schema.folhaContador.filialId,
        funcionarioId: schema.folhaContador.funcionarioId,
        nome: schema.folhaContador.nome,
        cpf: schema.folhaContador.cpf,
        liquido: schema.folhaContador.liquido,
      })
      .from(schema.folhaContador)
      .where(and(eq(schema.folhaContador.cnpj, cnpj), eq(schema.folhaContador.competencia, competencia)))
      .orderBy(asc(schema.folhaContador.nome))
  ).filter((f) => filialIds.includes(f.filialId) && Number(f.liquido) > 0);

  const cpfDe = (c: string | null) => String(c ?? '').replace(/\D/g, '');
  const cpfs = [...new Set(folha.map((f) => cpfDe(f.cpf)).filter((c) => c.length === 11))];
  const minutos = await minutosPorCasaDoMes(cpfs, `${competencia}-01`, ultimoDia(competencia));

  const pessoas: PessoaRateioHoras[] = folha.map((f) => {
    const liquido = Number(f.liquido);
    const porCasa = [...(minutos.get(cpfDe(f.cpf))?.entries() ?? [])]
      .filter(([, m]) => m > 0)
      .sort((a, b) => b[1] - a[1]);
    const total = porCasa.reduce((t, [, m]) => t + m, 0);
    if (total <= 0) return { folhaId: f.id, funcionarioId: f.funcionarioId, nome: f.nome, cadastroFilialId: f.filialId, liquido, casas: [] };
    // Divide em centavos; a casa com mais horas fica com o resto do arredondamento.
    const cents = Math.round(liquido * 100);
    const partes = porCasa.map(([filialId, min]) => ({ filialId, min, c: Math.floor((cents * min) / total) }));
    partes[0]!.c += cents - partes.reduce((t, p) => t + p.c, 0);
    return {
      folhaId: f.id,
      funcionarioId: f.funcionarioId,
      nome: f.nome,
      cadastroFilialId: f.filialId,
      liquido,
      casas: partes.map((p) => ({ filialId: p.filialId, min: p.min, valor: p.c / 100 })),
    };
  });

  const acum = new Map<string, { cad: number; horas: number }>();
  const soma = (id: string, campo: 'cad' | 'horas', c: number) => {
    const a = acum.get(id) ?? { cad: 0, horas: 0 };
    a[campo] += c;
    acum.set(id, a);
  };
  for (const p of pessoas) {
    soma(p.cadastroFilialId, 'cad', Math.round(p.liquido * 100));
    if (p.casas.length === 0) soma(p.cadastroFilialId, 'horas', Math.round(p.liquido * 100));
    else for (const c of p.casas) soma(c.filialId, 'horas', Math.round(c.valor * 100));
  }
  const casas = [...acum.entries()]
    .map(([filialId, a]) => ({
      filialId,
      peloCadastro: a.cad / 100,
      pelasHoras: a.horas / 100,
      diferenca: (a.horas - a.cad) / 100,
    }))
    .sort((a, b) => b.pelasHoras - a.pelasHoras);
  return { pessoas, casas };
}
