import type { Metadata } from 'next';

// Página pública (sem login) com as marcas das 3 casas pra baixar.
// Fora do Google (noindex): só quem recebe o link chega aqui.
// Arquivos ficam em public/marcas/<NN-casa>/ + um .zip por casa.

export const metadata: Metadata = {
  title: 'Marcas — Prainha',
  description: 'Logos do Prainha Bar, Tabuará e Prainha Mar & Grill para download.',
  robots: { index: false, follow: false },
};

type Formato = 'PDF' | 'PNG' | 'SVG';

type Peca = {
  nome: string;
  arquivo: string; // sem extensão
  formatos: Formato[];
  fundo: string; // cor do fundo da prévia (pra marca clara aparecer)
  dica?: string;
};

type Casa = {
  numero: string;
  nome: string;
  pasta: string;
  pecas: Peca[];
};

const CLARO = '#f4f4f5';
const ESCURO = '#27272a';

const CASAS: Casa[] = [
  {
    numero: '01',
    nome: 'Prainha Bar',
    pasta: '01-prainha-bar',
    pecas: [
      { nome: 'Selo positivo', arquivo: 'prainha-selo-positivo', formatos: ['PDF', 'PNG'], fundo: CLARO },
      {
        nome: 'Selo negativo',
        arquivo: 'prainha-selo-negativo',
        formatos: ['PDF', 'PNG'],
        fundo: '#b91c1c',
        dica: 'PDF com fundo vermelho; PNG branco com fundo transparente',
      },
    ],
  },
  {
    numero: '02',
    nome: 'Tabuará',
    pasta: '02-tabuara',
    pecas: [
      { nome: 'Vertical 01', arquivo: 'tabuara-vertical-01', formatos: ['PDF', 'PNG'], fundo: CLARO },
      { nome: 'Vertical 02', arquivo: 'tabuara-vertical-02', formatos: ['PDF', 'PNG'], fundo: CLARO },
      { nome: 'Vertical negativo', arquivo: 'tabuara-vertical-negativo', formatos: ['PDF', 'PNG'], fundo: CLARO },
      { nome: 'Horizontal positivo', arquivo: 'tabuara-horizontal-positivo', formatos: ['PDF', 'PNG'], fundo: CLARO },
      { nome: 'Horizontal negativo', arquivo: 'tabuara-horizontal-negativo', formatos: ['PDF', 'PNG'], fundo: CLARO },
      { nome: 'Redonda', arquivo: 'tabuara-circulo', formatos: ['PNG'], fundo: CLARO },
    ],
  },
  {
    numero: '03',
    nome: 'Prainha Mar & Grill',
    pasta: '03-prainha-mar',
    pecas: [
      { nome: 'Selo laranja', arquivo: 'prainha-mar-selo-laranja', formatos: ['PDF', 'PNG', 'SVG'], fundo: CLARO },
      { nome: 'Selo laranja com fundo', arquivo: 'prainha-mar-selo-laranja-fundo', formatos: ['PDF', 'PNG', 'SVG'], fundo: CLARO },
      { nome: 'Selo azul', arquivo: 'prainha-mar-selo-azul', formatos: ['PDF', 'PNG', 'SVG'], fundo: CLARO },
      { nome: 'Selo preto', arquivo: 'prainha-mar-selo-preto', formatos: ['PDF', 'PNG', 'SVG'], fundo: CLARO },
      { nome: 'Selo creme', arquivo: 'prainha-mar-selo-creme', formatos: ['PDF', 'PNG', 'SVG'], fundo: ESCURO },
      { nome: 'Selo branco', arquivo: 'prainha-mar-selo-branco', formatos: ['PDF', 'PNG', 'SVG'], fundo: ESCURO },
    ],
  },
];

export default function MarcasPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">Marcas do Prainha</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Logos oficiais das casas para download. PDF e SVG são vetor (qualquer tamanho, ideal pra gráfica);
          PNG tem fundo transparente e alta resolução.
        </p>
      </header>

      <div className="space-y-12">
        {CASAS.map((casa) => (
          <section key={casa.pasta} id={casa.pasta}>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-zinc-200 pb-3">
              <h2 className="text-xl font-semibold text-zinc-900">
                <span className="mr-2 text-zinc-400">{casa.numero}</span>
                {casa.nome}
              </h2>
              <a
                href={`/marcas/${casa.pasta}.zip`}
                download
                className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700"
              >
                Baixar tudo (.zip)
              </a>
            </div>

            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {casa.pecas.map((p) => (
                <li key={p.arquivo} className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
                  <div className="flex h-48 items-center justify-center p-6" style={{ background: p.fundo }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/marcas/${casa.pasta}/${p.arquivo}.png`}
                      alt={`${casa.nome} — ${p.nome}`}
                      className="max-h-full max-w-full object-contain"
                      loading="lazy"
                    />
                  </div>
                  <div className="p-3">
                    <p className="text-sm font-medium text-zinc-900">{p.nome}</p>
                    {p.dica && <p className="mt-0.5 text-xs text-zinc-500">{p.dica}</p>}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {p.formatos.map((f) => (
                        <a
                          key={f}
                          href={`/marcas/${casa.pasta}/${p.arquivo}.${f.toLowerCase()}`}
                          download
                          className="rounded border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                        >
                          {f}
                        </a>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
