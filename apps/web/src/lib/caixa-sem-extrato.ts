// Caixa de maquininha em casa SEM extrato da Cielo na nuvem (hoje a Prainha
// Mar: o EC dela não vem no EDI). A loja devolve o extrato "até 0000-00-00" e
// o motivo "ainda não cobre <dia> (vai até 00/00/0000) — fecha sozinho quando
// chegar". Nessa casa o arquivo não chega: o caixa fica aberto até alguém
// fechar. Aqui o texto passa a dizer isso (13/10/2026: 4 caixas da Mar abertos
// desde 02/10 com o aviso de que fechariam sozinhos).

const DA_LOJA = ' (vai até 00/00/0000) — fecha sozinho quando chegar';
const CERTO =
  ' — esta casa não tem extrato da Cielo na nuvem, então NÃO fecha sozinho: confira o NSU no portal da Cielo e feche na Conferência de Caixa';

/** A loja respondeu que não há extrato nenhum desta casa. */
export function semExtratoCielo(extratoAte: string | null | undefined, motivo?: string | null): boolean {
  return extratoAte === '0000-00-00' || String(motivo ?? '').includes('(vai até 00/00/0000)');
}

/** Troca a promessa "fecha sozinho quando chegar" pelo que vale nessa casa. Outros textos passam iguais. */
export function motivoSemExtrato(texto: string): string {
  return texto.split(DA_LOJA).join(CERTO);
}

export const ROTULO_SEM_EXTRATO =
  'esta casa não tem extrato da Cielo na nuvem — NÃO fecha sozinho: confira o NSU no portal da Cielo e feche o caixa aqui';
