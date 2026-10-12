// Extrato do Inter no Fechamento do mês, sem ninguém enviar: busca o mês
// inteiro na API do banco, monta uma planilha (XLSX) e guarda como arquivo da
// conta "Inter" de cada casa/empresa em /relatorios/fechamento — é o que o
// contador baixa.
//
// Vale pra conta da lista (`extrato_conta`) cujo banco é "Inter" e que tem
// integração cadastrada:
//   - conta de casa → a credencial de extrato da casa (lib/inter);
//   - conta de empresa → `INTER_<SIGLA>_*` (E.B. Serviços = EB; as demais, a
//     primeira palavra do nome, ex.: Leles → INTER_LELES_*).
// Conta com "detalhe" (apelido) fica de fora: é uma segunda conta do mesmo
// banco e a integração é de uma conta só.
//
// Só leitura no banco. Aqui nada é conciliado nem lançado: a planilha é
// documento, igual ao arquivo enviado na mão. Rodar de novo não duplica — o
// caminho do arquivo leva o resumo do conteúdo; se o conteúdo mudou (lançamento
// que o banco postou depois), entra a planilha nova e a automática anterior sai
// da lista (continua no bucket).

import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import { db, schema } from '@concilia/db';
import { and, asc, eq, inArray, isNull, like } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';
import {
  buscarExtratoInter,
  buscarSaldoInter,
  credenciaisInterEmpresa,
  resolverCredenciaisInter,
  type InterCredenciais,
  type InterTransacao,
} from '@/lib/inter';
import { BUCKET_EXTRATOS, pastaExtrato } from '@/lib/extratos-fechamento';

/** Prefixo do arquivo automático dentro da pasta da conta no mês. */
const PREFIXO_AUTO = 'inter-api-';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface ResultadoContaInter {
  contaId: string;
  titular: string;
  /** novo = planilha guardada · igual = já estava · sem_integracao · erro */
  situacao: 'novo' | 'igual' | 'sem_integracao' | 'erro';
  lancamentos?: number;
  detalhe?: string;
}

export function ehContaInter(banco: string): boolean {
  return /^(banco\s+)?inter\b/i.test(banco.trim());
}

function semAcento(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function credencialDaConta(c: { filialId: string | null; empresa: string | null }): InterCredenciais | null {
  if (c.filialId) return resolverCredenciaisInter(c.filialId);
  const nome = semAcento(c.empresa ?? '').toUpperCase();
  if (/^E\.?\s?B\b/.test(nome)) return credenciaisInterEmpresa('EB');
  const sigla = nome.replace(/[^A-Z0-9 ]/g, '').trim().split(/\s+/)[0];
  return sigla ? credenciaisInterEmpresa(sigla) : null;
}

function ultimoDia(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

function ymd(ano: number, mes: number, dia: number): string {
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** O mês inteiro, em duas consultas (1–15 e 16–fim) — o Inter limita o período por chamada. */
async function transacoesDoMes(cred: InterCredenciais, ano: number, mes: number): Promise<InterTransacao[]> {
  const fim = ultimoDia(ano, mes);
  const a = await buscarExtratoInter(cred, ymd(ano, mes, 1), ymd(ano, mes, 15));
  const b = await buscarExtratoInter(cred, ymd(ano, mes, 16), ymd(ano, mes, fim));
  return [...a, ...b].sort((x, y) => x.dataEntrada.localeCompare(y.dataEntrada));
}

function brData(ymdStr: string): string {
  return `${ymdStr.slice(8, 10)}/${ymdStr.slice(5, 7)}/${ymdStr.slice(0, 4)}`;
}

interface Planilha {
  buffer: Buffer;
  resumo: string;
  lancamentos: number;
}

export function montarPlanilha(opts: {
  titular: string;
  ano: number;
  mes: number;
  transacoes: InterTransacao[];
  saldoInicial: number | null;
  saldoFinal: number | null;
}): Planilha {
  const { titular, ano, mes, transacoes, saldoInicial, saldoFinal } = opts;
  const centavos = (v: string) => Math.round(Number(v) * 100);
  let entradas = 0;
  let saidas = 0;
  for (const t of transacoes) {
    if (t.tipoOperacao === 'C') entradas += centavos(t.valor);
    else saidas += centavos(t.valor);
  }

  const linhas: Array<Array<string | number | null>> = [
    ['Extrato Banco Inter — gerado automaticamente pela API do banco'],
    ['Titular', titular],
    ['Período', `${brData(ymd(ano, mes, 1))} a ${brData(ymd(ano, mes, ultimoDia(ano, mes)))}`],
    ['Saldo inicial', saldoInicial],
    ['Total de entradas', entradas / 100],
    ['Total de saídas', saidas / 100],
    ['Saldo final', saldoFinal],
    ['Lançamentos', transacoes.length],
    [],
    ['Data', 'Tipo', 'Entrada/Saída', 'Título', 'Descrição', 'Entrada', 'Saída', 'Valor'],
  ];
  for (const t of transacoes) {
    const v = centavos(t.valor) / 100;
    const credito = t.tipoOperacao === 'C';
    linhas.push([
      brData(t.dataEntrada),
      t.tipoTransacao || '',
      credito ? 'Entrada' : 'Saída',
      t.titulo || '',
      t.descricao || '',
      credito ? v : null,
      credito ? null : v,
      credito ? v : -v,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(linhas);
  ws['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 13 }, { wch: 34 }, { wch: 60 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  for (const end of Object.keys(ws)) {
    const cel = ws[end] as XLSX.CellObject;
    if (end[0] !== '!' && cel.t === 'n' && end !== 'B8') cel.z = '#,##0.00';
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Extrato');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  // Resumo do CONTEÚDO (não do arquivo): mesma lista de lançamentos e saldos = mesmo caminho.
  const resumo = createHash('sha1')
    .update(JSON.stringify([saldoInicial, saldoFinal, transacoes.map((t) => [t.dataEntrada, t.tipoOperacao, t.valor, t.titulo, t.descricao])]))
    .digest('hex')
    .slice(0, 12);
  return { buffer, resumo, lancamentos: transacoes.length };
}

/**
 * Busca e guarda o extrato do Inter de `mes`/`ano` das contas pedidas.
 * `contaIds` limita às contas dadas (a tela manda só as que o usuário enxerga);
 * sem ele, vale pra todas (cron). `enviadoPor` = quem clicou; nulo no cron.
 */
export async function guardarExtratosInterDoMes(opts: {
  ano: number;
  mes: number;
  contaIds?: string[];
  enviadoPor?: string | null;
}): Promise<ResultadoContaInter[]> {
  const { ano, mes } = opts;
  if (opts.contaIds && opts.contaIds.length === 0) return [];

  const contas = await db
    .select({
      id: schema.extratoConta.id,
      filialId: schema.extratoConta.filialId,
      empresa: schema.extratoConta.empresa,
      filialNome: schema.filial.nome,
      banco: schema.extratoConta.banco,
      apelido: schema.extratoConta.apelido,
    })
    .from(schema.extratoConta)
    .leftJoin(schema.filial, eq(schema.filial.id, schema.extratoConta.filialId))
    .where(
      // Pedido na mão (contaIds) vale também pra conta em "não pedir mais"; o cron só busca as pedidas.
      opts.contaIds ? inArray(schema.extratoConta.id, opts.contaIds) : eq(schema.extratoConta.ativo, true),
    )
    .orderBy(asc(schema.extratoConta.ordem));

  const admin = await createAdminClient();
  const resultados: ResultadoContaInter[] = [];

  for (const c of contas) {
    if (!ehContaInter(c.banco) || c.apelido) continue;
    const titular = c.filialId ? (c.filialNome ?? 'Casa') : (c.empresa ?? 'Outra empresa');
    const cred = credencialDaConta(c);
    if (!cred) {
      resultados.push({ contaId: c.id, titular, situacao: 'sem_integracao', detalhe: 'sem integração com o Inter cadastrada' });
      continue;
    }
    try {
      const transacoes = await transacoesDoMes(cred, ano, mes);
      // Saldo é complemento: se o banco não devolver, a planilha sai sem ele.
      const anterior = new Date(Date.UTC(ano, mes - 1, 0)).toISOString().slice(0, 10);
      const saldoInicial = await buscarSaldoInter(cred, anterior).catch(() => null);
      const saldoFinal = await buscarSaldoInter(cred, ymd(ano, mes, ultimoDia(ano, mes))).catch(() => null);

      const planilha = montarPlanilha({ titular, ano, mes, transacoes, saldoInicial, saldoFinal });
      const pasta = pastaExtrato(c.id, ano, mes);
      const path = `${pasta}/${PREFIXO_AUTO}${planilha.resumo}.xlsx`;

      const [jaTem] = await db
        .select({ id: schema.extratoArquivo.id, excluidoEm: schema.extratoArquivo.excluidoEm })
        .from(schema.extratoArquivo)
        .where(eq(schema.extratoArquivo.storagePath, path))
        .limit(1);
      if (jaTem) {
        // Mesmo conteúdo. Se alguém tirou da lista e agora pediu na mão, volta; o cron respeita a retirada.
        if (jaTem.excluidoEm && opts.enviadoPor) {
          await db
            .update(schema.extratoArquivo)
            .set({ excluidoEm: null, excluidoPor: null })
            .where(eq(schema.extratoArquivo.id, jaTem.id));
          resultados.push({ contaId: c.id, titular, situacao: 'novo', lancamentos: planilha.lancamentos });
        } else {
          resultados.push({ contaId: c.id, titular, situacao: 'igual', lancamentos: planilha.lancamentos });
        }
        continue;
      }

      const up = await admin.storage
        .from(BUCKET_EXTRATOS)
        .upload(path, planilha.buffer, { contentType: XLSX_MIME, upsert: true });
      if (up.error) throw new Error(`storage: ${up.error.message}`);

      // A automática anterior do mesmo mês (conteúdo antigo) sai da lista.
      await db
        .update(schema.extratoArquivo)
        .set({ excluidoEm: new Date() })
        .where(
          and(
            eq(schema.extratoArquivo.contaId, c.id),
            eq(schema.extratoArquivo.ano, ano),
            eq(schema.extratoArquivo.mes, mes),
            isNull(schema.extratoArquivo.excluidoEm),
            like(schema.extratoArquivo.storagePath, `${pasta}/${PREFIXO_AUTO}%`),
          ),
        );
      await db
        .insert(schema.extratoArquivo)
        .values({
          contaId: c.id,
          ano,
          mes,
          nomeOriginal: `extrato-inter-${ano}-${String(mes).padStart(2, '0')}-automatico.xlsx`,
          storagePath: path,
          contentType: XLSX_MIME,
          tamanhoBytes: planilha.buffer.length,
          enviadoPor: opts.enviadoPor ?? null,
        })
        .onConflictDoNothing({ target: schema.extratoArquivo.storagePath });
      resultados.push({ contaId: c.id, titular, situacao: 'novo', lancamentos: planilha.lancamentos });
    } catch (e) {
      resultados.push({ contaId: c.id, titular, situacao: 'erro', detalhe: (e as Error).message.slice(0, 300) });
    }
  }
  return resultados;
}

/** Mês (ano, mes) anterior ao dia `hoje` (YYYY-MM-DD em BRT). */
export function mesAnterior(hoje: string): { ano: number; mes: number } {
  const ano = Number(hoje.slice(0, 4));
  const mes = Number(hoje.slice(5, 7));
  return mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
}

/** O mês já acabou (em BRT)? Extrato de mês em andamento não é guardado. */
export function mesJaEncerrou(ano: number, mes: number, hoje: string): boolean {
  return `${ano}-${String(mes).padStart(2, '0')}` < hoje.slice(0, 7);
}
