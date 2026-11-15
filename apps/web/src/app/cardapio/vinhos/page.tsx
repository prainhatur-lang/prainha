// /cardapio/vinhos — carta de vinhos pra imprimir (dono 06/11/2026: "onde está
// o cardápio pra imprimir?"). Mesmos vinhos do QR da mesa: etiqueta "Vinho" da
// casa, cardapio_digital ligado, sem pausa, com preço. Só leitura.
// Ordem (dono 15/11/2026: "tinto e depois por nacionalidade"): primeiro o TIPO
// (Tinto, Branco, Rosé...), dentro dele o PAÍS. O país vem do campo
// Nacionalidade do cadastro; sem ele, do fim do nome ("... PT", "... ARG").

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

// ---- Tipo do vinho (lido do nome — o cadastro não tem campo de tipo) ----
const TINTO = 'Tinto';
const BRANCO = 'Branco';
const ROSE = 'Rosé';
const VERDE = 'Vinho Verde';
const ESPUMANTE = 'Espumante';
const SEM_TIPO = 'Outros vinhos';
const ORDEM_TIPO = [TINTO, BRANCO, ROSE, VERDE, ESPUMANTE, PORTO, TACA, SEM_TIPO];

/** "Português" (como se digita no cadastro) → "Portugal" (título da carta). */
const PAIS_DA_NACIONALIDADE: Record<string, string> = {
  brasileiro: 'Brasil', argentino: 'Argentina', chileno: 'Chile', uruguaio: 'Uruguai',
  portugues: 'Portugal', italiano: 'Itália', frances: 'França', espanhol: 'Espanha',
  alemao: 'Alemanha', 'sul-africano': 'África do Sul', australiano: 'Austrália',
  neozelandes: 'Nova Zelândia', americano: 'Estados Unidos',
};
const semAcento = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

function paisDoCadastro(nac: string | null): string | null {
  const t = (nac ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const chave = semAcento(t);
  // aceita o feminino também: "italiana", "chilena", "portuguesa", "francesa"
  return (
    PAIS_DA_NACIONALIDADE[chave] ??
    PAIS_DA_NACIONALIDADE[chave.replace(/a$/, 'o')] ??
    PAIS_DA_NACIONALIDADE[chave.replace(/a$/, '')] ??
    limpar(t)
  );
}

/** Tipo pelo nome: a palavra explícita ganha; sem ela, a uva. Null = não dá pra saber. */
function tipoDoVinho(nome: string): string | null {
  const n = semAcento(nome);
  if (/\b(espumante|prosecco|champagne|brut|cava)\b/.test(n)) return ESPUMANTE;
  if (/\brose\b/.test(n)) return ROSE;
  if (/\bvinho verde\b/.test(n)) return VERDE;
  if (/\b(branco|bianco|blanc|br)\b/.test(n)) return BRANCO;
  if (/\b(tinto|rosso|tto)\b/.test(n)) return TINTO;
  if (/\b(chardonnay|viura|alvarinho|riesling|pinot grigio|moscato|torrontes)\b/.test(n)) return BRANCO;
  if (/\b(malbec|cabernet|merlot|carmenere|syrah|shiraz|pinot noir|primitivo|barbera|barolo|chianti|tempranillo|crianza|tannat|sangiovese)\b/.test(n)) return TINTO;
  return null;
}

/** Tira o que o título do grupo já diz: "Vinho Tinto Esporao" → "Esporao". */
function semPrefixo(nome: string): string {
  return limpar(nome.replace(/^vinho\s+(?:(?:tinto|branco|ros[eé])\s+)?/i, '')) || nome;
}

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
    SELECT p.nome, p.nacionalidade, v.preco_venda::float AS preco
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
  `)) as unknown as { nome: string; nacionalidade: string | null; preco: number }[];

  // tipo → país → vinhos
  const tipos = new Map<string, Map<string, { nome: string; preco: number }[]>>();
  let semNacionalidade = 0;
  let semTipo = 0;
  for (const l of linhas) {
    const { grupo, nome } = classificar(l.nome);
    let tipo: string;
    let pais: string;
    if (grupo === TACA || grupo === PORTO) {
      // Taça e Porto continuam à parte, como sempre foram.
      tipo = grupo;
      pais = '';
    } else {
      const t = tipoDoVinho(nome);
      if (!t) semTipo++;
      // Sem tinto/branco/rosé no nome nem uva conhecida: entra como Tinto (é a
      // convenção da Tabuará — o branco vem marcado "Br"). A tela avisa quantos são.
      tipo = t ?? TINTO;
      pais = paisDoCadastro(l.nacionalidade) ?? grupo;
      if (pais === OUTROS) semNacionalidade++;
    }
    const porPais = tipos.get(tipo) ?? new Map<string, { nome: string; preco: number }[]>();
    const lista = porPais.get(pais) ?? [];
    lista.push({ nome: tipo === TACA || tipo === PORTO ? nome : semPrefixo(nome), preco: Number(l.preco) });
    porPais.set(pais, lista);
    tipos.set(tipo, porPais);
  }
  const peso = (g: string) => {
    const i = ORDEM.indexOf(g);
    if (i >= 0) return i;
    if (g === PORTO) return 90;
    if (g === TACA) return 91;
    if (g === OUTROS) return 92;
    return 50;
  };
  const ordenados = [...tipos.entries()]
    .sort((a, b) => ORDEM_TIPO.indexOf(a[0]) - ORDEM_TIPO.indexOf(b[0]))
    .map(
      ([tipo, porPais]) =>
        [
          tipo,
          [...porPais.entries()]
            .sort((a, b) => peso(a[0]) - peso(b[0]) || a[0].localeCompare(b[0]))
            .map(([g, itens]) => [g, itens.sort((a, b) => a.preco - b.preco || a.nome.localeCompare(b.nome))] as const),
        ] as const,
    );

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
            <p className="mt-1 text-xs text-slate-500">
              Ordem: primeiro o tipo (Tinto, Branco, Rosé…), depois o país. O país vem do campo
              Nacionalidade do cadastro do produto; sem ele, do fim do nome (PT, ARG, FRA…).
            </p>
            {(semNacionalidade > 0 || semTipo > 0) && (
              <p className="mt-1 text-xs text-amber-700">
                {semNacionalidade > 0 && (
                  <>
                    {semNacionalidade} sem nacionalidade (ficam em “{OUTROS}”) — preencha a
                    Nacionalidade no cadastro do produto.{' '}
                  </>
                )}
                {semTipo > 0 && (
                  <>
                    {semTipo} sem tinto/branco/rosé no nome entraram como Tinto — se algum for
                    branco ou rosé, ponha a palavra no nome do produto.
                  </>
                )}
              </p>
            )}
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
            <div className="space-y-8">
              {ordenados.map(([tipo, paises]) => (
                <section key={tipo}>
                  <h3 className="mb-3 break-after-avoid border-b-2 border-slate-800 pb-1 text-center font-serif text-2xl text-slate-900">
                    {tipo}
                  </h3>
                  <div className="columns-1 gap-10 sm:columns-2 print:columns-2">
                    {paises.map(([pais, itens]) => (
                      <div key={pais} className="mb-5 break-inside-avoid">
                        {pais && !(pais === OUTROS && paises.length === 1) && (
                          <h4 className="mb-2 border-b border-slate-300 pb-1 font-serif text-base text-slate-900">{pais}</h4>
                        )}
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
                </section>
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
