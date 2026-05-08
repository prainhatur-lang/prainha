'use client';

import Link from 'next/link';

interface Linha {
  fornecedorId: string;
  nome: string;
  cpf: string | null;
  bancoNome: string | null;
  bancoAgencia: string | null;
  bancoConta: string | null;
  chavePix: string | null;
  bruto: number;
  acrescimos: number;
  descontos: number;
  liquido: number;
}

interface Props {
  folhaId: string;
  filialNome: string;
  labelSemana: string;
  linhas: Linha[];
}

export function ExportarClient({ folhaId, filialNome, labelSemana, linhas }: Props) {
  const totalLiquido = linhas.reduce((s, l) => s + l.liquido, 0);

  function baixarCsv() {
    const header = [
      'Nome',
      'CPF',
      'Banco',
      'Agência',
      'Conta',
      'Chave PIX',
      'Bruto',
      'Acréscimos',
      'Descontos',
      'Líquido',
    ];
    const rows = linhas.map((l) => [
      l.nome,
      l.cpf ?? '',
      l.bancoNome ?? '',
      l.bancoAgencia ?? '',
      l.bancoConta ?? '',
      l.chavePix ?? '',
      l.bruto.toFixed(2).replace('.', ','),
      l.acrescimos.toFixed(2).replace('.', ','),
      l.descontos.toFixed(2).replace('.', ','),
      l.liquido.toFixed(2).replace('.', ','),
    ]);
    const csv = [header, ...rows]
      .map((r) =>
        r
          .map((c) => {
            const s = String(c);
            return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(';'),
      )
      .join('\n');
    // BOM pra Excel reconhecer UTF-8
    const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pagamento-folha-${labelSemana.replace(/\s+/g, '-')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-white">
      {/* Barra de acoes — escondida na impressao */}
      <header className="border-b border-slate-200 bg-slate-50 px-6 py-3 print:hidden">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link
            href={`/folha-equipe/folhas/${folhaId}`}
            className="text-sm text-blue-600 hover:underline"
          >
            ← Voltar à folha
          </Link>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={baixarCsv}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              📄 Baixar CSV
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
            >
              🖨 Imprimir / Salvar PDF
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-8 print:px-0 print:py-2">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-slate-900">Pagamento da folha</h1>
          <p className="text-sm text-slate-600">
            {filialNome} · {labelSemana}
          </p>
        </div>

        {linhas.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            Nenhum líquido a pagar nessa folha.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b-2 border-slate-300 text-xs uppercase text-slate-600">
              <tr>
                <th className="px-2 py-2 text-left font-medium">Pessoa</th>
                <th className="px-2 py-2 text-left font-medium">CPF</th>
                <th className="px-2 py-2 text-left font-medium">Banco / Ag / Conta</th>
                <th className="px-2 py-2 text-left font-medium">Chave PIX</th>
                <th className="px-2 py-2 text-right font-medium">Líquido</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.fornecedorId} className="border-b border-slate-100">
                  <td className="px-2 py-2 font-medium text-slate-900">{l.nome}</td>
                  <td className="px-2 py-2 font-mono text-xs text-slate-600">
                    {fmtCpf(l.cpf)}
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-700">
                    {l.bancoNome || l.bancoAgencia || l.bancoConta ? (
                      <>
                        {l.bancoNome ?? '—'} · ag {l.bancoAgencia ?? '—'} · cc{' '}
                        {l.bancoConta ?? '—'}
                      </>
                    ) : (
                      <span className="text-rose-600">⚠ sem conta cadastrada</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-700">
                    {l.chavePix ?? <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-2 py-2 text-right font-mono font-bold">
                    {brl(l.liquido)}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-400 bg-slate-50 font-bold">
                <td className="px-2 py-3" colSpan={4}>
                  TOTAL ({linhas.length} pessoa{linhas.length !== 1 && 's'})
                </td>
                <td className="px-2 py-3 text-right font-mono">{brl(totalLiquido)}</td>
              </tr>
            </tbody>
          </table>
        )}

        {/* Avisos de cadastro incompleto — escondidos na impressao */}
        {linhas.some((l) => !l.bancoConta && !l.chavePix) && (
          <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 print:hidden">
            ⚠ {linhas.filter((l) => !l.bancoConta && !l.chavePix).length} pessoa(s)
            sem dados bancários cadastrados — completa em{' '}
            <Link
              href="/folha-equipe/pessoas"
              className="underline hover:no-underline"
            >
              Pessoas da folha
            </Link>{' '}
            antes de mandar pro pagador.
          </div>
        )}

        <p className="mt-8 text-[10px] text-slate-400 print:mt-12">
          Gerado automaticamente em {new Date().toLocaleString('pt-BR')}.
        </p>
      </section>
    </main>
  );
}

function brl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtCpf(cpf: string | null | undefined): string {
  if (!cpf) return '—';
  const c = cpf.replace(/\D/g, '');
  if (c.length !== 11) return cpf;
  return `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
}
