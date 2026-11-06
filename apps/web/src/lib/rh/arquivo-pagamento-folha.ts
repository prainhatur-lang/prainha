// Planilha de pagamento da folha pela NOSSA folha (dono 05/11/2026: "faz o
// arquivo" pra pagar a folha de uma vez). Uma linha por pessoa registrada na
// E.B. em cada casa (folhaEbDaCasa: sem diarista, sem quem saiu no mês, sem
// líquido zero), com o líquido e a conta do cadastro (fornecedor ligado ao
// funcionário).
//
// Regra do dono (05/11/2026): "só pode pagar as pessoas que têm o nome na
// conta". Conta com titular de outra pessoa (anotado no banco do cadastro,
// tipo "CAIXA( FULANO )" ou "titular: FULANO", ou favorecido do Pix com outro
// nome) vai pra aba "Não pagar", fora do total. Sem conta ou sem CPF também.
//
// Arquivo "Folha de pagamento" do Inter (linhasArquivoInter, abaixo): só
// credita conta do próprio Inter. A E.B. já paga assim desde maio/2026 (lote
// mensal no extrato): cada pessoa tem conta Inter no próprio CPF, guardada em
// conta_inter_folha. Quem não tem conta lá fica de fora do arquivo.

import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';
import { folhaEbDaCasa } from '@/lib/rh/folha-contador-pagamentos';

export interface LinhaPagamentoFolha {
  casaId: string;
  nome: string;
  cpf: string;
  bancoCadastro: string;
  banco: string;
  agencia: string;
  operacao: string;
  conta: string;
  tipo: string;
  valor: number;
  /** null = pode pagar; texto = motivo de não pagar. */
  bloqueio: string | null;
}

const semAcento = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Nome de outra pessoa anotado no campo do banco: "(titular: X)" ou "CAIXA( X )". */
export function titularAnotado(bancoNome: string | null | undefined): string | null {
  const t = bancoNome ?? '';
  const m = t.match(/titular\s*:?\s*([^)]+)/i) ?? t.match(/\(\s*([^)]*[A-Za-zÀ-ú]{2,}[^)]*)\)/);
  const nome = m?.[1]?.trim();
  return nome && nome.split(/\s+/).length >= 2 ? nome : null;
}

/** Mesmo titular? Compara primeiro e último nome, sem acento. */
function mesmaPessoa(a: string, b: string): boolean {
  const pa = semAcento(a).split(' ');
  const pb = semAcento(b).split(' ');
  return pa[0] === pb[0] && pa[pa.length - 1] === pb[pb.length - 1];
}

function tipoDaConta(bancoNome: string, operacao: string): string {
  if (['013', '1288', '3500', '1292'].includes(operacao)) return 'poupança';
  if (['001', '3701', '003'].includes(operacao)) return 'corrente';
  if (/C\s*\/\s*P|POUP/i.test(bancoNome)) return 'poupança';
  if (/C\s*\/\s*C|CORRENTE/i.test(bancoNome)) return 'corrente';
  return '';
}

export async function linhasPagamentoFolha(casaIds: string[], comp: string): Promise<LinhaPagamentoFolha[]> {
  const out: LinhaPagamentoFolha[] = [];
  for (const casaId of casaIds) {
    const gente = await folhaEbDaCasa(casaId, comp);
    const fids = gente.map((l) => l.fornecedorId).filter((x): x is string => !!x);
    const forn = fids.length ? await db.select().from(schema.fornecedor).where(inArray(schema.fornecedor.id, fids)) : [];
    const porId = new Map(forn.map((f) => [f.id, f]));
    for (const l of gente) {
      const f = l.fornecedorId ? porId.get(l.fornecedorId) : undefined;
      const bancoNome = (f?.bancoNome ?? '').trim();
      const agCru = (f?.bancoAgencia ?? '').trim();
      const contaCru = (f?.bancoConta ?? '').trim();
      const op = `${agCru} ${contaCru}`.match(/op\.?\s*(\d{3,4})/i)?.[1] ?? '';
      const agencia = agCru.replace(/op\.?\s*\d{3,4}/i, '').replace(/\D/g, '');
      const conta = contaCru.replace(/op\.?\s*\d{3,4}/i, '').trim();
      const ehCaixa = /CAIX|CAXA|\bCEF\b/i.test(bancoNome) || !!op;
      const cpf = (l.cpf ?? '').replace(/\D/g, '');

      let bloqueio: string | null = null;
      const outro = titularAnotado(bancoNome);
      if (outro && !mesmaPessoa(outro, l.nome)) bloqueio = `conta de outra pessoa (${outro})`;
      else if (f?.pixFavorecido && !mesmaPessoa(f.pixFavorecido, l.nome)) bloqueio = `conta de outra pessoa (${f.pixFavorecido})`;
      else if (!agencia || !conta) bloqueio = 'sem agência/conta no cadastro';
      else if (cpf.length !== 11) bloqueio = 'sem CPF';

      out.push({
        casaId,
        nome: l.nome,
        cpf,
        bancoCadastro: bancoNome,
        banco: ehCaixa ? '104 - Caixa Econômica' : bancoNome,
        agencia,
        operacao: op,
        conta,
        tipo: tipoDaConta(bancoNome, op),
        valor: Math.round(l.liquido * 100) / 100,
        bloqueio,
      });
    }
  }
  return out;
}

export interface LinhaArquivoInter {
  casaId: string;
  nome: string;
  cpf: string;
  /** Conta Inter do cadastro (conta_inter_folha); null = não tem. */
  conta: string | null;
  /** Nome como está no Inter. */
  nomeInter: string | null;
  valor: number;
}

/**
 * Quem entra no arquivo de folha do Inter: a mesma gente da planilha
 * (linhasPagamentoFolha), casada pelo CPF com a conta Inter da empresa.
 * A trava "conta de outra pessoa" da planilha não vale aqui: a conta Inter é
 * aberta no CPF da própria pessoa.
 */
export async function linhasArquivoInter(
  casaIds: string[],
  comp: string,
  empresa = 'EB',
): Promise<{ pagar: LinhaArquivoInter[]; semConta: LinhaArquivoInter[] }> {
  const base = await linhasPagamentoFolha(casaIds, comp);
  const cpfs = [...new Set(base.map((l) => l.cpf).filter((c) => c.length === 11))];
  const contas = cpfs.length
    ? await db
        .select()
        .from(schema.contaInterFolha)
        .where(and(eq(schema.contaInterFolha.empresa, empresa), inArray(schema.contaInterFolha.cpf, cpfs)))
    : [];
  const porCpf = new Map(contas.map((c) => [c.cpf, c]));
  const pagar: LinhaArquivoInter[] = [];
  const semConta: LinhaArquivoInter[] = [];
  for (const l of base) {
    if (l.valor <= 0) continue;
    const c = porCpf.get(l.cpf);
    const linha = { casaId: l.casaId, nome: l.nome, cpf: l.cpf, conta: c?.conta ?? null, nomeInter: c?.nome ?? null, valor: l.valor };
    (c ? pagar : semConta).push(linha);
  }
  return { pagar, semConta };
}
