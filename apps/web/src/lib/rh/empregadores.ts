// Empresas que registram em carteira (CNPJ + razão social). Sem import de banco:
// serve tanto pro servidor (admissão) quanto pra tela do cadastro do funcionário.
export const EMPREGADORES: { cnpj: string; empresaRegistro: string; rotulo: string }[] = [
  { cnpj: '33159574000166', empresaRegistro: 'PRAINHA TURISMO LTDA', rotulo: 'Prainha Turismo — Prainha Bar (0001-66)' },
  { cnpj: '33159574000328', empresaRegistro: 'PRAINHA TURISMO LTDA', rotulo: 'Prainha Turismo — Prainha Mar (0003-28)' },
  { cnpj: '33159574000247', empresaRegistro: 'PRAINHA TURISMO LTDA', rotulo: 'Prainha Turismo — Tabuará (0002-47)' },
  { cnpj: '05486249000172', empresaRegistro: 'E.B.SERVICOS LTDA', rotulo: 'E.B. Serviços' },
  { cnpj: '54228128000136', empresaRegistro: 'LELIS ATACADISTA E VAREJISTA DE ALIMENTO', rotulo: 'Lelis' },
];
