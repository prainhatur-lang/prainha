// Engine de conciliacao OPERADORA: cruza PDV (Consumer) x Vendas Cielo.
// Persiste execucao + excecoes com processo='OPERADORA'.

import { db, schema } from '@concilia/db';
import { matchPdvCielo } from '@concilia/conciliador/engine';
import { and, eq, gte, lte, inArray, notInArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { diasFechados } from './fechamento';
import { dateToBrYmd } from './datas';
import { resolverParametros } from './conciliacao-params';

const ADQUIRENTE_CIELO = 'CIELO';
export const PROCESSO_OPERADORA = 'OPERADORA';

/** Formas que nao passam pela Cielo — nao entram na conciliacao.
 * Pix Online/Manual: passam pela Cielo LIO (tem valor bruto no arquivo Cielo),
 * o matcher encontra por fallback data+valor mesmo sem NSU.
 * iFood Online: pagamento via iFood, fora do fluxo Cielo.
 * Dinheiro/Voucher: nao passa por adquirente.
 * Transferencia bancaria/Carteira Digital: pagamento direto no banco, fora da Cielo. */
const FORMAS_EXCLUIR_OPERADORA = [
  'Dinheiro',
  'Voucher',
  'iFood Online',
  'Transferência bancária',
  'Carteira Digital',
  'Transferência bancária, Carteira Digital',
];

/** Tipos de excecao do processo Operadora */
export const TIPO_OPERADORA = {
  PDV_SEM_CIELO: 'PDV_SEM_CIELO',
  CIELO_SEM_PDV: 'CIELO_SEM_PDV',
  DIVERGENCIA_VALOR: 'DIVERGENCIA_VALOR_OPERADORA',
} as const;

export interface OperadoraResumo {
  conciliados: { qtd: number; valor: number };
  conciliadosNsu: { qtd: number; valor: number };
  conciliadosDataValor: { qtd: number; valor: number };
  divergenciaValor: { qtd: number; valor: number };
  pdvSemCielo: { qtd: number; valor: number };
  cieloSemPdv: { qtd: number; valor: number };
}

export interface OperadoraResultado {
  execucaoId: string;
  dataInicioEfetiva: string;
  dataFimEfetiva: string;
  resumo: OperadoraResumo;
  excecoesCriadas: number;
}

export async function rodarConciliacaoOperadora(opts: {
  filialId: string;
  dataInicio: string; // YYYY-MM-DD
  dataFim: string; // YYYY-MM-DD
}): Promise<OperadoraResultado> {
  const { filialId, dataFim } = opts;
  let { dataInicio } = opts;

  // Aplica corte da filial + carrega tolerancia de auto-aceite + parametros customizados
  const [fil] = await db
    .select({
      dataInicioConciliacao: schema.filial.dataInicioConciliacao,
      toleranciaAutoAceite: schema.filial.toleranciaAutoAceite,
      parametrosConciliacao: schema.filial.parametrosConciliacao,
    })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  const corte = fil?.dataInicioConciliacao ?? null;
  if (corte && dataInicio < corte) dataInicio = corte;
  const tolAutoAceite = Number(fil?.toleranciaAutoAceite ?? 0.90);
  const params = resolverParametros(fil?.parametrosConciliacao);

  // Cria execucao
  const [exec] = await db
    .insert(schema.execucaoConciliacao)
    .values({
      filialId,
      processo: PROCESSO_OPERADORA,
      dataInicio: new Date(dataInicio + 'T00:00:00-03:00'),
      dataFim: new Date(dataFim + 'T23:59:59-03:00'),
      status: 'EM_ANDAMENTO',
    })
    .returning({ id: schema.execucaoConciliacao.id });
  const execId = exec!.id;

  try {
    const dtIni = new Date(dataInicio + 'T00:00:00-03:00');
    const dtFim = new Date(dataFim + 'T23:59:59-03:00');

    // Dias com fechamento: nao reprocessa
    const fechados = await diasFechados(filialId, PROCESSO_OPERADORA, dataInicio, dataFim);

    // Carrega matches persistidos da filial. Firmes (manual OR nivel 1-3) nao
    // sao re-processados — pagamento e venda saem do input do engine. Os
    // auto-revogaveis (nivel 4-5) ENTRAM no engine: podem ser fortalecidos
    // por NSU em rodada futura. Antes de rodar engine, removemos os auto-
    // revogaveis no scope pra eles serem regerados (consistencia).
    const matchesExistentes = await db
      .select({
        id: schema.matchPdvCielo.id,
        pagamentoId: schema.matchPdvCielo.pagamentoId,
        vendaAdquirenteId: schema.matchPdvCielo.vendaAdquirenteId,
        nivelMatch: schema.matchPdvCielo.nivelMatch,
        criadoPor: schema.matchPdvCielo.criadoPor,
        autoRevogavel: schema.matchPdvCielo.autoRevogavel,
      })
      .from(schema.matchPdvCielo)
      .where(eq(schema.matchPdvCielo.filialId, filialId));

    const isFirme = (m: { nivelMatch: string; criadoPor: string; autoRevogavel: Date | null }) =>
      m.criadoPor !== 'AUTO' || (Number(m.nivelMatch) <= 3 && !m.autoRevogavel);

    const idsPagFirmes = new Set(
      matchesExistentes.filter(isFirme).map((m) => m.pagamentoId),
    );
    const idsVendaFirmes = new Set(
      matchesExistentes.filter(isFirme).map((m) => m.vendaAdquirenteId),
    );

    // Carrega pagamentos do PDV no periodo
    const pagamentosRaw = await db
      .select({
        id: schema.pagamento.id,
        nsu: schema.pagamento.nsuTransacao,
        valor: schema.pagamento.valor,
        formaPagamento: schema.pagamento.formaPagamento,
        dataPagamento: schema.pagamento.dataPagamento,
        codigoPedidoExterno: schema.pagamento.codigoPedidoExterno,
        numeroAutorizacao: schema.pagamento.numeroAutorizacaoCartao,
      })
      .from(schema.pagamento)
      .where(
        and(
          eq(schema.pagamento.filialId, filialId),
          gte(schema.pagamento.dataPagamento, dtIni),
          lte(schema.pagamento.dataPagamento, dtFim),
          // Pagamento elegivel quando: (a) tem forma e nao esta na lista de exclusao;
          // OU (b) tem NSU (passou por adquirente, mesmo sem forma — caso do bug CDC
          // forma=null em ~96% das vendas pos-01/05/2026 ate fix 2f5efbf chegar a prod).
          // Pagamentos (b) com autorizacao de Pix (EndToEndId BACEN) sao filtrados
          // adiante em JS: so entram se o NSU deles existir nas vendas Cielo do
          // periodo (= Pix pago NA MAQUININHA da Cielo, que liquida via Cielo).
          // Pix comum (direto na conta) fica fora — concilia banco x PDV.
          or(
            and(
              isNotNull(schema.pagamento.formaPagamento),
              notInArray(schema.pagamento.formaPagamento, FORMAS_EXCLUIR_OPERADORA),
            ),
            and(
              isNull(schema.pagamento.formaPagamento),
              isNotNull(schema.pagamento.nsuTransacao),
            ),
          ),
        ),
      );
    const isAuthPixE2E = (a: string | null) => !!a && a.length === 32 && /^E\d{8}/.test(a);
    const pagamentosPreFiltro = pagamentosRaw.filter((p) => {
      if (idsPagFirmes.has(p.id)) return false;
      if (!p.dataPagamento) return true;
      return !fechados.has(dateToBrYmd(p.dataPagamento));
    });

    // Carrega vendas Cielo com janela de +-1 dia pra cobrir virada do dia
    // (venda PDV 23:50 pode aparecer na Cielo no dia seguinte)
    const dtIniCielo = new Date(dtIni);
    dtIniCielo.setDate(dtIniCielo.getDate() - 1);
    const dtFimCielo = new Date(dtFim);
    dtFimCielo.setDate(dtFimCielo.getDate() + 1);
    const dataInicioCielo = dtIniCielo.toISOString().slice(0, 10);
    const dataFimCielo = dtFimCielo.toISOString().slice(0, 10);

    const vendasRaw = await db
      .select({
        id: schema.vendaAdquirente.id,
        nsu: schema.vendaAdquirente.nsu,
        valorBruto: schema.vendaAdquirente.valorBruto,
        dataVenda: schema.vendaAdquirente.dataVenda,
        horaVenda: schema.vendaAdquirente.horaVenda,
        formaPagamento: schema.vendaAdquirente.formaPagamento,
        bandeira: schema.vendaAdquirente.bandeira,
        autorizacao: schema.vendaAdquirente.autorizacao,
      })
      .from(schema.vendaAdquirente)
      .where(
        and(
          eq(schema.vendaAdquirente.filialId, filialId),
          eq(schema.vendaAdquirente.adquirente, ADQUIRENTE_CIELO),
          gte(schema.vendaAdquirente.dataVenda, dataInicioCielo),
          lte(schema.vendaAdquirente.dataVenda, dataFimCielo),
        ),
      );
    const vendas = vendasRaw.filter((v) => !idsVendaFirmes.has(v.id));

    // Pagamento sem forma cuja autorizacao e um EndToEndId Pix: so entra no pool
    // se o NSU dele aparece nas vendas Cielo do periodo (Pix via maquininha).
    const nsusVendas = new Set(vendasRaw.map((v) => v.nsu).filter(Boolean));
    const pagamentos = pagamentosPreFiltro.filter(
      (p) =>
        p.formaPagamento !== null ||
        !isAuthPixE2E(p.numeroAutorizacao) ||
        (p.nsu != null && nsusVendas.has(p.nsu)),
    );

    // Apaga matches AUTO auto-revogaveis no scope — vao ser regerados pelo engine.
    // NUNCA toca em manuais ou firmes (idsPagFirmes / idsVendaFirmes ja filtrados acima).
    const idsRevogaveis = matchesExistentes
      .filter((m) => m.criadoPor === 'AUTO' && m.autoRevogavel)
      .map((m) => m.id);
    if (idsRevogaveis.length > 0) {
      await db
        .delete(schema.matchPdvCielo)
        .where(inArray(schema.matchPdvCielo.id, idsRevogaveis));
    }

    // ---- RATEIO POR NSU (maquininha: mesa + comandas numa passada só) ----
    // Uma transação no terminal (um NSU) vira N baixas no PDV — uma por
    // pedido (mesa e cada comanda). O par com a venda Cielo é 1:1 (unique
    // dos dois lados), então: a PARCELA PRINCIPAL (maior valor) entra no
    // pool com o valor SOMADO do grupo e leva o match nível 1; as irmãs
    // saem do pool e ganham exceção AUTO-ACEITA auditável (tipo RATEIO_NSU)
    // apontando a mesma venda. Grupo só existe quando o app rateia — venda
    // avulsa nunca repete NSU+autorização+dia.
    const chaveNsu = (p: (typeof pagamentos)[number]) =>
      `${p.nsu}|${p.numeroAutorizacao ?? ''}|${p.dataPagamento ? dateToBrYmd(p.dataPagamento) : ''}`;
    const gruposPorChave = new Map<string, typeof pagamentos>();
    for (const p of pagamentos) {
      if (!p.nsu) continue;
      const arr = gruposPorChave.get(chaveNsu(p));
      if (arr) arr.push(p);
      else gruposPorChave.set(chaveNsu(p), [p]);
    }
    /** id do pagamento principal → parcelas-irmãs (fora do pool) */
    const irmasPorPrimary = new Map<string, typeof pagamentos>();
    /** id do principal → valor somado do grupo */
    const valorGrupo = new Map<string, number>();
    const idsIrmas = new Set<string>();
    for (const grupo of gruposPorChave.values()) {
      if (grupo.length < 2) continue;
      const ordenado = [...grupo].sort((a, b) => Number(b.valor) - Number(a.valor));
      const primary = ordenado[0];
      const irmas = ordenado.slice(1);
      irmasPorPrimary.set(primary.id, irmas);
      valorGrupo.set(primary.id, +grupo.reduce((s, p) => s + Number(p.valor), 0).toFixed(2));
      irmas.forEach((p) => idsIrmas.add(p.id));
    }

    // Roda matcher (NSU + fallback data+valor+forma)
    const result = matchPdvCielo(
      pagamentos
        .filter((p) => !idsIrmas.has(p.id))
        .map((p) => ({
          id: p.id,
          nsu: p.nsu,
          valor: valorGrupo.get(p.id) ?? Number(p.valor),
          formaPagamento: p.formaPagamento ?? '',
          // data em BRT pra bater com venda_adquirente.dataVenda (BRT).
          dataPagamento: p.dataPagamento ? dateToBrYmd(p.dataPagamento) : undefined,
          codigoPedidoExterno: p.codigoPedidoExterno ?? null,
          numeroAutorizacao: p.numeroAutorizacao ?? null,
        })),
      vendas.map((v) => ({
        id: v.id,
        nsu: v.nsu,
        valorBruto: Number(v.valorBruto),
        dataVenda: v.dataVenda,
        formaPagamento: v.formaPagamento ?? '',
        autorizacao: v.autorizacao ?? null,
      })),
      params.pdvCielo,
    );

    // IDs de pagamentos e vendas em scope (nao fechados). Usado pra preservar
    // excecoes de dias fechados ao limpar o estado.
    const pagamentoIdsScope = pagamentos.map((p) => p.id);
    const vendaIdsScope = vendas.filter((v) => !fechados.has(v.dataVenda)).map((v) => v.id);

    // Limpa excecoes abertas SOMENTE dos itens em scope (preserva dias fechados).
    if (pagamentoIdsScope.length || vendaIdsScope.length) {
      const orConds = [];
      if (pagamentoIdsScope.length) {
        orConds.push(inArray(schema.excecao.pagamentoId, pagamentoIdsScope));
      }
      if (vendaIdsScope.length) {
        orConds.push(inArray(schema.excecao.vendaAdquirenteId, vendaIdsScope));
      }
      await db
        .delete(schema.excecao)
        .where(
          and(
            eq(schema.excecao.filialId, filialId),
            eq(schema.excecao.processo, PROCESSO_OPERADORA),
            isNull(schema.excecao.aceitaEm),
            orConds.length === 1 ? orConds[0] : or(...orConds),
          ),
        );
    }

    // Limpa excecoes STALE de pagamentos/vendas que JA tem match firme.
    // Cobre o caso onde uma rodada anterior gerou excecao, depois um aceite
    // manual ou nova rodada gerou match firme, mas a excecao continuou
    // aberta (engine v2 nao incluia firmes no scope da limpeza acima).
    const idsPagFirmesArr = [...idsPagFirmes];
    const idsVendaFirmesArr = [...idsVendaFirmes];
    if (idsPagFirmesArr.length > 0 || idsVendaFirmesArr.length > 0) {
      const orStaleConds = [];
      if (idsPagFirmesArr.length > 0) {
        orStaleConds.push(inArray(schema.excecao.pagamentoId, idsPagFirmesArr));
      }
      if (idsVendaFirmesArr.length > 0) {
        orStaleConds.push(inArray(schema.excecao.vendaAdquirenteId, idsVendaFirmesArr));
      }
      await db
        .delete(schema.excecao)
        .where(
          and(
            eq(schema.excecao.filialId, filialId),
            eq(schema.excecao.processo, PROCESSO_OPERADORA),
            isNull(schema.excecao.aceitaEm),
            orStaleConds.length === 1 ? orStaleConds[0] : or(...orStaleConds),
          ),
        );
    }

    // Monta excecoes
    const novasExcecoes: Array<typeof schema.excecao.$inferInsert> = [];
    /** Matches que ESTE orquestrador cria fora do engine — hoje so o
     *  casamento por horario das vendas Cielo que ficariam sem PDV. */
    const matchesPorHorario: Array<typeof schema.matchPdvCielo.$inferInsert> = [];
    /** forma+bandeira da Cielo a gravar em pagamento.forma_efetiva */
    const updatesEfetivas: Array<{
      pagamentoId: string;
      forma: string | null;
      bandeira: string | null;
    }> = [];
    const vendasPorIdLookup = new Map(vendasRaw.map((v) => [v.id, v]));

    const pedidoTxt = (p: { codigoPedidoExterno?: number | null }) =>
      p.codigoPedidoExterno ? `Pedido #${p.codigoPedidoExterno}` : 'Pedido ?';

    // Parcelas-irmãs do rateio por NSU: exceção que JÁ NASCE aceita — o
    // dinheiro delas está dentro do match do par principal. Dedupe por
    // pagamento (rodadas seguintes não duplicam).
    if (idsIrmas.size > 0) {
      const jaTem = new Set(
        (
          await db
            .select({ pagamentoId: schema.excecao.pagamentoId })
            .from(schema.excecao)
            .where(
              and(
                eq(schema.excecao.filialId, filialId),
                eq(schema.excecao.tipo, 'RATEIO_NSU'),
                inArray(schema.excecao.pagamentoId, [...idsIrmas]),
              ),
            )
        ).map((e) => e.pagamentoId),
      );
      const vendaDoPrimary = new Map<string, string | undefined>();
      for (const m of result.matched) vendaDoPrimary.set(m.pdv.id, m.cielo.id);
      for (const d of result.divergenciaValor) vendaDoPrimary.set(d.pdv.id, d.cielo.id);
      for (const [primaryId, irmas] of irmasPorPrimary) {
        const primary = pagamentos.find((p) => p.id === primaryId);
        for (const irma of irmas) {
          if (jaTem.has(irma.id)) continue;
          novasExcecoes.push({
            filialId,
            processo: PROCESSO_OPERADORA,
            pagamentoId: irma.id,
            vendaAdquirenteId: vendaDoPrimary.get(primaryId) ?? null,
            tipo: 'RATEIO_NSU',
            severidade: 'info',
            valor: String(irma.valor),
            descricao:
              `${pedidoTxt(irma)} — parcela de R$ ${Number(irma.valor).toFixed(2)} do rateio da ` +
              `maquininha (NSU ${irma.nsu}, mesa+comandas numa passada). A venda Cielo casa no ` +
              `par principal (${primary ? pedidoTxt(primary) : 'pedido ?'}, grupo de ` +
              `R$ ${(valorGrupo.get(primaryId) ?? 0).toFixed(2)}).`,
            aceitaEm: new Date(),
            motivo: 'OUTRO',
            observacao: 'aceita automaticamente: rateio mesa+comandas da maquininha',
          });
        }
      }
    }

    for (const { pdv, cielo, diff } of result.divergenciaValor) {
      // Auto-aceita quando |diff| <= toleranciaAutoAceite (default R$ 0,90)
      // E delta de dias <= 1 (mesmo dia ou +-1 dia — Cielo as vezes registra
      // a venda no dia anterior/posterior por fechamento de caixa / clock
      // drift). Cria registro com aceitaEm preenchido pra o rastreado contar
      // como conciliado e o banco engine aplicar a forma da Cielo.
      const deltaDias =
        pdv.dataPagamento && cielo.dataVenda
          ? Math.abs(
              (new Date(pdv.dataPagamento + 'T00:00:00').getTime() -
                new Date(cielo.dataVenda + 'T00:00:00').getTime()) /
                86_400_000,
            )
          : Infinity;
      const autoAceita = Math.abs(diff) <= tolAutoAceite && deltaDias <= 1;

      // Caso especial: diff exato R$ 0 + mesma data + forma de pagamento diferente
      // entre PDV e Cielo. Engine cai aqui via passada 3 (matching solto cross-cat).
      // Não é divergência de VALOR — é divergência de CATEGORIA DE FORMA. Tipica
      // causa: garçom apertou Crédito no PDV mas era Débito (ou vice-versa).
      const valorBate = Math.abs(diff) < 0.01;
      const formasDiferem =
        (pdv.formaPagamento ?? '').trim().toLowerCase() !==
        (cielo.formaPagamento ?? '').trim().toLowerCase();
      const ehFormaDivergente = valorBate && formasDiferem && deltaDias <= 1;

      novasExcecoes.push({
        filialId,
        processo: PROCESSO_OPERADORA,
        pagamentoId: pdv.id,
        vendaAdquirenteId: cielo.id ?? null,
        tipo: TIPO_OPERADORA.DIVERGENCIA_VALOR,
        severidade: ehFormaDivergente ? 'BAIXA' : autoAceita ? 'BAIXA' : 'MEDIA',
        descricao: ehFormaDivergente
          ? `${pedidoTxt(pdv)} — Forma corrigida automaticamente: PDV marcou "${pdv.formaPagamento}", na Cielo é "${cielo.formaPagamento ?? '?'}" (valor R$ ${pdv.valor.toFixed(2)} e data conferem exatos). Vale a da Cielo.`
          : autoAceita
            ? `${pedidoTxt(pdv)} — Match automatico: PDV R$ ${pdv.valor.toFixed(2)} = Cielo R$ ${cielo.valorBruto.toFixed(2)} mesma data. Forma PDV: ${pdv.formaPagamento}, forma Cielo: ${cielo.formaPagamento ?? '?'}.`
            : `${pedidoTxt(pdv)} — PDV R$ ${pdv.valor.toFixed(2)} vs Cielo R$ ${cielo.valorBruto.toFixed(2)} (diff ${diff > 0 ? '+' : ''}${diff.toFixed(2)}). NSU ${pdv.nsu}.`,
        valor: String(pdv.valor),
        // Forma divergente com valor E data exatos tambem eh auto-aceita: a
        // Cielo eh a fonte da verdade da forma, entao isso eh erro de cadastro
        // do garcom, nao ambiguidade. Fica registrada (com motivo) pra virar
        // relatorio de retreinamento, mas nao ocupa a fila de pendencias.
        aceitaEm: autoAceita || ehFormaDivergente ? new Date() : null,
        motivo: ehFormaDivergente ? 'FORMA_ERRADA_GARCOM' : null,
        observacao: ehFormaDivergente
          ? 'Aceita automaticamente: valor e data batem exatos, só a categoria da forma difere. Aplicada a forma da Cielo no pagamento.'
          : autoAceita
            ? 'Aceita automaticamente: valor e data batem exatos, forma divergente ajustada para usar a da Cielo.'
            : null,
      });
    }
    for (const pdv of result.pdvSemCielo) {
      novasExcecoes.push({
        filialId,
        processo: PROCESSO_OPERADORA,
        pagamentoId: pdv.id,
        tipo: TIPO_OPERADORA.PDV_SEM_CIELO,
        severidade: 'ALTA',
        descricao: `${pedidoTxt(pdv)} — ${pdv.formaPagamento || 'sem forma'}, NSU ${pdv.nsu ?? '—'}, sem venda correspondente na Cielo.`,
        valor: String(pdv.valor),
      });
    }
    // cieloSemPdv: so reporta as vendas cujo dataVenda esteja no range nominal.
    // Vendas em D-1 e D+1 foram carregadas pra casar com PDV (virada de dia),
    // mas se sobraram sem PDV pode ser venda de outro periodo.
    const vendasPorId = new Map(vendas.map((v) => [v.id, v]));
    const cieloSemPdvNoRange = result.cieloSemPdv.filter((c) => {
      if (!c.id) return true;
      const v = vendasPorId.get(c.id);
      if (!v) return true;
      if (fechados.has(v.dataVenda)) return false; // venda em dia fechado nao vira excecao
      return v.dataVenda >= dataInicio && v.dataVenda <= dataFim;
    });
    // --- SUGESTÃO de par pra CIELO_SEM_PDV: pagamento com MESMA DATA + MESMO
    // VALOR mas forma divergente/ausente. Cobre:
    //  (1) pagamento fora do pool: forma=null sem NSU (bug CDC — ex. "Pix
    //      Manual" lançado sem TEF) ou forma excluída (ex. Dinheiro) quando na
    //      real a cobrança passou na maquininha;
    //  (2) pagamento no pool que sobrou sem match (NSU divergente).
    // NUNCA vira match automático — a exceção nasce com o pagamento sugerido
    // (pagamentoId + texto) e o usuário confirma no Resolver.
    const idsNoPool = new Set(pagamentos.map((p) => p.id));
    const candidatosForaPool = await db
      .select({
        id: schema.pagamento.id,
        valor: schema.pagamento.valor,
        formaPagamento: schema.pagamento.formaPagamento,
        dataPagamento: schema.pagamento.dataPagamento,
        codigoPedidoExterno: schema.pagamento.codigoPedidoExterno,
        numeroAutorizacao: schema.pagamento.numeroAutorizacaoCartao,
        nsu: schema.pagamento.nsuTransacao,
      })
      .from(schema.pagamento)
      .where(
        and(
          eq(schema.pagamento.filialId, filialId),
          gte(schema.pagamento.dataPagamento, dtIni),
          lte(schema.pagamento.dataPagamento, dtFim),
          or(
            and(isNull(schema.pagamento.formaPagamento), isNull(schema.pagamento.nsuTransacao)),
            inArray(schema.pagamento.formaPagamento, FORMAS_EXCLUIR_OPERADORA),
          ),
        ),
      );
    type CandSugestao = {
      id: string;
      valor: number;
      pedido: number | null;
      forma: string | null;
      dentroDoPool: boolean;
      nsu: string | null;
      /** instante do pagamento — usado como chave forte quando falta NSU */
      quando: Date | null;
    };

    /**
     * Minutos entre a venda da Cielo e o pagamento do PDV. Vale como
     * evidencia forte: dois pagamentos do MESMO valor exato a poucos minutos
     * um do outro sao o mesmo evento, mesmo sem NSU nem forma (caso classico
     * do pedido aberto num dia e fechado no outro, e do bug do CDC que manda
     * forma=null). Retorna null quando falta hora dos dois lados.
     */
    const minutosEntre = (
      dataVenda: string,
      horaVenda: string | null,
      pagamentoEm: Date | null,
    ): number | null => {
      if (!horaVenda || !pagamentoEm) return null;
      const hhmm = horaVenda.match(/^(\d{2}):(\d{2})/);
      if (!hhmm) return null;
      const venda = new Date(`${dataVenda}T${hhmm[1]}:${hhmm[2]}:00-03:00`);
      if (Number.isNaN(venda.getTime())) return null;
      return Math.abs(venda.getTime() - pagamentoEm.getTime()) / 60_000;
    };
    /** Janela de horario que dispensa NSU. 20min cobre o atraso entre a
     *  autorizacao na maquininha e o fechamento da conta no PDV. */
    const JANELA_MINUTOS = 20;
    // Candidatos agrupados por DIA; o valor casa com a MESMA tolerância que o
    // engine usa (max(absoluta, valor*percentual) dos parâmetros da filial) —
    // cobre centavos de gorjeta/arredondamento (ex: PDV 381,48 vs Cielo 381,40).
    const tolSugestao = (valor: number) =>
      Math.max(
        params.pdvCielo.toleranciaAbsoluta,
        Math.abs(valor) * params.pdvCielo.toleranciaPercentual,
      );
    const sugestoesPorDia = new Map<string, CandSugestao[]>();
    const addCandidato = (data: string | Date | null, c: CandSugestao) => {
      if (!data) return;
      const dia = typeof data === 'string' ? data : dateToBrYmd(data);
      if (fechados.has(dia)) return;
      const arr = sugestoesPorDia.get(dia) ?? [];
      arr.push(c);
      sugestoesPorDia.set(dia, arr);
    };
    // (1) fora do pool — preferidos (o motor nem os viu)
    for (const p of candidatosForaPool) {
      if (idsNoPool.has(p.id) || idsPagFirmes.has(p.id)) continue;
      if (isAuthPixE2E(p.numeroAutorizacao)) continue; // Pix direto: concilia no fluxo banco
      addCandidato(p.dataPagamento, {
        id: p.id,
        valor: Number(p.valor),
        pedido: p.codigoPedidoExterno ?? null,
        forma: p.formaPagamento,
        dentroDoPool: false,
        nsu: p.nsu,
        quando: p.dataPagamento ?? null,
      });
    }
    // (2) órfãos do pool (sem match; NSU divergente) — segunda preferência
    const horaPorPagamento = new Map(
      pagamentosRaw.map((p) => [p.id, p.dataPagamento ?? null]),
    );
    for (const pdv of result.pdvSemCielo) {
      addCandidato(pdv.dataPagamento ?? null, {
        id: pdv.id,
        valor: pdv.valor,
        pedido: pdv.codigoPedidoExterno ?? null,
        forma: pdv.formaPagamento || null,
        dentroDoPool: true,
        nsu: pdv.nsu ?? null,
        quando: horaPorPagamento.get(pdv.id) ?? null,
      });
    }

    for (const cielo of cieloSemPdvNoRange) {
      const v = cielo.id ? vendasPorId.get(cielo.id) : undefined;
      let sug: CandSugestao | undefined;
      if (v) {
        const bucket = sugestoesPorDia.get(v.dataVenda) ?? [];
        const tol = tolSugestao(cielo.valorBruto);
        let melhorIdx = -1;
        let melhorRank = Infinity;
        for (let i = 0; i < bucket.length; i++) {
          const diff = Math.abs(bucket[i]!.valor - cielo.valorBruto);
          if (diff > tol) continue;
          // rank: menor diff primeiro; empate → fora-do-pool na frente
          const rank = diff * 10 + (bucket[i]!.dentroDoPool ? 1 : 0);
          if (rank < melhorRank) {
            melhorRank = rank;
            melhorIdx = i;
          }
        }
        if (melhorIdx >= 0) sug = bucket.splice(melhorIdx, 1)[0];
      }
      const diffSug = sug ? +(sug.valor - cielo.valorBruto).toFixed(2) : 0;

      // Match automatico por HORARIO: valor exato + poucos minutos de
      // distancia identificam o mesmo evento sem precisar de NSU. Resolve o
      // caso classico do pedido aberto num dia e fechado no outro, e o do
      // pagamento que o CDC manda sem forma e sem NSU. Fora dessa janela
      // continua sendo sugestao pro usuario confirmar.
      const minutos =
        sug && v ? minutosEntre(v.dataVenda, v.horaVenda, sug.quando) : null;
      if (sug && cielo.id && Math.abs(diffSug) < 0.01 && minutos != null && minutos <= JANELA_MINUTOS) {
        matchesPorHorario.push({
          filialId,
          pagamentoId: sug.id,
          vendaAdquirenteId: cielo.id,
          nivelMatch: '3',
          autoRevogavel: null,
          criadoPor: 'AUTO',
          diffValor: '0.00',
          observacao: `Casado por valor exato e horario (${Math.round(minutos)} min entre a venda na Cielo e o fechamento no PDV)${sug.forma ? '' : ' — pagamento sem forma/NSU no PDV'}.`,
        });
        // a forma da Cielo passa a valer no pagamento (o PDV nao informou)
        const vendaCielo = vendasPorIdLookup.get(cielo.id);
        if (vendaCielo) {
          updatesEfetivas.push({
            pagamentoId: sug.id,
            forma: vendaCielo.formaPagamento ?? null,
            bandeira: vendaCielo.bandeira ?? null,
          });
        }
        continue; // nao vira excecao
      }

      const sugTxt = sug
        ? ` SUGESTÃO: ${sug.pedido ? `Pedido #${sug.pedido}` : 'pagamento'} de R$ ${sug.valor.toFixed(2)} no mesmo dia${Math.abs(diffSug) >= 0.01 ? ` (diff R$ ${Math.abs(diffSug).toFixed(2)})` : ''}${minutos != null ? `, ${Math.round(minutos)} min de diferença` : ''}, forma ${sug.forma ? `"${sug.forma}"` : 'não informada (lançamento manual, sem TEF)'}${sug.dentroDoPool ? `, NSU divergente (${sug.nsu ?? '—'})` : ', sem NSU'} — provável par. Confirme e resolva.`
        : '';
      novasExcecoes.push({
        filialId,
        processo: PROCESSO_OPERADORA,
        vendaAdquirenteId: cielo.id ?? null,
        pagamentoId: sug?.id ?? null,
        tipo: TIPO_OPERADORA.CIELO_SEM_PDV,
        severidade: sug ? 'MEDIA' : 'ALTA',
        descricao: `Venda na Cielo (NSU ${cielo.nsu}, R$ ${cielo.valorBruto.toFixed(2)}) sem pagamento no PDV.${sugTxt}`,
        valor: String(cielo.valorBruto),
      });
    }

    if (novasExcecoes.length > 0) {
      await db.insert(schema.excecao).values(novasExcecoes);
    }

    // Propaga forma+bandeira da Cielo pro pagamento.formaEfetiva quando:
    //  1) Match firme (nivel 1-3) onde forma do PDV difere da da Cielo
    //     (engine resolveu via NSU mas garcom errou categoria)
    //  2) Auto-aceita com formas diferentes (rodarConciliacaoOperadora setou aceitaEm)
    // Pra divergencia manual NAO setamos aqui — o user aceita via API e a
    // popular acontece no PATCH /api/excecoes/[id].
    for (const m of result.matched) {
      if (!m.cielo.id) continue;
      const v = vendasPorIdLookup.get(m.cielo.id);
      if (!v) continue;
      const formaPdv = (m.pdv.formaPagamento ?? '').trim().toLowerCase();
      const formaCielo = (v.formaPagamento ?? '').trim().toLowerCase();
      if (formaPdv === formaCielo) continue;
      updatesEfetivas.push({
        pagamentoId: m.pdv.id,
        forma: v.formaPagamento ?? null,
        bandeira: v.bandeira ?? null,
      });
    }
    // Auto-aceitas (non-form-divergent) tambem marcam — a engine ja decidiu
    // que e o mesmo pagamento pelo valor, vale propagar a forma.
    for (const { pdv, cielo, diff } of result.divergenciaValor) {
      if (!cielo.id) continue;
      const valorBate = Math.abs(diff) < 0.01;
      const deltaDias =
        pdv.dataPagamento && cielo.dataVenda
          ? Math.abs(
              (new Date(pdv.dataPagamento + 'T00:00:00').getTime() -
                new Date(cielo.dataVenda + 'T00:00:00').getTime()) /
                86_400_000,
            )
          : Infinity;
      const formasDiferem =
        (pdv.formaPagamento ?? '').trim().toLowerCase() !==
        (cielo.formaPagamento ?? '').trim().toLowerCase();
      const ehFormaDivergente = valorBate && formasDiferem && deltaDias <= 1;
      const autoAceita = Math.abs(diff) <= tolAutoAceite && deltaDias <= 1;
      // Todo caso auto-aceito com forma diferente (inclusive o de forma
      // divergente puro) passa a valer a forma da Cielo no pagamento — eh o
      // que faz a perna do banco classificar Pix/cartao corretamente.
      if ((autoAceita || ehFormaDivergente) && formasDiferem) {
        const v = vendasPorIdLookup.get(cielo.id);
        if (v) {
          updatesEfetivas.push({
            pagamentoId: pdv.id,
            forma: v.formaPagamento ?? null,
            bandeira: v.bandeira ?? null,
          });
        }
      }
    }
    // Batched parallel updates pra evitar N+1 sequencial (gargalo: 1.5k pagamentos
    // × 10ms/query = 15s). Vercel maxDuration=60s, qualquer engine grande estourava.
    // Limita 50 em paralelo pra nao saturar pool de conexao.
    const BATCH = 50;
    for (let i = 0; i < updatesEfetivas.length; i += BATCH) {
      await Promise.all(
        updatesEfetivas.slice(i, i + BATCH).map((u) =>
          db
            .update(schema.pagamento)
            .set({ formaEfetiva: u.forma, bandeiraEfetiva: u.bandeira })
            .where(eq(schema.pagamento.id, u.pagamentoId)),
        ),
      );
    }

    // Persiste matches novos em match_pdv_cielo. Niveis 1-3 sao firmes;
    // 4-5 sao auto_revogavel (podem ser quebrados em rodada futura quando
    // aparecer NSU). Cada nivel da engine entra como tal.
    const matchesPersistir: Array<typeof schema.matchPdvCielo.$inferInsert> = result.matched.map((m) => {
      const nivel = m.nivel;
      const revogavel = nivel >= 4;
      return {
        filialId,
        pagamentoId: m.pdv.id,
        vendaAdquirenteId: m.cielo.id!,
        nivelMatch: String(nivel),
        autoRevogavel: revogavel ? new Date() : null,
        criadoPor: 'AUTO',
        diffValor: m.diff.toFixed(2),
      };
    }).filter((row) => row.vendaAdquirenteId);
    // Os casados por horario entram junto — mesma tabela, mesmo onConflict.
    matchesPersistir.push(...matchesPorHorario);
    if (matchesPersistir.length > 0) {
      await db
        .insert(schema.matchPdvCielo)
        .values(matchesPersistir)
        .onConflictDoNothing({ target: [schema.matchPdvCielo.pagamentoId] });
    }

    // Resumo
    const sum = (arr: Array<{ valor: number }>) => arr.reduce((s, x) => s + x.valor, 0);
    const matchedNsu = result.matched.filter(
      (m) => m.matchType === 'NSU' || m.matchType === 'NSU_AUTH',
    );
    const matchedDV = result.matched.filter((m) => m.matchType === 'DATA_VALOR');
    // O que virou match por horario sai de "Cielo sem PDV" e entra em
    // conciliados — senao o resumo reporta como pendencia algo ja casado.
    const casadosPorHorario = new Set(matchesPorHorario.map((m) => m.vendaAdquirenteId));
    const cieloSemPdvFinal = cieloSemPdvNoRange.filter(
      (c) => !c.id || !casadosPorHorario.has(c.id),
    );
    const valorPorHorario = cieloSemPdvNoRange
      .filter((c) => c.id && casadosPorHorario.has(c.id))
      .reduce((s, c) => s + c.valorBruto, 0);

    const resumo: OperadoraResumo = {
      conciliados: {
        qtd: result.matched.length + matchesPorHorario.length,
        valor: result.matched.reduce((s, m) => s + m.pdv.valor, 0) + valorPorHorario,
      },
      conciliadosNsu: {
        qtd: matchedNsu.length,
        valor: matchedNsu.reduce((s, m) => s + m.pdv.valor, 0),
      },
      conciliadosDataValor: {
        qtd: matchedDV.length,
        valor: matchedDV.reduce((s, m) => s + m.pdv.valor, 0),
      },
      divergenciaValor: {
        qtd: result.divergenciaValor.length,
        valor: result.divergenciaValor.reduce((s, m) => s + m.pdv.valor, 0),
      },
      pdvSemCielo: {
        qtd: result.pdvSemCielo.length,
        valor: sum(result.pdvSemCielo),
      },
      cieloSemPdv: {
        qtd: cieloSemPdvFinal.length,
        valor: cieloSemPdvFinal.reduce((s, v) => s + v.valorBruto, 0),
      },
    };

    await db
      .update(schema.execucaoConciliacao)
      .set({
        finalizadoEm: new Date(),
        status: 'OK',
        resumo: resumo as unknown as Record<string, unknown>,
      })
      .where(eq(schema.execucaoConciliacao.id, execId));

    return {
      execucaoId: execId,
      dataInicioEfetiva: dataInicio,
      dataFimEfetiva: dataFim,
      resumo,
      excecoesCriadas: novasExcecoes.length,
    };
  } catch (e) {
    await db
      .update(schema.execucaoConciliacao)
      .set({
        finalizadoEm: new Date(),
        status: 'ERRO',
        erro: (e as Error).message,
      })
      .where(eq(schema.execucaoConciliacao.id, execId));
    throw e;
  }
}
