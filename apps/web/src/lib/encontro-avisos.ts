// Conferência do encontro de contas ANTES de fechar (22/10/2026).
//
// O dono reclamou que o encontro "ia e voltava" entre as casas. As causas que
// apareceram nos dados de out/2026:
//  - boleto do Inter do Bar lançado no encontro como conta da Mar, e depois a
//    conta do Bar baixada pelo MESMO boleto (Laticínios) → a Mar deve uma conta
//    que é do Bar;
//  - a conta da Mar foi excluída e o boleto continuou no encontro;
//  - a mesma compra cobrada 2x: transferência da mercadoria + boleto pago;
//  - transferência lançada 2x (Tabuará → Bar, R$ 519,50) e ida e volta de
//    teste (Mar ↔ Bar, R$ 3,57);
//  - boleto que entrou numa competência que já tinha sido fechada.
// Aqui só se AVISA (nada muda sozinho): cada aviso aponta a conta, a
// transferência ou o boleto pra quem fecha conferir e, se for o caso, tirar.

import { and, eq, gte, ilike, inArray, isNull, lte, ne, or } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { baixaCitaBoleto, somaDias, soDigitos } from '@/lib/boletos-inter';
import type { ParEncontro } from '@/lib/transferencia';
import { brl } from '@/lib/format';

export type AvisoEncontro = {
  chave: string;
  gravidade: 'alta' | 'media';
  texto: string;
  links: { href: string; rotulo: string }[];
  /** boletos ABERTOS envolvidos (dá pra tirar do encontro) */
  pagamentos: { id: string; rotulo: string }[];
  /** transferências ABERTAS envolvidas (dá pra cancelar) */
  transferencias: { id: string; numero: number }[];
};

type Lanc = {
  tipo: 'T' | 'P';
  id: string;
  devedora: string;
  credora: string;
  valores: Set<number>; // centavos (no boleto: o pago e o da conta)
  data: string;
  status: string;
  notas: Set<number>;
  rotulo: string;
  numero: number | null;
  contaPagarId: string | null;
  noEncontro: boolean;
};

const cent = (v: number | string | null | undefined) => Math.round(Number(v ?? 0) * 100);
const ddmm = (ymd: string | null | undefined) => (ymd ? ymd.slice(0, 10).split('-').reverse().slice(0, 2).join('/') : '');
const dias = (a: string, b: string) =>
  Math.abs(Date.parse(`${a.slice(0, 10)}T12:00:00Z`) - Date.parse(`${b.slice(0, 10)}T12:00:00Z`)) / 86_400_000;

/** Números de nota do texto (3 a 9 dígitos, sem zeros à esquerda), tirando
 *  as datas ("venc. 06/10/2026" não vira nota 2026). */
function numerosDoTexto(textos: (string | null | undefined)[]): Set<number> {
  const nums = new Set<number>();
  for (const t0 of textos) {
    const t = (t0 ?? '')
      .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, ' ')
      .replace(/\d{4}-\d{2}-\d{2}/g, ' ');
    for (const m of t.matchAll(/\d{3,9}/g)) {
      const n = Number(m[0]);
      if (n >= 100) nums.add(n);
    }
  }
  return nums;
}

const cruza = (a: Set<number>, b: Set<number>) => [...a].find((x) => b.has(x));

export async function avisosEncontro(competencia: string, pares: ParEncontro[]): Promise<AvisoEncontro[]> {
  const idsT = pares.flatMap((p) => p.transferencias);
  const idsP = pares.flatMap((p) => p.pagamentos);
  if (!idsT.length && !idsP.length) return [];
  const casas = [...new Set(pares.flatMap((p) => [p.a, p.b]))];
  const ini = somaDias(`${competencia}-01`, -75);
  const fim = somaDias(`${competencia}-01`, 105);

  const filiais = await db
    .select({ id: schema.filial.id, nome: schema.filial.nome, cnpj: schema.filial.cnpj })
    .from(schema.filial);
  const nome = new Map(filiais.map((f) => [f.id, f.nome]));
  const cnpjCasa = new Map(filiais.map((f) => [f.id, soDigitos(f.cnpj)]));
  const n = (id: string) => nome.get(id) ?? 'outra casa';

  // ---- transferências e boletos entre as mesmas casas, em volta do mês ----
  const trs = await db
    .select({
      id: schema.transferenciaFilial.id,
      numero: schema.transferenciaFilial.numero,
      origem: schema.transferenciaFilial.filialOrigemId,
      destino: schema.transferenciaFilial.filialDestinoId,
      data: schema.transferenciaFilial.data,
      valor: schema.transferenciaFilial.valorTotal,
      status: schema.transferenciaFilial.status,
      observacao: schema.transferenciaFilial.observacao,
      notaNumero: schema.notaCompra.numero,
    })
    .from(schema.transferenciaFilial)
    .leftJoin(schema.notaCompra, eq(schema.notaCompra.id, schema.transferenciaFilial.notaCompraId))
    .where(
      or(
        idsT.length ? inArray(schema.transferenciaFilial.id, idsT) : undefined,
        and(
          inArray(schema.transferenciaFilial.filialOrigemId, casas),
          inArray(schema.transferenciaFilial.filialDestinoId, casas),
          ne(schema.transferenciaFilial.status, 'CANCELADA'),
          gte(schema.transferenciaFilial.data, ini),
          lte(schema.transferenciaFilial.data, fim),
        ),
      ),
    );
  const pags = await db
    .select({
      id: schema.pagamentoEntreCasas.id,
      pagadora: schema.pagamentoEntreCasas.filialPagadoraId,
      devedora: schema.pagamentoEntreCasas.filialDevedoraId,
      contaPagarId: schema.pagamentoEntreCasas.contaPagarId,
      codigo: schema.pagamentoEntreCasas.codigoExterno,
      data: schema.pagamentoEntreCasas.data,
      valor: schema.pagamentoEntreCasas.valor,
      status: schema.pagamentoEntreCasas.status,
      descricao: schema.pagamentoEntreCasas.descricao,
    })
    .from(schema.pagamentoEntreCasas)
    .where(
      or(
        idsP.length ? inArray(schema.pagamentoEntreCasas.id, idsP) : undefined,
        and(
          inArray(schema.pagamentoEntreCasas.filialPagadoraId, casas),
          inArray(schema.pagamentoEntreCasas.filialDevedoraId, casas),
          ne(schema.pagamentoEntreCasas.status, 'CANCELADO'),
          gte(schema.pagamentoEntreCasas.data, ini),
          lte(schema.pagamentoEntreCasas.data, fim),
        ),
      ),
    );
  const contaIds = [...new Set(pags.map((p) => p.contaPagarId).filter((x): x is string => !!x))];
  const contas = contaIds.length
    ? await db
        .select({
          id: schema.contaPagar.id,
          filialId: schema.contaPagar.filialId,
          valor: schema.contaPagar.valor,
          descricao: schema.contaPagar.descricao,
          observacao: schema.contaPagar.observacao,
          dataDelete: schema.contaPagar.dataDelete,
          fornecedorNome: schema.fornecedor.nome,
          fornecedorCnpj: schema.fornecedor.cnpjOuCpf,
          notaNumero: schema.notaCompra.numero,
          notaDest: schema.notaCompra.destCnpj,
        })
        .from(schema.contaPagar)
        .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.contaPagar.fornecedorId))
        .leftJoin(schema.notaCompra, eq(schema.notaCompra.id, schema.contaPagar.notaCompraId))
        .where(inArray(schema.contaPagar.id, contaIds))
    : [];
  const contaDe = new Map(contas.map((c) => [c.id, c]));
  const setT = new Set(idsT);
  const setP = new Set(idsP);

  const lancs: Lanc[] = [
    ...trs.map((t): Lanc => {
      const notas = numerosDoTexto([t.observacao]);
      if (t.notaNumero != null) notas.add(t.notaNumero);
      return {
        tipo: 'T',
        id: t.id,
        devedora: t.destino,
        credora: t.origem,
        valores: new Set([cent(t.valor)]),
        data: t.data,
        status: t.status,
        notas,
        rotulo: `transferência #${t.numero} ${n(t.origem)} → ${n(t.destino)} ${brl(t.valor)} (${ddmm(t.data)})`,
        numero: t.numero,
        contaPagarId: null,
        noEncontro: setT.has(t.id),
      };
    }),
    ...pags.map((p): Lanc => {
      const c = p.contaPagarId ? contaDe.get(p.contaPagarId) : undefined;
      const notas = numerosDoTexto([c?.descricao, c?.observacao]);
      if (c?.notaNumero != null) notas.add(c.notaNumero);
      const quem = c?.fornecedorNome || (p.descricao ?? 'boleto').split(' — ')[0];
      return {
        tipo: 'P',
        id: p.id,
        devedora: p.devedora,
        credora: p.pagadora,
        valores: new Set([cent(p.valor), ...(c ? [cent(c.valor)] : [])]),
        data: p.data,
        status: p.status,
        notas,
        rotulo: `boleto ${quem} ${brl(p.valor)} pago pela ${n(p.pagadora)} (${ddmm(p.data)})`,
        numero: null,
        contaPagarId: p.contaPagarId,
        noEncontro: setP.has(p.id),
      };
    }),
  ];

  const avisos: AvisoEncontro[] = [];
  const envolvidos = (ls: Lanc[]) => ({
    pagamentos: ls.filter((l) => l.tipo === 'P' && l.status === 'ABERTO').map((l) => ({ id: l.id, rotulo: l.rotulo })),
    transferencias: ls
      .filter((l) => l.tipo === 'T' && l.status === 'ABERTA')
      .map((l) => ({ id: l.id, numero: l.numero ?? 0 })),
  });
  const linksDe = (ls: Lanc[]) =>
    ls.map((l) =>
      l.tipo === 'T'
        ? { href: `/movimento/transferencias?comp=${competencia}`, rotulo: `transferência #${l.numero}` }
        : l.contaPagarId
          ? { href: `/financeiro/conta/${l.contaPagarId}`, rotulo: `conta da ${n(l.devedora)}` }
          : { href: '/financeiro/boletos-inter', rotulo: 'Boletos pagos no Inter' },
    );

  // ---- 1) boletos do encontro: a conta da devedora ainda vale? ----
  const focoP = pags.filter((p) => setP.has(p.id));
  const pagadoras = [...new Set(focoP.map((p) => p.pagadora))];
  const baixas = pagadoras.length
    ? await db
        .select({
          observacao: schema.contaPagarBaixa.observacao,
          contaId: schema.contaPagar.id,
          filialId: schema.contaPagar.filialId,
          valor: schema.contaPagar.valor,
          descricao: schema.contaPagar.descricao,
          fornecedorNome: schema.fornecedor.nome,
        })
        .from(schema.contaPagarBaixa)
        .innerJoin(schema.contaPagar, eq(schema.contaPagar.id, schema.contaPagarBaixa.contaPagarId))
        .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.contaPagar.fornecedorId))
        .where(
          and(
            inArray(schema.contaPagarBaixa.filialId, pagadoras),
            isNull(schema.contaPagar.dataDelete),
            ilike(schema.contaPagarBaixa.observacao, '%Inter%'),
            gte(schema.contaPagarBaixa.data, ini),
            lte(schema.contaPagarBaixa.data, fim),
          ),
        )
    : [];

  // notas do mesmo fornecedor e número nas casas do encontro (a nota é de quem?)
  const cnpjs = new Set<string>();
  const nums = new Set<number>();
  for (const p of focoP) {
    const c = p.contaPagarId ? contaDe.get(p.contaPagarId) : undefined;
    const cnpj = soDigitos(c?.fornecedorCnpj);
    if (!c || c.dataDelete || cnpj.length !== 14) continue;
    const ns = numerosDoTexto([c.descricao, c.observacao]);
    if (c.notaNumero != null) ns.add(c.notaNumero);
    if (!ns.size) continue;
    cnpjs.add(cnpj);
    ns.forEach((x) => nums.add(x));
  }
  const notas =
    cnpjs.size && nums.size
      ? await db
          .select({
            id: schema.notaCompra.id,
            filialId: schema.notaCompra.filialId,
            numero: schema.notaCompra.numero,
            emitCnpj: schema.notaCompra.emitCnpj,
            emitNome: schema.notaCompra.emitNome,
            destCnpj: schema.notaCompra.destCnpj,
          })
          .from(schema.notaCompra)
          .where(
            and(
              inArray(schema.notaCompra.filialId, casas),
              inArray(schema.notaCompra.emitCnpj, [...cnpjs]),
              inArray(schema.notaCompra.numero, [...nums].slice(0, 200)),
            ),
          )
      : [];
  const notaIds = notas.map((x) => x.id);
  const contasDasNotas = notaIds.length
    ? [
        ...(await db
          .select({ notaId: schema.contaPagar.notaCompraId, contaId: schema.contaPagar.id, filialId: schema.contaPagar.filialId })
          .from(schema.contaPagar)
          .where(and(inArray(schema.contaPagar.notaCompraId, notaIds), isNull(schema.contaPagar.dataDelete)))),
        ...(await db
          .select({
            notaId: schema.notaCompraDuplicata.notaCompraId,
            contaId: schema.contaPagar.id,
            filialId: schema.contaPagar.filialId,
          })
          .from(schema.notaCompraDuplicata)
          .innerJoin(schema.contaPagar, eq(schema.contaPagar.id, schema.notaCompraDuplicata.contaPagarId))
          .where(and(inArray(schema.notaCompraDuplicata.notaCompraId, notaIds), isNull(schema.contaPagar.dataDelete)))),
      ]
    : [];

  for (const p of focoP) {
    const l = lancs.find((x) => x.id === p.id)!;
    const c = p.contaPagarId ? contaDe.get(p.contaPagarId) : undefined;
    const pg = n(p.pagadora);
    const dv = n(p.devedora);

    if (p.contaPagarId && !c) {
      avisos.push({
        chave: `sem-conta|${p.id}`,
        gravidade: 'alta',
        texto: `${l.rotulo}: a conta da ${dv} ligada a esse boleto não existe mais — a ${dv} está devendo por uma conta que sumiu.`,
        links: [{ href: '/financeiro/boletos-inter', rotulo: 'Boletos pagos no Inter' }],
        ...envolvidos([l]),
      });
      continue;
    }
    if (c?.dataDelete) {
      avisos.push({
        chave: `conta-excluida|${p.id}`,
        gravidade: 'alta',
        texto: `${l.rotulo}: a conta da ${dv} (${c.descricao ?? c.fornecedorNome ?? ''} · ${brl(c.valor)}) foi excluída em ${ddmm(c.dataDelete.toISOString())}, mas o boleto continua no encontro — a ${dv} fica devendo por uma conta que não existe mais.`,
        links: [{ href: `/financeiro/conta/${c.id}`, rotulo: 'conta excluída' }],
        ...envolvidos([l]),
      });
    } else if (c && c.filialId !== p.devedora) {
      avisos.push({
        chave: `conta-outra-casa|${p.id}`,
        gravidade: 'alta',
        texto: `${l.rotulo}: o encontro cobra da ${dv}, mas a conta ligada está na ${n(c.filialId)}.`,
        links: [{ href: `/financeiro/conta/${c.id}`, rotulo: 'conta' }],
        ...envolvidos([l]),
      });
    }

    // o mesmo boleto já baixou uma conta da própria casa que pagou
    if (p.codigo) {
      const b = baixas.find((x) => x.filialId === p.pagadora && baixaCitaBoleto(x.observacao, p.codigo!));
      if (b) {
        avisos.push({
          chave: `baixou-pagadora|${p.id}`,
          gravidade: 'alta',
          texto: `${l.rotulo}: esse mesmo boleto já baixou a conta ${b.fornecedorNome ?? b.descricao ?? ''} (${brl(b.valor)}) da própria ${pg}. A conta é da ${pg} — no encontro a ${dv} paga de novo o que a ${pg} pagou pra ela mesma.`,
          links: [
            { href: `/financeiro/conta/${b.contaId}`, rotulo: `conta da ${pg} (baixada pelo boleto)` },
            ...(c ? [{ href: `/financeiro/conta/${c.id}`, rotulo: `conta da ${dv}` }] : []),
          ],
          ...envolvidos([l]),
        });
      }
    }

    // a nota da conta é da casa que pagou?
    if (c && !c.dataDelete) {
      if (c.notaDest && soDigitos(c.notaDest) === cnpjCasa.get(p.pagadora)) {
        avisos.push({
          chave: `nota-dest|${p.id}`,
          gravidade: 'alta',
          texto: `${l.rotulo}: a NF-e ${c.notaNumero ?? ''} da conta foi emitida pra ${pg} (destinatário), não pra ${dv} — a conta é da ${pg} e não entra no encontro.`,
          links: [{ href: `/financeiro/conta/${c.id}`, rotulo: `conta da ${dv}` }],
          ...envolvidos([l]),
        });
        continue;
      }
      const cnpj = soDigitos(c.fornecedorCnpj);
      const ns = numerosDoTexto([c.descricao, c.observacao]);
      if (c.notaNumero != null) ns.add(c.notaNumero);
      const mesmas = notas.filter((x) => x.emitCnpj === cnpj && x.numero != null && ns.has(x.numero));
      const daDevedora = mesmas.some(
        (x) => x.filialId === p.devedora || (x.destCnpj && soDigitos(x.destCnpj) === cnpjCasa.get(p.devedora)),
      );
      const naPagadora = mesmas.find((x) => x.filialId === p.pagadora);
      if (!daDevedora && naPagadora) {
        const contaPagadora = contasDasNotas.find((x) => x.notaId === naPagadora.id && x.filialId === p.pagadora);
        avisos.push({
          chave: `nota-pagadora|${p.id}`,
          gravidade: contaPagadora ? 'alta' : 'media',
          texto: contaPagadora
            ? `${l.rotulo}: a NF-e ${naPagadora.numero} da ${naPagadora.emitNome ?? 'fornecedora'} está na ${pg} e lá já tem conta — a conta da ${dv} é a mesma compra em dobro.`
            : `${l.rotulo}: a NF-e ${naPagadora.numero} da ${naPagadora.emitNome ?? 'fornecedora'} está lançada na ${pg}, não na ${dv} — conferir se a conta não é da ${pg}.`,
          links: [
            { href: `/financeiro/conta/${c.id}`, rotulo: `conta da ${dv}` },
            ...(contaPagadora ? [{ href: `/financeiro/conta/${contaPagadora.contaId}`, rotulo: `conta da ${pg}` }] : []),
          ],
          ...envolvidos([l]),
        });
      }
    }
  }

  // ---- 2) lançamentos que se repetem ou se anulam ----
  const vistos = new Set<string>();
  for (let i = 0; i < lancs.length; i++) {
    for (let j = i + 1; j < lancs.length; j++) {
      const x = lancs[i]!;
      const y = lancs[j]!;
      if (!x.noEncontro && !y.noEncontro) continue;
      const k = [x.id, y.id].sort().join('|');
      if (vistos.has(k)) continue;
      const mesmoSentido = x.devedora === y.devedora && x.credora === y.credora;
      const contrario = x.devedora === y.credora && x.credora === y.devedora;
      if (!mesmoSentido && !contrario) continue;
      const valor = cruza(x.valores, y.valores);
      const nota = cruza(x.notas, y.notas);
      const d = dias(x.data, y.data);
      const par = [x, y].sort((a, b) => a.data.localeCompare(b.data));
      const fechado = par.some((l) => l.status === 'COMPENSADA' || l.status === 'COMPENSADO')
        ? ' (um deles já foi compensado num encontro anterior)'
        : '';

      if (mesmoSentido && x.tipo === 'T' && y.tipo === 'T' && valor != null && d <= 31) {
        vistos.add(k);
        avisos.push({
          chave: `transf-repetida|${k}`,
          gravidade: nota != null ? 'alta' : 'media',
          texto: `${par[0]!.rotulo} e ${par[1]!.rotulo}: mesma origem, destino e valor${nota != null ? ` e mesma nota ${nota}` : ''}${fechado} — conferir se não é a mesma transferência lançada 2x.`,
          links: linksDe(par).slice(0, 1),
          ...envolvidos(par),
        });
      } else if (mesmoSentido && x.tipo === 'P' && y.tipo === 'P' && x.contaPagarId && x.contaPagarId === y.contaPagarId) {
        vistos.add(k);
        avisos.push({
          chave: `conta-2-boletos|${k}`,
          gravidade: 'alta',
          texto: `${par[0]!.rotulo} e ${par[1]!.rotulo}: os dois boletos estão ligados à MESMA conta da ${n(x.devedora)}${fechado} — ela entra 2x no encontro.`,
          links: linksDe(par).slice(0, 1),
          ...envolvidos(par),
        });
      } else if (mesmoSentido && x.tipo !== y.tipo && (nota != null || valor != null) && d <= 60) {
        vistos.add(k);
        const t = x.tipo === 'T' ? x : y;
        const p = x.tipo === 'P' ? x : y;
        avisos.push({
          chave: `transf-e-boleto|${k}`,
          gravidade: nota != null ? 'alta' : 'media',
          texto: `${t.rotulo} e ${p.rotulo}: os dois cobram da ${n(x.devedora)} ${nota != null ? `a mesma nota ${nota}` : 'o mesmo valor'}${fechado}. Se a mercadoria foi transferida, o boleto pago não entra no encontro (a compra é da ${n(x.credora)}); se a compra é da ${n(x.devedora)}, a transferência sobra.`,
          links: linksDe([t, p]),
          ...envolvidos([t, p]),
        });
      } else if (contrario && valor != null && d <= 31) {
        vistos.add(k);
        avisos.push({
          chave: `ida-e-volta|${k}`,
          gravidade: 'media',
          texto: `${par[0]!.rotulo} e ${par[1]!.rotulo}: mesmo valor em sentidos opostos${fechado} — um anula o outro. Se foi teste ou engano, cancelar os dois.`,
          links: linksDe(par).slice(0, 1),
          ...envolvidos(par),
        });
      }
    }
  }

  // ---- 3) competência já fechada pra esse par ----
  const feitos = await db
    .select({
      devedora: schema.encontroContas.filialDevedoraId,
      credora: schema.encontroContas.filialCredoraId,
      data: schema.encontroContas.data,
      liquido: schema.encontroContas.valorLiquido,
    })
    .from(schema.encontroContas)
    .where(eq(schema.encontroContas.competencia, competencia));
  for (const p of pares) {
    const f = feitos.find(
      (e) => (e.devedora === p.a && e.credora === p.b) || (e.devedora === p.b && e.credora === p.a),
    );
    if (!f) continue;
    avisos.push({
      chave: `ja-fechado|${p.a}|${p.b}`,
      gravidade: 'media',
      texto: `O encontro de ${competencia.split('-').reverse().join('/')} entre ${n(p.a)} e ${n(p.b)} já foi fechado em ${ddmm(f.data)} (${n(f.devedora)} pagou ${brl(f.liquido)}). O que está aqui entrou depois — fechar de novo gera mais uma conta de diferença. Conferir se não é coisa já acertada.`,
      links: [],
      pagamentos: [],
      transferencias: [],
    });
  }

  return avisos.sort((a, b) => (a.gravidade === b.gravidade ? 0 : a.gravidade === 'alta' ? -1 : 1));
}
