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
import { gerarArquivoFolhaInter } from '@/lib/rh/arquivo-folha-inter-xlsx';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { linhasArquivoInter, PAGADOR_FOLHA } from '@/lib/rh/arquivo-pagamento-folha';
import { hojeBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
  // Regra 4 do modelo do Inter: nenhuma célula em branco.
  if (!contaPagador) {
    return NextResponse.json(
      { error: 'Preencha a conta corrente do Inter da empresa que paga (campo "Conta"). Sem ela o Inter recusa o arquivo.' },
      { status: 400 },
    );
  }
  const empresa = sp.get('empresa') === 'PRAINHA' ? 'PRAINHA' : 'EB';
  const pagador = PAGADOR_FOLHA[empresa];

  const filiais = await filiaisDoUsuario(auth.user.id);
  const casa = sp.get('casa');
  // casa=<id> = uma casa; casa=<id>,<id> = só essas (dono 06/11/2026: "enviar
  // só Prainha Bar e Prainha Mar, da Tabuará não posso mandar agora").
  const casaIds = (casa ?? '').split(',').filter(Boolean);
  const casas = casaIds.length ? filiais.filter((f) => casaIds.includes(f.id)) : filiais;
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

  // 06/11/2026: o Inter recusou ("Houve um erro por aqui") o arquivo montado do
  // zero — faltava a aba Instruções e a conta do pagador veio vazia. Agora
  // preenche o modelo oficial do Inter, com as 3 abas e as tabelas dele.
  const buf = gerarArquivoFolhaInter(
    { nome: pagador.nome, cnpj: pagador.cnpj, conta: contaPagador, total },
    linhas,
    data,
  );
  const [ano, mes] = comp.split('-');
  const sufixo = casa && casas.length > 0 ? `-${casas.map((c) => c.nome).join('-').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-')}` : '';
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="folha-inter${empresa === 'PRAINHA' ? '-prainha' : ''}-${mes}-${ano}${sufixo}.xlsx"`,
      'cache-control': 'no-store',
    },
  });
}
