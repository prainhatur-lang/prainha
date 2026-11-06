// /cardapio/vinhos — carta de vinhos pra imprimir (dono 06/11/2026: "onde está
// o cardápio pra imprimir?"). Mesmos vinhos do QR da mesa: etiqueta "Vinho" da
// casa, cardapio_digital ligado, sem pausa, com preço. Agrupa pelo país que vem
// no fim do nome ("... PT", "... ARG"). Só leitura.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { hojeBr } from '@/lib/datas';
import { BotaoImprimirCarta } from './imprimir';

export const dynamic = 'force-dynamic';

const PAISES: Record<string, string> = {
  PT: 'Portugal',
  ARG: 'Argentina',
  CHI: 'Chile',
  ITA: 'Itália',
  ESP: 'Espanha',
  FRA: 'França',
  BR: 'Brasil',
  URU: 'Uruguai',
  AFS: 'África do Sul',
  EUA: 'Estados Unidos',
  NZ: 'Nova Zelândia',
  AUS: 'Austrália',
};
const ORDEM = ['Portugal', 'Espanha', 'França', 'Itália', 'Argentina', 'Chile', 'Brasil', 'Uruguai'];
const PORTO = 'Vinho do Porto';
const TACA = 'Em taça';
const OUTROS = 'Outros';

/** Separa o país do nome: "Esporao Reserva PT" → Portugal / "Esporao Reserva". */
function classificar(nomeBruto: string): { grupo: string; nome: string } {
  let nome = nomeBruto.replace(/\s+/g, ' ').trim();
  const baixo = nome.toLowerCase();
  if (/\btaça\b|\btaca\b/.test(baixo)) return { grupo: TACA, nome: limpar(nome.replace(/^taça\s+/i, '')) };
  if (/\bporto\b|oporto/.test(baixo)) return { grupo: PORTO, nome: limpar(nome.replace(/^vinho\s+/i, '')) };
  const m = nome.match(/\s+([A-Z]{2,3})$/);
  if (m && PAISES[m[1]!]) return { grupo: PAISES[m[1]!]!, nome: limpar(nome.slice(0, m.index)) };
  const porPalavra: [RegExp, string][] = [
    [/\s+portugu[eê]s\b/i, 'Portugal'],
    [/\s+espanhol\b/i, 'Espanha'],
    [/\s+franc[eê]s\b/i, 'França'],
    [/\s+italiano\b/i, 'Itália'],
  ];
  for (const [re, pais] of porPalavra) {
    if (re.test(nome)) {
      nome = nome.replace(re, ' ');
      return { grupo: pais, nome: limpar(nome) };
    }
  }
  if (/^ch[aâ]teau\b/i.test(nome)) return { grupo: 'França', nome: limpar(nome) };
  return { grupo: OUTROS, nome: limpar(nome) };
}

function limpar(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const brl = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

export default async function CartaVinhosPage(props: {
  searchParams: Promise<{ filialId?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const sp = await props.searchParams;
  const filiais = await filiaisDoUsuario(user.id);
  const escolhida = await escolherFilial(filiais, sp.filialId);
  if (!escolhida) redirect('/inicio');
  const filial = escolhida;

  const linhas = (await db.execute(sql`
    SELECT p.nome, v.preco_venda::float AS preco
      FROM produto p
      JOIN produto_variante v ON v.produto_id = p.id AND v.data_delete IS NULL
     WHERE p.filial_id = ${filial.id}
       AND COALESCE(p.descontinuado, false) = false
       AND v.cardapio_digital = true
       AND v.data_pausado IS NULL
       AND v.preco_venda > 0
       AND p.codigo_etiqueta IN (
         SELECT e.codigo_externo::text FROM produto_etiqueta e
          WHERE e.filial_id = ${filial.id} AND e.nome ILIKE '%vinho%'
       )
  `)) as unknown as { nome: string; preco: number }[];

  const grupos = new Map<string, { nome: string; preco: number }[]>();
  for (const l of linhas) {
    const { grupo, nome } = classificar(l.nome);
    const lista = grupos.get(grupo) ?? [];
    lista.push({ nome, preco: Number(l.preco) });
    grupos.set(grupo, lista);
  }
  const peso = (g: string) => {
    const i = ORDEM.indexOf(g);
    if (i >= 0) return i;
    if (g === PORTO) return 90;
    if (g === TACA) return 91;
    if (g === OUTROS) return 92;
    return 50;
  };
  const ordenados = [...grupos.entries()]
    .sort((a, b) => peso(a[0]) - peso(b[0]) || a[0].localeCompare(b[0]))
    .map(([g, itens]) => [g, itens.sort((a, b) => a.preco - b.preco || a.nome.localeCompare(b.nome))] as const);

  const [ano, mes, dia] = hojeBr().split('-');

  return (
    <main className="min-h-screen bg-slate-50 print:bg-white">
      <div className="print:hidden">
        <AppHeader userEmail={user.email} />
      </div>
      <section className="mx-auto max-w-4xl px-4 py-6 print:max-w-none print:px-0 print:py-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Carta de vinhos — {filial.nome}</h1>
            <p className="mt-1 text-xs text-slate-500">
              Os mesmos vinhos que aparecem no QR da mesa ({linhas.length}). Pra tirar ou pôr um vinho,
              liga/desliga o cardápio digital no cadastro do produto e a carta acompanha.
            </p>
            {filiais.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-2 text-sm">
                {filiais.map((f) => (
                  <a
                    key={f.id}
                    href={`/cardapio/vinhos?filialId=${f.id}`}
                    className={`rounded-md border px-2 py-1 ${f.id === filial.id ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
                  >
                    {f.nome}
                  </a>
                ))}
              </div>
            )}
          </div>
          <BotaoImprimirCarta />
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-8 print:rounded-none print:border-0 print:p-0">
          <header className="mb-6 text-center">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">{filial.nome}</p>
            <h2 className="mt-1 font-serif text-3xl text-slate-900">Carta de Vinhos</h2>
          </header>
          {ordenados.length === 0 ? (
            <p className="text-center text-sm text-slate-500">Nenhum vinho no cardápio desta casa.</p>
          ) : (
            <div className="columns-1 gap-10 sm:columns-2 print:columns-2">
              {ordenados.map(([grupo, itens]) => (
                <div key={grupo} className="mb-6 break-inside-avoid">
                  <h3 className="mb-2 border-b border-slate-300 pb-1 font-serif text-lg text-slate-900">{grupo}</h3>
                  <ul className="space-y-1">
                    {itens.map((it, i) => (
                      <li key={i} className="flex items-baseline gap-2 text-sm text-slate-800">
                        <span>{it.nome}</span>
                        <span className="flex-1 border-b border-dotted border-slate-300" />
                        <span className="whitespace-nowrap tabular-nums">R$ {brl(it.preco)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <p className="mt-6 text-center text-[10px] text-slate-400">
            Atualizada em {dia}/{mes}/{ano}
          </p>
        </div>
      </section>
    </main>
  );
}
