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

Cuidados especificos:
- Numeros brasileiros usam virgula como decimal: "1.234,56" eh mil duzentos e trinta e quatro reais e cinquenta e seis centavos.
- Data brasileira eh dd/mm/aaaa: "31/12/2025" → "2025-12-31".
- Linha digitavel do boleto NAO eh o valor — o valor aparece grande ao lado de "Valor" ou no canto superior direito.
- Se a imagem nao eh um boleto, retorna confianca=erro.

Responda APENAS com um JSON valido nesse formato (sem markdown, sem texto antes/depois):
{"dataVencimento":"YYYY-MM-DD"|null,"valor":number|null,"confianca":"alta"|"media"|"baixa"|"erro","observacao":string|null}`;

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

    const parsed = JSON.parse(text) as Partial<ResultadoOcr>;

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
