// Defaults dos parametros das engines de conciliacao + helper que mescla
// com overrides da filial (filial.parametros_conciliacao).
//
// Usar sempre via `resolverParametros(filialParams)` — nunca acessar
// `filial.parametrosConciliacao` direto na engine, pra garantir que defaults
// sao aplicados em campos faltantes.

import type { ParametrosConciliacao } from '@concilia/db/schema';

export interface ParamsPdvCielo {
  janelaProximidadeDias: number;
  toleranciaAbsoluta: number;
  toleranciaPercentual: number;
  toleranciaDivergencia: number;
}

export interface ParamsPdvBancoDireto {
  janelaNivel1DiasUteis: number;
  janelaNivel2DiasUteis: number;
  descricaoRegex: string;
  toleranciaValor: number;
}

export const DEFAULTS_PDV_CIELO: ParamsPdvCielo = {
  janelaProximidadeDias: 3,
  toleranciaAbsoluta: 0.1,
  toleranciaPercentual: 0.01,
  toleranciaDivergencia: 0.1,
};

export const DEFAULTS_PDV_BANCO_DIRETO: ParamsPdvBancoDireto = {
  janelaNivel1DiasUteis: 1,
  janelaNivel2DiasUteis: 2,
  descricaoRegex: 'pix|ted|doc|transfer[êe]ncia|transferencia',
  toleranciaValor: 0.01,
};

export interface ParametrosResolvidos {
  pdvCielo: ParamsPdvCielo;
  pdvBancoDireto: ParamsPdvBancoDireto;
}

export function resolverParametros(
  filialParams: ParametrosConciliacao | null | undefined,
): ParametrosResolvidos {
  return {
    pdvCielo: {
      janelaProximidadeDias:
        filialParams?.pdvCielo?.janelaProximidadeDias ?? DEFAULTS_PDV_CIELO.janelaProximidadeDias,
      toleranciaAbsoluta:
        filialParams?.pdvCielo?.toleranciaAbsoluta ?? DEFAULTS_PDV_CIELO.toleranciaAbsoluta,
      toleranciaPercentual:
        filialParams?.pdvCielo?.toleranciaPercentual ?? DEFAULTS_PDV_CIELO.toleranciaPercentual,
      toleranciaDivergencia:
        filialParams?.pdvCielo?.toleranciaDivergencia ?? DEFAULTS_PDV_CIELO.toleranciaDivergencia,
    },
    pdvBancoDireto: {
      janelaNivel1DiasUteis:
        filialParams?.pdvBancoDireto?.janelaNivel1DiasUteis ??
        DEFAULTS_PDV_BANCO_DIRETO.janelaNivel1DiasUteis,
      janelaNivel2DiasUteis:
        filialParams?.pdvBancoDireto?.janelaNivel2DiasUteis ??
        DEFAULTS_PDV_BANCO_DIRETO.janelaNivel2DiasUteis,
      descricaoRegex:
        filialParams?.pdvBancoDireto?.descricaoRegex ??
        DEFAULTS_PDV_BANCO_DIRETO.descricaoRegex,
      toleranciaValor:
        filialParams?.pdvBancoDireto?.toleranciaValor ??
        DEFAULTS_PDV_BANCO_DIRETO.toleranciaValor,
    },
  };
}
