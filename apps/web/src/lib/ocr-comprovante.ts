// OCR de COMPROVANTE DE PAGAMENTO (maquininha e Pix) via OpenAI gpt-4o-mini.
//
// Nasce do recebimento manual do caixa: quando a maquininha recebe e não baixa
// a comanda, o caixa fotografa o comprovante. A foto já era a prova; ler o
// papel transforma ela em DADO — principalmente o NSU, que é o que casa o
// recebimento com o extrato da Cielo depois (ver lib/conciliacao-operadora).
//
// Dois campos que valem ouro e passam despercebidos:
//  · VIA LOJA × VIA CLIENTE — só a via da loja prova que o estabelecimento
//    recebeu. A via do cliente é lembrete, não comprovante.
//  · o ID/E2E do Pix (E0670119...) — é ele que acha a transação no extrato,
//    porque Pix não tem NSU de cartão.
//
// Mesma cozinha do ocr-boleto: gpt-4o-mini, JSON forçado, ~US$ 0,0004 por foto.
// Falha de OCR NUNCA derruba o recebimento — a foto sozinha já bastava.
import OpenAI from 'openai';

export interface DadosComprovante {
  /** NSU / DOC — o número da transação na maquininha. */
  nsu: string | null;
  /** Código de autorização (cartão). */
  autorizacao: string | null;
  /** Cielo, Rede, Stone, GetNet, PagSeguro, SumUp... */
  operadora: string | null;
  /** Visa, Mastercard, Elo, Hipercard... (null em Pix) */
  bandeira: string | null;
  /** credito | debito | pix | voucher | outro */
  tipo: string | null;
  valor: number | null;
  /** ISO YYYY-MM-DDTHH:mm quando dá pra ler os dois. */
  dataHora: string | null;
  /** loja | cliente | null — a via da LOJA é a que vale como prova. */
  via: string | null;
  estabelecimento: string | null;
  cnpj: string | null;
  /** Número do POS/terminal impresso no papel. */
  terminal: string | null;
  parcelas: number | null;
  /** Pix: identificador ponta a ponta (E + 31 dígitos) e quem pagou. */
  idPix: string | null;
  pagador: string | null;
  confianca: 'alta' | 'media' | 'baixa' | 'erro';
  observacao: string | null;
}

const VAZIO: DadosComprovante = {
  nsu: null, autorizacao: null, operadora: null, bandeira: null, tipo: null,
  valor: null, dataHora: null, via: null, estabelecimento: null, cnpj: null,
  terminal: null, parcelas: null, idPix: null, pagador: null,
  confianca: 'erro', observacao: null,
};

const PROMPT = `Você lê COMPROVANTES DE PAGAMENTO brasileiros (cupom de maquininha de cartão e comprovante de Pix) e extrai dados estruturados.

Extraia, do que estiver visível:
1. nsu: o número da transação. Aparece como "NSU", "DOC", "NSU/DOC" ou "Nº DOC". Só dígitos.
2. autorizacao: "AUT", "AUTORIZACAO", "COD AUT". Só dígitos/letras.
3. operadora: a adquirente que imprimiu — Cielo, Rede, Stone, GetNet, PagSeguro, SumUp, Mercado Pago, Safrapay. Costuma ser o logo no topo.
4. bandeira: Visa, Mastercard, Elo, Hipercard, Amex. null quando for Pix.
5. tipo: "credito", "debito", "pix", "voucher" ou "outro". Pistas: "CREDITO"/"A VISTA"/"PARCELADO" → credito; "DEBITO" → debito; "PAGAMENTO PIX"/"PIX" → pix.
6. valor: o valor da transação, número decimal (R$ 1.234,56 → 1234.56).
7. dataHora: data e hora da transação em ISO "YYYY-MM-DDTHH:mm". Data brasileira dd/mm/aa ou dd/mm/aaaa. Se só tiver data, use "YYYY-MM-DD".
8. via: "loja" se o papel diz VIA LOJA / VIA ESTABELECIMENTO / VIA DO ESTABELECIMENTO; "cliente" se diz VIA CLIENTE / VIA DO PORTADOR; null se não aparecer.
9. estabelecimento: nome do estabelecimento impresso.
10. cnpj: CNPJ do estabelecimento, só dígitos.
11. terminal: número do POS/terminal ("POS", "TERM", "PDV").
12. parcelas: número de parcelas (1 quando à vista).
13. idPix: só em Pix — o identificador que começa com E seguido de ~31 caracteres ("ID", "E2E", "ID da transação").
14. pagador: só em Pix — nome de quem pagou ("DADOS DO PAGADOR", "NOME").
15. confianca: "alta" se leu com clareza, "media" com algum ruído, "baixa" se a foto é ruim mas dá palpite, "erro" se não é comprovante de pagamento.
16. observacao: aviso curto pro humano quando algo importa (ex: "foto cortada, NSU incompleto", "via do cliente, não da loja"), senão null.

Cuidados:
- Cupom térmico desbota: se um dígito estiver ambíguo, prefira deixar o campo null a chutar. NSU errado atrapalha mais que NSU ausente.
- NÃO confunda valor com CNPJ, COD.EC, POS ou linha de ID.
- Se a imagem não for comprovante de pagamento, retorne confianca "erro".

Responda APENAS um JSON válido, sem markdown:
{"nsu":string|null,"autorizacao":string|null,"operadora":string|null,"bandeira":string|null,"tipo":string|null,"valor":number|null,"dataHora":string|null,"via":"loja"|"cliente"|null,"estabelecimento":string|null,"cnpj":string|null,"terminal":string|null,"parcelas":number|null,"idPix":string|null,"pagador":string|null,"confianca":"alta"|"media"|"baixa"|"erro","observacao":string|null}`;

/** `imagem` é data URL (data:image/jpeg;base64,...) ou URL pública. */
export async function lerComprovante(imagem: string): Promise<DadosComprovante> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ...VAZIO, observacao: 'OCR desligado: OPENAI_API_KEY não configurada' };
  if (!imagem || (!imagem.startsWith('data:image/') && !/^https?:\/\//.test(imagem))) {
    return { ...VAZIO, observacao: 'imagem inválida' };
  }
  try {
    const client = new OpenAI({ apiKey });
    const resp = await client.chat.completions.create({
      model: process.env.OCR_MODELO || 'gpt-4o-mini',
      max_tokens: 500,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: imagem, detail: 'high' } },
          ],
        },
      ],
    });
    const bruto = resp.choices[0]?.message?.content;
    if (!bruto) return { ...VAZIO, observacao: 'modelo não respondeu' };
    const j = JSON.parse(bruto) as Record<string, unknown>;

    const txt = (v: unknown, max = 60) => {
      const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
      return s && s.toLowerCase() !== 'null' ? s.slice(0, max) : null;
    };
    const dig = (v: unknown, max = 30) => {
      const s = txt(v, max + 20);
      const d = s ? s.replace(/\D/g, '') : '';
      return d ? d.slice(0, max) : null;
    };
    const via = txt(j.via, 10)?.toLowerCase();
    const conf = txt(j.confianca, 10) as DadosComprovante['confianca'] | null;

    return {
      nsu: dig(j.nsu, 20),
      autorizacao: txt(j.autorizacao, 20),
      operadora: txt(j.operadora, 30),
      bandeira: txt(j.bandeira, 20),
      tipo: txt(j.tipo, 12)?.toLowerCase() ?? null,
      valor: typeof j.valor === 'number' && Number.isFinite(j.valor) && j.valor > 0
        ? +j.valor.toFixed(2) : null,
      dataHora: txt(j.dataHora, 20),
      via: via === 'loja' || via === 'cliente' ? via : null,
      estabelecimento: txt(j.estabelecimento, 60),
      cnpj: dig(j.cnpj, 14),
      terminal: txt(j.terminal, 20),
      parcelas: typeof j.parcelas === 'number' && j.parcelas > 0 ? Math.round(j.parcelas) : null,
      idPix: txt(j.idPix, 40),
      pagador: txt(j.pagador, 60),
      confianca: conf === 'alta' || conf === 'media' || conf === 'baixa' || conf === 'erro' ? conf : 'baixa',
      observacao: txt(j.observacao, 200),
    };
  } catch (e) {
    return { ...VAZIO, observacao: 'falha ao ler: ' + String((e as Error).message).slice(0, 120) };
  }
}
