// Moldura das páginas públicas de Termos de uso e Política de privacidade
// (/termos e /privacidade). O TikTok exige as duas URLs no cadastro do app.

export function PaginaLegal({
  titulo,
  atualizado,
  children,
}: {
  titulo: string;
  atualizado: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 text-slate-800">
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Prainha</p>
      <h1 className="mt-1 text-3xl font-bold">{titulo}</h1>
      <p className="mt-1 text-sm text-slate-500">Atualizado em {atualizado}</p>
      <div className="mt-8 space-y-6 leading-relaxed [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-slate-900 [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1">
        {children}
      </div>
      <footer className="mt-12 border-t pt-4 text-sm text-slate-500">
        Prainha Bar · Tabuará · Prainha Mar — Aracaju, Sergipe, Brasil ·{' '}
        <a className="underline" href="/termos">Termos de uso</a> ·{' '}
        <a className="underline" href="/privacidade">Política de privacidade</a>
      </footer>
    </main>
  );
}
