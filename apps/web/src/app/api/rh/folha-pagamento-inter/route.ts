// GET /api/rh/folha-pagamento-inter?comp=AAAA-MM&data=AAAA-MM-DD[&conta=<conta E.B.>][&casa=<filialId>][&empresa=EB|PRAINHA]
// empresa=PRAINHA (06/11/2026): mesmo arquivo pra quem é registrado na Prainha
// Turismo, pago pelo Inter da Prainha. Sem empresa = E.B., como antes.
// Arquivo no modelo "Folha de pagamento" do Inter (abas Pagador e
// Beneficiarios), pra subir no Inter da E.B. e pagar todo mundo num lote só —
// do mesmo jeito que a E.B. já paga desde maio/2026. Pela NOSSA folha, todas as
// casas juntas. Só entra quem tem conta Inter no próprio CPF
// (conta_inter_folha); quem não tem aparece na tela de pagamentos pra pagar à
// parte. Só leitura: não lança, não dá baixa.

import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { linhasArquivoInter, PAGADOR_FOLHA } from '@/lib/rh/arquivo-pagamento-folha';
import { hojeBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** AAAA-MM-DD → número de série do Excel (célula de data de verdade). */
function serialExcel(ymd: string): number {
  const [a, m, d] = ymd.split('-').map(Number);
  return Date.UTC(a, m - 1, d) / 86400000 + 25569;
}

export async function GET(req: Request) {
  const auth = await exigirPermApi('folha_equipe.read');
  if (auth.error) return auth.error;
  const sp = new URL(req.url).searchParams;
  const comp = sp.get('comp') ?? '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(comp)) return NextResponse.json({ error: 'comp inválido (AAAA-MM)' }, { status: 400 });
  const hoje = hojeBr();
  const data = sp.get('data') || hoje;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return NextResponse.json({ error: 'data inválida (AAAA-MM-DD)' }, { status: 400 });
  if (data < hoje) return NextResponse.json({ error: 'O Inter não aceita data de débito antes de hoje.' }, { status: 400 });
  const contaPagador = (sp.get('conta') ?? '').trim();
  const empresa = sp.get('empresa') === 'PRAINHA' ? 'PRAINHA' : 'EB';
  const pagador = PAGADOR_FOLHA[empresa];

  const filiais = await filiaisDoUsuario(auth.user.id);
  const casa = sp.get('casa');
  const casas = casa ? filiais.filter((f) => f.id === casa) : filiais;
  if (casas.length === 0) return NextResponse.json({ error: 'casa não encontrada' }, { status: 404 });
  const { pagar } = await linhasArquivoInter(
    casas.map((f) => f.id),
    comp,
    empresa,
  );

  // Mesma pessoa em duas casas = uma linha só no lote.
  const porCpf = new Map<string, { nome: string; cpf: string; conta: string; valor: number }>();
  for (const l of pagar) {
    const a = porCpf.get(l.cpf);
    if (a) a.valor = Math.round((a.valor + l.valor) * 100) / 100;
    else porCpf.set(l.cpf, { nome: (l.nomeInter ?? l.nome).toUpperCase(), cpf: l.cpf, conta: l.conta!, valor: l.valor });
  }
  const linhas = [...porCpf.values()].sort((a, b) => a.nome.localeCompare(b.nome));
  const total = Math.round(linhas.reduce((t, l) => t + l.valor, 0) * 100) / 100;

  const wb = XLSX.utils.book_new();
  const pag = XLSX.utils.aoa_to_sheet([
    ['Empresa', 'CNPJ', 'Conta Corrente', 'Valor Total da Folha de Pagamento'],
    [pagador.nome, pagador.cnpj, contaPagador, total],
  ]);
  pag['!cols'] = [{ wch: 36 }, { wch: 40 }, { wch: 20 }, { wch: 34 }];
  for (const c of ['A2', 'B2', 'C2']) if (pag[c]) pag[c].t = 's';
  if (pag.D2) pag.D2.z = '"R$"\\ #,##0.00';
  XLSX.utils.book_append_sheet(wb, pag, 'Pagador');

  const serial = serialExcel(data);
  const ben = XLSX.utils.aoa_to_sheet([
    ['Nome', 'CPF', 'Conta Corrente - Receb', 'Valor', 'Data do Débito', 'Data do Pagamento'],
    ...linhas.map((l) => [l.nome, l.cpf, l.conta, l.valor, serial, serial]),
  ]);
  ben['!cols'] = [{ wch: 40 }, { wch: 14 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
  for (let r = 1; r <= linhas.length; r++) {
    for (const c of [0, 1, 2]) {
      const cel = ben[XLSX.utils.encode_cell({ r, c })];
      if (cel) cel.t = 's';
    }
    const v = ben[XLSX.utils.encode_cell({ r, c: 3 })];
    if (v) v.z = '"R$"\\ #,##0.00';
    for (const c of [4, 5]) {
      const cel = ben[XLSX.utils.encode_cell({ r, c })];
      if (cel) cel.z = 'dd/mm/yyyy';
    }
  }
  XLSX.utils.book_append_sheet(wb, ben, 'Beneficiarios');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const [ano, mes] = comp.split('-');
  const sufixo = casa && casas[0] ? `-${casas[0].nome.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-')}` : '';
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="folha-inter${empresa === 'PRAINHA' ? '-prainha' : ''}-${mes}-${ano}${sufixo}.xlsx"`,
      'cache-control': 'no-store',
    },
  });
}
