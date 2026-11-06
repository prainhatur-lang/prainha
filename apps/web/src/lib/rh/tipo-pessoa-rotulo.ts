// Rótulos do tipo de pessoa (sem banco: pode ir pro componente do navegador).
export type TipoPessoa = 'intermitente' | 'clt' | '12x36' | 'diarista' | 'outros';

export const TIPO_PESSOA_ROTULO: Record<TipoPessoa, string> = {
  intermitente: 'Intermitente',
  clt: 'CLT',
  '12x36': '12x36',
  diarista: 'Diarista',
  outros: 'Sem registro',
};
