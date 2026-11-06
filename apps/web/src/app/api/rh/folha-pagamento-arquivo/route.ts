// GET /api/rh/folha-pagamento-arquivo?comp=AAAA-MM[&casa=<filialId>]
// Planilha (.xlsx) pra pagar a folha da E.B. pela NOSSA folha: uma aba por
// casa com nome, CPF, banco, agência, operação, conta e líquido; aba "Não pagar"
// com quem tem conta em nome de outra pessoa (regra do dono 05/11/2026) ou
// cadastro incompleto. Só leitura: não lança, não dá baixa.

import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { linhasPagamentoFolha } from '@/lib/rh/arquivo-pagamento-folha';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const auth = await exigirPermApi('folha_equipe.read');
  if (auth.error) return auth.error;
  const sp = new URL(req.url).searchParams;
  const comp = sp.get('comp') ?? '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(comp)) return NextResponse.json({ error: 'comp inválido (AAAA-MM)' }, { status: 400 });

  const filiais = await filiaisDoUsuario(auth.user.id);
  const casa = sp.get('casa');
  const casas = casa ? filiais.filter((f) => f.id === casa) : filiais;
  if (casas.length === 0) return NextResponse.json({ error: 'casa não encontrada' }, { status: 404 });
  const nomeCasa = new Map(casas.map((f) => [f.id, f.nome]));

  const linhas = await linhasPagamentoFolha(
    casas.map((c) => c.id),
    comp,
  );
  const [ano, mes] = comp.split('-');
  const wb = XLSX.utils.book_new();
  const cab = ['Nome', 'CPF', 'Banco', 'Agência', 'Operação', 'Conta', 'Tipo', 'Valor', 'Banco no cadastro'];

  for (const c of casas) {
    const doc = linhas.filter((l) => l.casaId === c.id && !l.bloqueio);
    if (doc.length === 0) continue;
    const total = Math.round(doc.reduce((t, l) => t + l.valor, 0) * 100) / 100;
    const rows: (string | number)[][] = [
      cab,
      ...doc.map((l) => [l.nome, l.cpf, l.banco, l.agencia, l.operacao, l.conta, l.tipo, l.valor, l.bancoCadastro]),
      [],
      ['TOTAL', `${doc.length} pessoas`, '', '', '', '', '', total],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 40 }, { wch: 13 }, { wch: 22 }, { wch: 8 }, { wch: 9 }, { wch: 16 }, { wch: 10 }, { wch: 11 }, { wch: 30 }];
    for (let r = 1; r < rows.length; r++) {
      const cel = ws[XLSX.utils.encode_cell({ r, c: 7 })];
      if (cel && typeof cel.v === 'number') cel.z = '#,##0.00';
    }
    XLSX.utils.book_append_sheet(wb, ws, (nomeCasa.get(c.id) ?? 'Casa').replace(/[\\/?*[\]:]/g, '').slice(0, 31));
  }

  const fora = linhas.filter((l) => l.bloqueio);
  if (fora.length > 0) {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Casa', 'Nome', 'Valor', 'Por que não pagar', 'Banco no cadastro'],
      ...fora.map((l) => [nomeCasa.get(l.casaId) ?? '', l.nome, l.valor, l.bloqueio ?? '', l.bancoCadastro]),
    ]);
    ws['!cols'] = [{ wch: 18 }, { wch: 40 }, { wch: 11 }, { wch: 50 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Não pagar');
  }
  if (wb.SheetNames.length === 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Ninguém a pagar nesse mês pela nossa folha.']]), 'Vazio');
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const sufixo = casa && casas[0] ? `-${casas[0].nome.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-')}` : '';
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="pagamento-folha-${mes}-${ano}${sufixo}.xlsx"`,
      'cache-control': 'no-store',
    },
  });
}
