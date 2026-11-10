// Markdown mínimo do estudo de equipe (análise e escala sugerida da IA).

import type { ReactNode } from 'react';

function negrito(t: string): ReactNode[] {
  return t.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>,
  );
}

/** Markdown mínimo: ##/### títulos, listas "-"/"1.", **negrito**, tabelas |a|b|, parágrafos. */
export function Texto({ md }: { md: string }) {
  const out: ReactNode[] = [];
  let lista: string[] = [];
  let tabela: string[][] = [];
  const fecharTabela = () => {
    if (tabela.length) {
      const [cab, ...linhas] = tabela;
      out.push(
        <div key={`t${out.length}`} className="mb-3 overflow-x-auto">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr>
                {cab.map((c, i) => (
                  <th key={i} className="whitespace-nowrap border border-slate-200 bg-slate-50 px-2 py-1 text-left font-semibold text-slate-700">
                    {negrito(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, r) => (
                <tr key={r} className={/^\**vaga/i.test(l[0] ?? '') ? 'bg-amber-50' : undefined}>
                  {l.map((c, i) => (
                    <td
                      key={i}
                      className={`whitespace-nowrap border border-slate-200 px-2 py-1 ${/^\**folga\**$/i.test(c) ? 'text-slate-400' : ''}`}
                    >
                      {negrito(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    }
    tabela = [];
  };
  const fechar = () => {
    if (lista.length)
      out.push(
        <ul key={`l${out.length}`} className="mb-3 list-disc space-y-1 pl-5">
          {lista.map((x, i) => (
            <li key={i}>{negrito(x)}</li>
          ))}
        </ul>,
      );
    lista = [];
  };
  for (const linha of md.split('\n')) {
    const l = linha.trim();
    if (l.startsWith('|') && l.endsWith('|') && l.length > 1) {
      fechar();
      const cel = l.slice(1, -1).split('|').map((c) => c.trim());
      if (!cel.every((c) => /^:?-{2,}:?$/.test(c))) tabela.push(cel);
      continue;
    }
    fecharTabela();
    if (!l) {
      fechar();
      continue;
    }
    const h = /^#{1,4}\s+(.*)$/.exec(l);
    const li = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(l);
    if (h) {
      fechar();
      out.push(
        <h3 key={`h${out.length}`} className="mb-2 mt-4 text-sm font-semibold text-slate-800">
          {negrito(h[1])}
        </h3>,
      );
    } else if (li) lista.push(li[1]);
    else {
      fechar();
      out.push(
        <p key={`p${out.length}`} className="mb-2">
          {negrito(l)}
        </p>,
      );
    }
  }
  fechar();
  fecharTabela();
  return <div className="text-sm leading-relaxed text-slate-700">{out}</div>;
}
