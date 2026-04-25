// OCR de boleto via Claude Vision.
// Recebe imagem (URL publica do Storage) e extrai data de vencimento + valor.
// Retorna confianca pra UI dar feedback ao user (alta/media/baixa/erro).
//
// Custo: ~$0.005 por boleto com Claude Sonnet (input ~1500 tokens da imagem
// + 100 do prompt, output ~80 tokens JSON).

import Anthropic from '@anthropic-ai/sdk';

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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      dataVencimento: null,
      valor: null,
      confianca: 'erro',
      observacao: 'OCR desabilitado: ANTHROPIC_API_KEY nao configurada',
    };
  }

  try {
    const client = new Anthropic({ apiKey });

    // Baixa a imagem e converte pra base64 (Claude aceita URL OU base64;
    // base64 evita problemas de rede entre Claude e nosso Storage).
    const imgResp = await fetch(imageUrl);
    if (!imgResp.ok) {
      return {
        dataVencimento: null,
        valor: null,
        confianca: 'erro',
        observacao: `falha baixando imagem: HTTP ${imgResp.status}`,
      };
    }
    const buffer = Buffer.from(await imgResp.arrayBuffer());
    const base64 = buffer.toString('base64');

    // Detecta media type pelo magic number (basico)
    let mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' = 'image/jpeg';
    if (buffer[0] === 0x89 && buffer[1] === 0x50) mediaType = 'image/png';
    else if (buffer[0] === 0x47 && buffer[1] === 0x49) mediaType = 'image/gif';
    else if (
      buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
    ) mediaType = 'image/webp';

    const resp = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    });

    // Extrai texto da resposta
    const textBlock = resp.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return {
        dataVencimento: null,
        valor: null,
        confianca: 'erro',
        observacao: 'resposta vazia da IA',
      };
    }

    // Parse JSON. Tenta limpar markdown se vier com ```
    let jsonStr = textBlock.text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }
    const parsed = JSON.parse(jsonStr) as Partial<ResultadoOcr>;

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
