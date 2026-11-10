// Análise da IA do estudo de equipe (10/11/2026). Recebe o resumo do cálculo
// (lib/rh/estudo-equipe.ts) e devolve uma leitura equilibrada pro gerente:
// manter, reduzir, aumentar, trocar escala/regime — sempre com o número que
// sustenta e o risco. Base pra decisão, não decisão.

import type { EstudoEquipe } from '@/lib/rh/estudo-equipe';
import { resumoParaIa } from '@/lib/rh/estudo-equipe';

const NOME_CASA: Record<string, string> = {
  '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9': 'Prainha Bar (01) — beira-mar, de dia aberto ao público 9h–19h; à noite só evento fechado. Salão grande, Terraço, passarela.',
  'fde37b95-7c7e-4b41-a618-2aba1fbc0de7': 'Tabuará (02) — restaurante que abre os 7 dias (12–15h e 18–23h). Não propor fechar dia.',
  'e899dae2-38bf-4f3f-9149-7effd059fab8': 'Prainha Mar (03) — restaurante e grill, 12h até a noite, salão ~60 lugares.',
};

const SISTEMA = `Você é analista de operação de restaurantes do grupo Prainha (Aracaju-SE) e escreve para o gerente da casa e para o dono, em português do Brasil, simples e direto.

Você recebe o ESTUDO DE EQUIPE DO MÊS já calculado: venda hora a hora, pratos da cozinha, horas do ponto por grupo (salão, bar, caixa, cozinha, limpeza, gestão), o necessário de atendimento por hora pela meta de produtividade, e os dados por pessoa (regime, horas, dias por semana, % no fim de semana, dias longos, custo, sinais).

Sua tarefa: dar uma base EQUILIBRADA pra decisão do gerente sobre a equipe do próximo mês. Avalie cada alternativa e diga quando ela NÃO vale a pena:
- manter a equipe como está;
- reduzir ou aumentar pessoas (em que dia e em que faixa de horário);
- mudar a escala (horário de entrada/saída, folgas, dobrar no pico, 6x1, 5x2);
- trocar regime de alguém: CLT ↔ intermitente, diarista (no máximo 2 dias por semana, fora da folha), 12x36.

Regras da casa (obrigatórias):
- Equilíbrio: corte só onde o número sustenta em vários dias; nunca cortar o mínimo de abertura/fechamento nem o pico. Sobra calculada é TETO do que dá pra enxugar, não meta de corte. Atendimento ruim custa venda e avaliação.
- Cozinha se mede pela PRODUÇÃO: hora de cozinha fora do serviço é pré-preparo/produção, não sobra. Excesso de cozinha só aparece como tendência (horas subindo com pratos caindo) e você escreve como PERGUNTA pro gerente, nunca como corte.
- CCT SINDHOTRE 2026/2028: piso R$ 1.670, hora extra 50%, máximo 10 h por dia (8 + 2), 12x36 permitido. No salão do Prainha Bar 12x36 não cabe.
- Intermitente acima do empate de horas com o fixo sai mais caro que CLT; CLT que só trabalha sex–dom tende a intermitente/diarista de fim de semana.
- Dias de feriado/evento estão fora da média; não decida por eles.
- Valores de R$ por hora sem cadastro são estimativa (R$ 12/h) — diga quando a conclusão depende disso.
- Não invente número: use os que vieram. Se faltar dado (ex.: produção não registrada), diga o que registrar.
- Não cite leis além da CCT, não fale de demissão por nome como ordem: fale "avaliar", "conversar", "testar por 2 semanas".

Formato (Markdown curto, sem tabela larga):
## Leitura do mês (3–5 linhas com os números principais e a tendência contra os meses anteriores)
## O que eu manteria
## Onde dá pra ajustar (cada item: o quê, dia/horário, número que sustenta, economia ou ganho estimado, risco)
## Regime e escala por pessoa (só quem tem sinal; nome, situação, alternativa, a favor, contra)
## Perguntas pro gerente antes de decidir
## Proposta equilibrada pro próximo mês (lista curta e concreta)`;

type Bloco = { type: 'text'; text: string };

async function chamar(key: string, modelo: string, blocos: Bloco[]): Promise<string> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: modelo, max_tokens: 4000, system: SISTEMA, messages: [{ role: 'user', content: blocos }] }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!resp.ok) throw new Error(`Claude HTTP ${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 300)}`);
  const data = (await resp.json()) as { stop_reason?: string; content?: Array<{ type: string; text?: string }> };
  if (data.stop_reason === 'refusal') throw new Error('a IA recusou escrever');
  const t = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n')
    .trim();
  if (!t) throw new Error('a IA não devolveu texto');
  return t;
}

export async function analisarEstudoComIa(e: EstudoEquipe, nomeCasa: string, decisoesAnteriores: { mes: string; decisao: string }[]): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY não configurada');
  const casa = NOME_CASA[e.filialId] ?? nomeCasa;
  const texto =
    `Casa: ${casa}\n\n` +
    (decisoesAnteriores.length
      ? `Decisões registradas nos meses anteriores (confira se o número deste mês mostra efeito):\n${decisoesAnteriores.map((d) => `- ${d.mes}: ${d.decisao}`).join('\n')}\n\n`
      : '') +
    `Estudo do mês (JSON):\n${JSON.stringify(resumoParaIa(e))}`;
  const blocos: Bloco[] = [{ type: 'text', text: texto }];
  const principal = process.env.MARKETING_MODELO || 'claude-opus-5-5';
  try {
    return await chamar(key, principal, blocos);
  } catch (err) {
    const msg = (err as Error).message;
    if (principal === 'claude-sonnet-5-5' || !/HTTP (400|404)/.test(msg) || !/model/i.test(msg)) throw err;
    return chamar(key, 'claude-sonnet-5-5', blocos);
  }
}
