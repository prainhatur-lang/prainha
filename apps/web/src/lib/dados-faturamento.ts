// Dados de faturamento da filial em texto pronto pro WhatsApp — a pergunta
// mais comum de fornecedor ("qual CNPJ pra tirar o pedido?") respondida sem
// depender de humano. Fontes: filial.cnpj + fiscal_config (razão social, IE,
// endereço — os mesmos dados da emissão de NFC-e).

import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';

export function formatarCnpj(cnpj: string): string {
  const d = cnpj.replace(/\D/g, '');
  if (d.length !== 14) return cnpj;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Texto multi-linha com os dados de faturamento da filial (ou null se a
 *  filial não existir). Sempre tem pelo menos razão social + CNPJ. */
export async function dadosFaturamentoTexto(filialId: string): Promise<string | null> {
  const [f] = await db
    .select({
      nome: schema.filial.nome,
      cnpj: schema.filial.cnpj,
      fiscalConfig: schema.filial.fiscalConfig,
    })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  if (!f) return null;

  const fc = f.fiscalConfig ?? {};
  const linhas: string[] = ['📄 Dados para faturamento:'];
  linhas.push(`Razão social: ${fc.razaoSocial ?? f.nome}`);
  linhas.push(`CNPJ: ${formatarCnpj(f.cnpj)}`);
  if (fc.ie) linhas.push(`Inscrição estadual: ${fc.ie}`);
  const e = fc.endereco;
  if (e) {
    const cep = e.cep ? ` — CEP ${e.cep.replace(/^(\d{5})(\d{3})$/, '$1-$2')}` : '';
    linhas.push(
      `Endereço: ${e.logradouro}, ${e.numero}${e.complemento ? ` ${e.complemento}` : ''} — ${e.bairro}, ${e.municipio}/${e.uf}${cep}`,
    );
  }
  return linhas.join('\n');
}

/** Versão em LINHA ÚNICA (parâmetro de template da Meta não aceita quebra de
 *  linha) — vai dentro da mensagem do pedido de compra. */
export async function dadosFaturamentoLinha(filialId: string): Promise<string | null> {
  const t = await dadosFaturamentoTexto(filialId);
  if (!t) return null;
  return t.replace('📄 Dados para faturamento:\n', 'FATURAR PARA — ').replace(/\n/g, ' · ');
}

/** Pergunta de fornecedor que os dados de faturamento respondem sozinhos. */
export function perguntaFaturamento(texto: string): boolean {
  return /cnpj|raz[aã]o social|inscri[cç][aã]o estadual|dados (de |do |da |pra |para )?(fatura|nota|empresa|cadastro)|faturamento|emitir (a )?nota/i.test(
    texto,
  );
}
