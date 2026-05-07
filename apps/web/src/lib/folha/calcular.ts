// Motor de calculo da folha. Funcao pura — recebe inputs e retorna
// linhas a serem pagas. Sem efeito colateral (sem DB).

export interface ConfigFolha {
  ppEmpresa: number;
  ppGerente: number;
  ppFuncionarios: number;
  taxaDiaristaHora: number;
  auxTransporteAtivo: boolean;
  auxTransporteValorHora: number | null;
  auxTransporteDias: Record<string, boolean> | null;
}

export interface PessoaInput {
  fornecedorId: string;
  nome: string;
  papel: 'funcionario' | 'diarista' | 'gerente';
  gerenteModelo: string | null; // '1pp_dos_10pct' | 'fixo_por_dia' | null
  gerenteValorFixoDia: number | null;
  diaristaTaxaHoraOverride: number | null;
}

export interface HorasInput {
  fornecedorId: string;
  /** { 'YYYY-MM-DD': minutosTrabalhados } */
  porDia: Record<string, number>;
}

export interface Lancamento {
  fornecedorId: string;
  pessoaNome: string;
  papel: PessoaInput['papel'];
  /** 'comissao' | 'diaria' | 'gratificacao' | 'transporte' */
  tipo: 'comissao' | 'diaria' | 'gratificacao' | 'transporte';
  /** Valor BRUTO (antes de descontos). */
  valorBruto: number;
  /** Desconto/fiado a abater (so na linha de comissao). */
  desconto: number;
  /** Valor liquido = bruto - desconto. */
  valorLiquido: number;
  /** Descricao livre (vai pro descricao do conta_pagar). */
  descricao: string;
  /** Detalhe pro debug/UI. */
  detalhe: string;
}

export interface ResultadoCalculo {
  /** Lancamentos a serem gerados (vai virar N conta_pagar). */
  lancamentos: Lancamento[];
  /** Soma do 10pp empresa (so info). */
  totalEmpresa: number;
  /** Soma comissao + gerente. */
  totalEquipe: number;
  /** Soma de tudo a pagar (bruto). */
  totalBruto: number;
  /** Total liquido (bruto - descontos). */
  totalLiquido: number;
  /** Total descontos (fiados). */
  totalDescontos: number;
  /** Aviso por pessoa, se calculou algo estranho (ex: gerente sem horas). */
  avisos: string[];
}

const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;

/**
 * Calcula a folha completa. Modelo:
 * - Por dia D: 10pp do total = config.ppEmpresa+ppGerente+ppFuncionarios
 *   - Empresa fica com (ppEmpresa/10) × dezPct[D]
 *   - Gerente recebe (ppGerente/10) × dezPct[D] (se modelo='1pp_dos_10pct')
 *     OU gerente_valor_fixo_dia se trabalhou nesse dia
 *   - Funcionarios rateiam (ppFuncionarios/10) × dezPct[D] por hora
 *     trabalhada (proporcional)
 * - Diaristas (papel='diarista') recebem ALEM da comissao:
 *   horas_total × taxa_diarista_hora (override por pessoa OU padrao da filial)
 * - Aux transporte (se ativo): horas em dias selecionados × valor_hora
 */
export function calcularFolha(args: {
  config: ConfigFolha;
  dezPctPorDia: Record<string, number>;
  pessoas: PessoaInput[];
  horas: HorasInput[];
  /** { fornecedorId: { tipo: 'desconto'|'acrescimo', valor } } */
  ajustes?: Record<
    string,
    Array<{ tipo: 'desconto' | 'acrescimo'; valor: number; descricao?: string }>
  >;
}): ResultadoCalculo {
  const { config, dezPctPorDia, pessoas, horas, ajustes = {} } = args;
  const dias = Object.keys(dezPctPorDia).sort();
  const horasMap = new Map(horas.map((h) => [h.fornecedorId, h.porDia]));

  // Identifica gerente (papel='gerente') — pode ter zero ou um por filial.
  const gerentes = pessoas.filter((p) => p.papel === 'gerente' && true);
  const naoGerentes = pessoas.filter((p) => p.papel !== 'gerente');

  const lancamentos: Lancamento[] = [];
  const avisos: string[] = [];
  let totalEmpresa = 0;
  let totalDescontos = 0;

  // Comissao por pessoa nao-gerente: rateia ppFuncionarios por dia em
  // funcao das horas trabalhadas.
  const comissaoPorPessoa = new Map<string, number>();
  for (const p of naoGerentes) comissaoPorPessoa.set(p.fornecedorId, 0);

  for (const dia of dias) {
    const dezPctDia = dezPctPorDia[dia] ?? 0;
    const empresaDia = (config.ppEmpresa / 10) * dezPctDia;
    const funcionariosDia = (config.ppFuncionarios / 10) * dezPctDia;
    totalEmpresa += empresaDia;

    // Total de minutos trabalhados nesse dia (somente nao-gerentes —
    // gerente nao rateia).
    let totalMinDia = 0;
    for (const p of naoGerentes) {
      totalMinDia += horasMap.get(p.fornecedorId)?.[dia] ?? 0;
    }
    if (totalMinDia === 0) continue;

    for (const p of naoGerentes) {
      const minPessoa = horasMap.get(p.fornecedorId)?.[dia] ?? 0;
      if (minPessoa === 0) continue;
      const fatia = (minPessoa / totalMinDia) * funcionariosDia;
      comissaoPorPessoa.set(
        p.fornecedorId,
        (comissaoPorPessoa.get(p.fornecedorId) ?? 0) + fatia,
      );
    }
  }

  // Gera lancamento de COMISSAO + DIARIA + TRANSPORTE pros nao-gerentes.
  for (const p of naoGerentes) {
    const com = comissaoPorPessoa.get(p.fornecedorId) ?? 0;
    const minTotal = sumMin(horasMap.get(p.fornecedorId) ?? {});

    // Descontos manuais + automaticos (fiado fica no campo manual)
    const ajustesPessoa = ajustes[p.fornecedorId] ?? [];
    const descontoComissao = ajustesPessoa
      .filter((a) => a.tipo === 'desconto')
      .reduce((s, a) => s + a.valor, 0);
    totalDescontos += descontoComissao;

    if (com > 0) {
      lancamentos.push({
        fornecedorId: p.fornecedorId,
        pessoaNome: p.nome,
        papel: p.papel,
        tipo: 'comissao',
        valorBruto: round2(com),
        desconto: round2(descontoComissao),
        valorLiquido: round2(com - descontoComissao),
        descricao: `Comissão semana — ${p.nome}`,
        detalhe: `${minutosToHM(minTotal)} de horas; rateio do ${
          config.ppFuncionarios
        }pp do 10%`,
      });
    } else if (descontoComissao > 0) {
      // Pessoa sem comissão mas com fiado — gera lancamento negativo (talvez
      // melhor virar conta_receber? Por ora, registra como debito).
      avisos.push(
        `${p.nome}: tem desconto/fiado ${brl(descontoComissao)} mas sem comissão na semana — fiado fica em aberto.`,
      );
    }

    // Diaria (papel='diarista'): R$/h × horas
    if (p.papel === 'diarista' && minTotal > 0) {
      const taxa = p.diaristaTaxaHoraOverride ?? config.taxaDiaristaHora;
      const dia = (minTotal / 60) * taxa;
      lancamentos.push({
        fornecedorId: p.fornecedorId,
        pessoaNome: p.nome,
        papel: p.papel,
        tipo: 'diaria',
        valorBruto: round2(dia),
        desconto: 0,
        valorLiquido: round2(dia),
        descricao: `Diária semana — ${p.nome}`,
        detalhe: `${minutosToHM(minTotal)} × R$ ${taxa.toFixed(2)}/h`,
      });
    }

    // Transporte
    if (config.auxTransporteAtivo && config.auxTransporteValorHora && config.auxTransporteDias) {
      let minTransp = 0;
      for (const dia of dias) {
        const diaSemana = DIAS_SEMANA[new Date(dia + 'T00:00:00').getDay()];
        if (config.auxTransporteDias[diaSemana]) {
          minTransp += horasMap.get(p.fornecedorId)?.[dia] ?? 0;
        }
      }
      if (minTransp > 0) {
        const t = (minTransp / 60) * config.auxTransporteValorHora;
        lancamentos.push({
          fornecedorId: p.fornecedorId,
          pessoaNome: p.nome,
          papel: p.papel,
          tipo: 'transporte',
          valorBruto: round2(t),
          desconto: 0,
          valorLiquido: round2(t),
          descricao: `Vale transporte semana — ${p.nome}`,
          detalhe: `${minutosToHM(minTransp)} em dias com transporte × R$ ${config.auxTransporteValorHora.toFixed(2)}/h`,
        });
      }
    }

    // Gratificacao (acrescimo manual)
    const acrescimos = ajustesPessoa
      .filter((a) => a.tipo === 'acrescimo')
      .reduce((s, a) => s + a.valor, 0);
    if (acrescimos > 0) {
      lancamentos.push({
        fornecedorId: p.fornecedorId,
        pessoaNome: p.nome,
        papel: p.papel,
        tipo: 'gratificacao',
        valorBruto: round2(acrescimos),
        desconto: 0,
        valorLiquido: round2(acrescimos),
        descricao: `Gratificação semana — ${p.nome}`,
        detalhe: ajustesPessoa
          .filter((a) => a.tipo === 'acrescimo')
          .map((a) => a.descricao ?? `R$ ${a.valor.toFixed(2)}`)
          .join('; '),
      });
    }
  }

  // Gerentes
  for (const g of gerentes) {
    const ajustesPessoa = ajustes[g.fornecedorId] ?? [];
    const desconto = ajustesPessoa
      .filter((a) => a.tipo === 'desconto')
      .reduce((s, a) => s + a.valor, 0);
    const acrescimo = ajustesPessoa
      .filter((a) => a.tipo === 'acrescimo')
      .reduce((s, a) => s + a.valor, 0);
    totalDescontos += desconto;

    let valor = 0;
    let detalhe = '';
    if (g.gerenteModelo === '1pp_dos_10pct' || !g.gerenteModelo) {
      // 1pp do 10% (rateado proporcional aos pp configurados)
      let total = 0;
      for (const dia of dias) {
        total += (config.ppGerente / 10) * (dezPctPorDia[dia] ?? 0);
      }
      valor = total;
      detalhe = `${config.ppGerente}pp dos 10% da semana`;
    } else if (g.gerenteModelo === 'fixo_por_dia' && g.gerenteValorFixoDia) {
      // Conta dias com horas > 0 (o gerente registrou ponto?). Se não tiver
      // horas, conta dias da semana inteira (gerente não bate ponto).
      const minTotal = sumMin(horasMap.get(g.fornecedorId) ?? {});
      let diasTrab = 0;
      if (minTotal > 0) {
        diasTrab = Object.values(horasMap.get(g.fornecedorId) ?? {}).filter((m) => m > 0)
          .length;
      } else {
        // Sem ponto — assume 7 dias
        diasTrab = 7;
        avisos.push(
          `${g.nome}: gerente fixo sem ponto — assumindo ${diasTrab} dias trabalhados.`,
        );
      }
      valor = diasTrab * g.gerenteValorFixoDia;
      detalhe = `${diasTrab} × R$ ${g.gerenteValorFixoDia.toFixed(2)}/dia`;
    }

    if (valor > 0 || desconto > 0) {
      lancamentos.push({
        fornecedorId: g.fornecedorId,
        pessoaNome: g.nome,
        papel: 'gerente',
        tipo: 'comissao',
        valorBruto: round2(valor),
        desconto: round2(desconto),
        valorLiquido: round2(valor - desconto),
        descricao: `Pró-labore semana — ${g.nome}`,
        detalhe,
      });
    }
    if (acrescimo > 0) {
      lancamentos.push({
        fornecedorId: g.fornecedorId,
        pessoaNome: g.nome,
        papel: 'gerente',
        tipo: 'gratificacao',
        valorBruto: round2(acrescimo),
        desconto: 0,
        valorLiquido: round2(acrescimo),
        descricao: `Gratificação semana — ${g.nome}`,
        detalhe: '',
      });
    }
  }

  const totalBruto = lancamentos.reduce((s, l) => s + l.valorBruto, 0);
  const totalLiquido = lancamentos.reduce((s, l) => s + l.valorLiquido, 0);

  return {
    lancamentos,
    totalEmpresa: round2(totalEmpresa),
    totalEquipe: round2(totalLiquido),
    totalBruto: round2(totalBruto),
    totalLiquido: round2(totalLiquido),
    totalDescontos: round2(totalDescontos),
    avisos,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sumMin(porDia: Record<string, number>): number {
  return Object.values(porDia).reduce((a, b) => a + b, 0);
}

function minutosToHM(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h}h${String(min).padStart(2, '0')}`;
}

function brl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
