// Ninguém trabalha em duas casas no mesmo horário. Usado na correção manual
// de ponto: simula a batida nova/alterada e confere se o período dela cruza
// com o período da mesma pessoa em outra casa, no mesmo dia operacional.
import { db, schema } from '@concilia/db';
import { and, eq, isNull } from 'drizzle-orm';

interface B {
  id: string;
  filialId: string;
  quando: Date;
  tipo: string;
}

/** Períodos trabalhados [ini, fim). Entrada sem saída fica aberta (fim = ∞):
 *  enquanto não fecharem lá, a pessoa conta como estando naquela casa. */
function periodos(bs: B[]): { ini: number; fim: number }[] {
  const out: { ini: number; fim: number }[] = [];
  let aberto: number | null = null;
  for (const b of [...bs].sort((a, b) => a.quando.getTime() - b.quando.getTime())) {
    if (b.tipo === 'entrada') {
      if (aberto === null) aberto = b.quando.getTime();
    } else if (aberto !== null) {
      out.push({ ini: aberto, fim: b.quando.getTime() });
      aberto = null;
    }
  }
  if (aberto !== null) out.push({ ini: aberto, fim: Infinity });
  return out;
}

function horaBr(ms: number): string {
  return new Date(ms).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
}

/** Devolve a mensagem do conflito, ou null se pode gravar. `batidaId` vem na
 *  alteração (troca a batida existente); na inclusão a batida entra como nova. */
export async function conflitoOutraCasa(p: {
  funcionarioId: string;
  filialId: string;
  dia: string;
  quando: Date;
  tipo: 'entrada' | 'saida';
  batidaId?: string;
}): Promise<string | null> {
  const doDia: B[] = await db
    .select({
      id: schema.pontoBatida.id,
      filialId: schema.pontoBatida.filialId,
      quando: schema.pontoBatida.quando,
      tipo: schema.pontoBatida.tipo,
    })
    .from(schema.pontoBatida)
    .where(
      and(
        eq(schema.pontoBatida.funcionarioId, p.funcionarioId),
        eq(schema.pontoBatida.diaOperacional, p.dia),
        isNull(schema.pontoBatida.excluidaEm),
      ),
    );

  const simulado = doDia.filter((b) => b.id !== p.batidaId);
  simulado.push({ id: p.batidaId ?? 'nova', filialId: p.filialId, quando: p.quando, tipo: p.tipo });

  const daqui = periodos(simulado.filter((b) => b.filialId === p.filialId));
  const outras = new Set(simulado.filter((b) => b.filialId !== p.filialId).map((b) => b.filialId));
  for (const outra of outras) {
    for (const o of periodos(simulado.filter((b) => b.filialId === outra))) {
      if (!daqui.some((a) => a.ini < o.fim && o.ini < a.fim)) continue;
      const [f] = await db.select({ nome: schema.filial.nome }).from(schema.filial).where(eq(schema.filial.id, outra)).limit(1);
      const quando = o.fim === Infinity ? `entrada às ${horaBr(o.ini)}, sem saída` : `${horaBr(o.ini)} às ${horaBr(o.fim)}`;
      return `Neste horário a pessoa está com ponto em ${f?.nome ?? 'outra casa'} (${quando}). Corrija ou exclua lá primeiro.`;
    }
  }
  return null;
}
