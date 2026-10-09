// Detecção de feriado (nacional + estadual/municipal fixos + "prolongado")
// pra decidir se um dia conta como fim de semana/feriado na janela de
// atendimento das reservas. Nacional vem da BrasilAPI (cache em memória por
// ano — a lista não muda ao longo do ano). Estadual/municipal são datas
// fixas conhecidas (não variam, não precisam de busca online). "Prolongado"
// hoje cobre só segunda de Carnaval (não é feriado oficial, mas as pessoas
// emendam com a terça) — derivado da própria data de Carnaval, sem precisar
// de outra fonte.

interface FeriadoNacional {
  date: string; // YYYY-MM-DD
  name: string;
  type: string;
}

const cacheNacional = new Map<number, Promise<FeriadoNacional[]>>();

async function buscarFeriadosNacionais(ano: number): Promise<FeriadoNacional[]> {
  if (!cacheNacional.has(ano)) {
    cacheNacional.set(
      ano,
      fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
    );
  }
  return cacheNacional.get(ano)!;
}

// Sergipe (Emancipação Política) e Aracaju (Aniversário da cidade) — datas
// fixas todo ano, não precisam de API.
const FERIADOS_LOCAIS_FIXOS = [
  { mesDia: '07-08', nome: 'Emancipação Política de Sergipe' },
  { mesDia: '03-17', nome: 'Aniversário de Aracaju' },
];

function addDias(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** true se a data é feriado (nacional/estadual/municipal) ou "prolongado"
 *  (hoje: segunda de Carnaval). Não faz distinção de motivo pro chamador —
 *  só diz se conta como dia especial pra janela de atendimento. */
export async function ehFeriadoOuProlongado(data: string): Promise<boolean> {
  const ano = Number(data.slice(0, 4));
  const mesDia = data.slice(5); // MM-DD

  if (FERIADOS_LOCAIS_FIXOS.some((f) => f.mesDia === mesDia)) return true;

  const nacionais = await buscarFeriadosNacionais(ano);
  if (nacionais.some((f) => f.date === data)) return true;

  // Segunda de Carnaval = segunda antes do Carnaval (terça) nacional.
  const carnaval = nacionais.find((f) => f.name === 'Carnaval');
  if (carnaval && addDias(carnaval.date, -1) === data) return true;

  return false;
}

/** true se conta como "fim de semana/feriado" pra janela de atendimento
 *  (sábado, domingo, feriado ou prolongado). */
export async function ehDiaEspecial(data: string): Promise<boolean> {
  const [y, m, d] = data.split('-').map(Number);
  const diaSemana = new Date(y, m - 1, d).getDay();
  if (diaSemana === 0 || diaSemana === 6) return true;
  return ehFeriadoOuProlongado(data);
}

const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

/** Feriados (nacional + locais fixos) de `de` até `de + dias`, em ordem, com
 *  nome e dia da semana. Usado pela Nina: sem essa lista ela perguntava "qual
 *  feriado?" numa sexta com feriado na segunda (caso Claudia, 09/10/2026). */
export async function proximosFeriados(
  de: string,
  dias: number,
): Promise<{ data: string; nome: string; diaSemana: string }[]> {
  const ate = addDias(de, dias);
  const anos = [...new Set([Number(de.slice(0, 4)), Number(ate.slice(0, 4))])];
  const achados = new Map<string, string>();
  for (const ano of anos) {
    for (const f of await buscarFeriadosNacionais(ano)) achados.set(f.date, f.name);
    for (const f of FERIADOS_LOCAIS_FIXOS) achados.set(`${ano}-${f.mesDia}`, f.nome);
  }
  return [...achados.entries()]
    .filter(([data]) => data >= de && data <= ate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([data, nome]) => {
      const [y, m, d] = data.split('-').map(Number);
      return { data, nome, diaSemana: DIAS_SEMANA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] };
    });
}
