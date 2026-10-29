// OCR de boleto via OpenAI gpt-4o-mini.
// Recebe imagem (URL publica do Storage) e extrai data de vencimento + valor.
// Retorna confianca pra UI dar feedback ao user (alta/media/baixa/erro).
//
// Custo: ~\$0.0003 por boleto (gpt-4o-mini eh ~12x mais barato que Sonnet).
// Volume estimado pra 100 NFes/mes com 3 boletos cada: ~R\$ 0,60/mes.

import OpenAI from 'openai';

export interface ResultadoOcr {
  dataVencimento: string | null; // YYYY-MM-DD
  valor: number | null;
  confianca: 'alta' | 'media' | 'baixa' | 'erro';
  observacao: string | null;
}

const PROMPT = `Voce eh um especialista em ler boletos bancarios brasileiros e extrair dados estruturados.

Olhe a imagem e extraia:
1. **dataVencimento**: data de vencimento (campo "Vencimento" ou "Data de Vencimento"). Formato ISO YYYY-MM-DD.
2. **valor**: valor a pagar (campo "Valor", "Valor Cobrado", "Valor a pagar" ou "Total"). Numero decimal (ex: 1234.56). Se ver R$ 1.234,56 → 1234.56.
3. **confianca**: "alta" se conseguiu ler com clareza, "media" se conseguiu mas com algum ruido, "baixa" se a foto eh ruim mas tem palpite, "erro" se nao da pra extrair.
4. **observacao**: aviso opcional pro humano (ex: "foto borrada, valor pode estar incorreto", "boleto cortado", null se ok).
5. **linhaDigitavel**: a linha digitavel (sequencia de 47 ou 48 digitos no topo do boleto, ex: "34191.09979 84166.772933 86639.170009 1 16180000167400"), copiada digito por digito. null se nao der pra ler TODOS os digitos com certeza.

Cuidados especificos:
- Numeros brasileiros usam virgula como decimal: "1.234,56" eh mil duzentos e trinta e quatro reais e cinquenta e seis centavos.
- Data brasileira eh dd/mm/aaaa: "31/12/2025" → "2025-12-31".
- Linha digitavel do boleto NAO eh o valor — o valor aparece grande ao lado de "Valor" ou no canto superior direito.
- Se a imagem nao eh um boleto, retorna confianca=erro.

Responda APENAS com um JSON valido nesse formato (sem markdown, sem texto antes/depois):
{"dataVencimento":"YYYY-MM-DD"|null,"valor":number|null,"confianca":"alta"|"media"|"baixa"|"erro","observacao":string|null,"linhaDigitavel":string|null}`;

/** Digito do campo da linha digitavel (modulo 10, pesos 2,1 da direita). */
function dvModulo10(num: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    const p = Number(num[i]) * peso;
    soma += p > 9 ? p - 9 : p;
    peso = peso === 2 ? 1 : 2;
  }
  return (10 - (soma % 10)) % 10;
}

/** DV geral do codigo de barras (modulo 11, pesos 2..9) — cobre fator e valor. */
function dvGeral(d: string): number {
  const cb = d.slice(0, 4) + d.slice(33, 47) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31);
  let soma = 0;
  let peso = 2;
  for (let i = cb.length - 1; i >= 0; i--) {
    soma += Number(cb[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const r = 11 - (soma % 11);
  return r === 0 || r === 10 || r === 11 ? 1 : r;
}

/** Le valor e vencimento da linha digitavel de boleto BANCARIO (47 digitos).
 *  So devolve quando o DV geral bate (ele cobre fator e valor) e no maximo um
 *  DV de campo diverge (o proprio digito pode sair borrado na foto). Fator de
 *  vencimento: 1000 = 22/02/2025 (reiniciou nessa data); fator 0 = sem
 *  vencimento; valor 0 = livre. */
export function lerLinhaDigitavel(
  linha: string | null | undefined,
): { valor: number | null; dataVencimento: string | null } | null {
  const d = (linha ?? '').replace(/\D/g, '');
  if (d.length !== 47) return null;
  const campos: [string, string][] = [
    [d.slice(0, 9), d[9]!],
    [d.slice(10, 20), d[20]!],
    [d.slice(21, 31), d[31]!],
  ];
  if (dvGeral(d) !== Number(d[32])) return null;
  if (campos.filter(([n, dv]) => dvModulo10(n) !== Number(dv)).length > 1) return null;
  const fator = Number(d.slice(33, 37));
  const centavos = Number(d.slice(37, 47));
  let dataVencimento: string | null = null;
  if (fator >= 1000) {
    const novo = new Date(Date.UTC(2025, 1, 22) + (fator - 1000) * 86_400_000);
    // Boleto do ciclo antigo (antes de 22/02/2025): base 07/10/1997.
    const usaNovo = novo.getTime() - Date.now() < 5 * 365 * 86_400_000;
    const dt = usaNovo ? novo : new Date(Date.UTC(1997, 9, 7) + fator * 86_400_000);
    dataVencimento = dt.toISOString().slice(0, 10);
  }
  return { valor: centavos > 0 ? centavos / 100 : null, dataVencimento };
}

export async function extrairDadosBoleto(imageUrl: string): Promise<ResultadoOcr> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      dataVencimento: null,
      valor: null,
      confianca: 'erro',
      observacao: 'OCR desabilitado: OPENAI_API_KEY nao configurada',
    };
  }

  try {
    const client = new OpenAI({ apiKey });

    // GPT-4o aceita URL diretamente (faz fetch da imagem). Mais simples que
    // base64. Storage do Supabase eh publico — nada a esconder.
    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 300,
      // response_format JSON garante que sai JSON valido (nao precisa parsear
      // markdown). Disponivel em gpt-4o-mini desde 2024.
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            {
              type: 'image_url',
              image_url: { url: imageUrl, detail: 'high' },
            },
          ],
        },
      ],
    });

    const text = resp.choices[0]?.message?.content;
    if (!text) {
      return {
        dataVencimento: null,
        valor: null,
        confianca: 'erro',
        observacao: 'resposta vazia da IA',
      };
    }

    const parsed = JSON.parse(text) as Partial<ResultadoOcr> & { linhaDigitavel?: string | null };

    // Sanitiza
    const data = parsed.dataVencimento;
    const dataValida = data && /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : null;
    const valor =
      typeof parsed.valor === 'number' && Number.isFinite(parsed.valor) && parsed.valor > 0
        ? parsed.valor
        : null;
    const confianca = (
      ['alta', 'media', 'baixa', 'erro'].includes(parsed.confianca as string)
        ? parsed.confianca
        : 'erro'
    ) as ResultadoOcr['confianca'];

    // Linha digitavel com os digitos verificadores certos manda: valor e
    // vencimento saem do codigo, nao do que a IA "viu" na foto (foto borrada
    // da SOLAR leu 3.617,69 num boleto de 1.674,00 — 29/10/2026).
    const codigo = lerLinhaDigitavel(parsed.linhaDigitavel);
    if (codigo && (codigo.valor != null || codigo.dataVencimento)) {
      return {
        dataVencimento: codigo.dataVencimento ?? dataValida,
        valor: codigo.valor ?? valor,
        confianca: 'alta',
        observacao: 'lido pelo código de barras',
      };
    }

    return {
      dataVencimento: dataValida,
      valor,
      confianca,
      observacao: typeof parsed.observacao === 'string' ? parsed.observacao : null,
    };
  } catch (err) {
    return {
      dataVencimento: null,
      valor: null,
      confianca: 'erro',
      observacao: `falha OCR: ${(err as Error).message}`.slice(0, 200),
    };
  }
}
