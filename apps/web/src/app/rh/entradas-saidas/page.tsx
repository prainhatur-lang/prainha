// Pendências de entrada e saída (25/10/2026). Três listas por casa (lotação):
//  1. Saiu sem rescisão — desligado com carteira e faltando documento
//     obrigatório de saída (TRCT, exame demissional, comprovante).
//  2. Ativo registrado sem contrato — tem carteira e falta documento
//     obrigatório de entrada (contrato, exame admissional...).
//  3. Tem carteira mas sumiu do ponto — ativo, registrado, sem batida há
//     10 dias ou mais (em qualquer casa). Esses precisam de baixa formal.
// Só leitura: cada nome abre a ficha, onde se sobe o arquivo e se dá baixa.
// "Tem carteira" = lib/rh/documento-vinculo temCarteira.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { diasAtrasBr, hojeBr } from '@/lib/datas';
import { faltando, temCarteira, type TipoDoc } from '@/lib/rh/documento-vinculo';

export const dynamic = 'force-dynamic';

const DIAS_SUMIDO = 10;
const PERIODOS: Record<string, { rotulo: string; dias: number | null }> = {
  '90': { rotulo: '90 dias', dias: 90 },
  '180': { rotulo: '6 meses', dias: 180 },
  '365': { rotulo: '1 ano', dias: 365 },
  tudo: { rotulo: 'tudo', dias: null },
};

function fmtData(iso: string | null): string {
  if (!iso) return '—';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}
function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}

export default async function EntradasSaidasPage(props: { searchParams: Promise<{ filialId?: string; periodo?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'funcionario.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const sel = await escolherFilial(filiais, sp.filialId);
  if (!sel) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-3xl px-6 py-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
      </main>
    );
  }
  const filial = sel;
  const hoje = hojeBr();
  const periodo = sp.periodo && PERIODOS[sp.periodo] ? sp.periodo : '180';
  const diasPeriodo = PERIODOS[periodo].dias;
  const desdeSaida = diasPeriodo === null ? null : diasAtrasBr(diasPeriodo);
  const limiteSumido = diasAtrasBr(DIAS_SUMIDO);

  const F = schema.funcionario;
  const pessoas = await db
    .select({
      id: F.id,
      nome: F.nome,
      cargo: F.cargo,
      ativo: F.ativo,
      dataAdmissao: F.dataAdmissao,
      dataDesligamento: F.dataDesligamento,
      motivoDesligamento: F.motivoDesligamento,
      empresaRegistro: F.empresaRegistro,
      regimeSalarial: F.regimeSalarial,
    })
    .from(F)
    .where(eq(F.filialId, filial.id))
    .orderBy(F.nome);
  const comCarteira = pessoas.filter((p) => temCarteira(p));
  const ids = comCarteira.map((p) => p.id);

  const D = schema.funcionarioDocumento;
  const docs = ids.length
    ? await db
        .select({ funcionarioId: D.funcionarioId, momento: D.momento, tipo: D.tipo })
        .from(D)
        .where(and(inArray(D.funcionarioId, ids), isNull(D.canceladoEm)))
    : [];
  const tiposPor = new Map<string, { admissao: Set<string>; desligamento: Set<string> }>();
  for (const d of docs) {
    const t = tiposPor.get(d.funcionarioId) ?? { admissao: new Set<string>(), desligamento: new Set<string>() };
    (d.momento === 'desligamento' ? t.desligamento : t.admissao).add(d.tipo);
    tiposPor.set(d.funcionarioId, t);
  }
  const vazio = new Set<string>();

  // Última batida de cada pessoa, em qualquer casa.
  const B = schema.pontoBatida;
  const ultimas = ids.length
    ? await db
        .select({ funcionarioId: B.funcionarioId, ultima: sql<string>`max(${B.diaOperacional})::text` })
        .from(B)
        .where(and(inArray(B.funcionarioId, ids), isNull(B.excluidaEm)))
        .groupBy(B.funcionarioId)
    : [];
  const ultimaPor = new Map(ultimas.map((u) => [u.funcionarioId, u.ultima]));

  type Linha = (typeof pessoas)[number] & { faltam: TipoDoc[] };
  const saiuSemRescisao: Linha[] = [];
  const semContrato: Linha[] = [];
  const sumidos: Array<(typeof pessoas)[number] & { ultima: string | null }> = [];

  for (const p of comCarteira) {
    const t = tiposPor.get(p.id);
    if (!p.ativo) {
      if (desdeSaida && (!p.dataDesligamento || p.dataDesligamento < desdeSaida)) continue;
      const faltam = faltando('desligamento', true, t?.desligamento ?? vazio);
      if (faltam.length) saiuSemRescisao.push({ ...p, faltam });
      continue;
    }
    const faltamEntrada = faltando('admissao', true, t?.admissao ?? vazio);
    if (faltamEntrada.length) semContrato.push({ ...p, faltam: faltamEntrada });
    const ultima = ultimaPor.get(p.id) ?? null;
    const recemAdmitido = !!p.dataAdmissao && p.dataAdmissao > limiteSumido;
    if (!recemAdmitido && (!ultima || ultima < limiteSumido)) sumidos.push({ ...p, ultima });
  }
  sumidos.sort((a, b) => (a.ultima ?? '').localeCompare(b.ultima ?? ''));
  saiuSemRescisao.sort((a, b) => (b.dataDesligamento ?? '').localeCompare(a.dataDesligamento ?? ''));

  const ficha = (id: string) => `/rh/funcionarios/${id}`;
  const btn = 'rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50';
  const url = (q: { filialId?: string; periodo?: string }) =>
    `?filialId=${q.filialId ?? filial.id}&periodo=${q.periodo ?? periodo}`;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Entradas e saídas — pendências</h1>
            <p className="mt-1 text-sm text-slate-600">
              Quem tem carteira assinada e está com papel faltando ou sumiu do ponto. Clique no nome pra abrir a ficha,
              subir o documento ou dar baixa.
            </p>
          </div>
          <a href={`/rh/funcionarios?filialId=${filial.id}`} className={btn}>Funcionários</a>
        </div>

        {filiais.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {filiais.map((x) => (
              <a
                key={x.id}
                href={url({ filialId: x.id })}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  x.id === filial.id ? 'border-blue-500 bg-blue-50 font-medium text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {x.nome}
              </a>
            ))}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <Contador n={sumidos.length} rotulo={`sumiram do ponto (${DIAS_SUMIDO}+ dias)`} cor="red" href="#sumidos" />
          <Contador n={saiuSemRescisao.length} rotulo="saíram sem rescisão completa" cor="amber" href="#saidas" />
          <Contador n={semContrato.length} rotulo="ativos sem contrato completo" cor="amber" href="#entradas" />
        </div>

        <Secao
          id="sumidos"
          titulo="Tem carteira mas sumiu do ponto"
          sub={`Ativo e registrado, sem bater ponto em nenhuma casa desde ${fmtData(limiteSumido)}. Se saiu, dê baixa com a data do último dia; se está de férias ou afastado, ignore.`}
          vazio="Ninguém registrado sumido do ponto."
        >
          {sumidos.map((p) => (
            <Linha key={p.id} href={ficha(p.id)} nome={p.nome} cargo={p.cargo}>
              {p.ultima ? (
                <>
                  último ponto <b>{fmtData(p.ultima)}</b> · há {diasEntre(p.ultima, hoje)} dias
                </>
              ) : (
                <>nunca bateu ponto no sistema</>
              )}
              {p.empresaRegistro && <span className="text-slate-400"> · {p.empresaRegistro}</span>}
            </Linha>
          ))}
        </Secao>

        <Secao
          id="saidas"
          titulo="Saiu sem rescisão completa"
          sub={
            <span className="flex flex-wrap items-center gap-1">
              Desligados com carteira e documento de saída faltando. Saídas de:
              {Object.entries(PERIODOS).map(([k, v]) => (
                <a
                  key={k}
                  href={`${url({ periodo: k })}#saidas`}
                  className={`rounded px-1.5 py-0.5 ${k === periodo ? 'bg-blue-50 font-medium text-blue-700' : 'text-blue-700 hover:underline'}`}
                >
                  {v.rotulo}
                </a>
              ))}
            </span>
          }
          vazio="Nenhum desligado com documento faltando nesse período."
        >
          {saiuSemRescisao.map((p) => (
            <Linha key={p.id} href={ficha(p.id)} nome={p.nome} cargo={p.cargo}>
              saiu em <b>{fmtData(p.dataDesligamento)}</b>
              {p.motivoDesligamento && <span className="text-slate-400"> · {p.motivoDesligamento}</span>}
              <Faltam tipos={p.faltam} />
            </Linha>
          ))}
        </Secao>

        <Secao
          id="entradas"
          titulo="Ativo registrado sem contrato completo"
          sub="Tem carteira assinada e falta documento obrigatório de entrada."
          vazio="Todos os registrados ativos estão com os documentos de entrada."
        >
          {semContrato.map((p) => (
            <Linha key={p.id} href={ficha(p.id)} nome={p.nome} cargo={p.cargo}>
              admitido em {fmtData(p.dataAdmissao)}
              <Faltam tipos={p.faltam} />
            </Linha>
          ))}
        </Secao>
      </section>
    </main>
  );
}

function Contador({ n, rotulo, cor, href }: { n: number; rotulo: string; cor: 'red' | 'amber'; href: string }) {
  const classe =
    n === 0
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : cor === 'red'
        ? 'border-red-200 bg-red-50 text-red-800'
        : 'border-amber-200 bg-amber-50 text-amber-900';
  return (
    <a href={href} className={`rounded-xl border px-4 py-3 ${classe}`}>
      <p className="text-2xl font-bold">{n}</p>
      <p className="text-xs">{rotulo}</p>
    </a>
  );
}

function Secao(props: { id: string; titulo: string; sub: React.ReactNode; vazio: string; children: React.ReactNode[] }) {
  return (
    <section id={props.id} className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-900">
          {props.titulo} <span className="font-normal text-slate-500">({props.children.length})</span>
        </h2>
        <div className="mt-0.5 text-xs text-slate-500">{props.sub}</div>
      </div>
      {props.children.length === 0 ? (
        <p className="px-5 py-4 text-sm text-emerald-700">✓ {props.vazio}</p>
      ) : (
        <ul className="divide-y divide-slate-100">{props.children}</ul>
      )}
    </section>
  );
}

function Linha(props: { href: string; nome: string; cargo: string | null; children: React.ReactNode }) {
  return (
    <li className="px-5 py-2.5">
      <a href={props.href} className="text-sm font-medium text-blue-700 hover:underline">
        {props.nome}
      </a>
      {props.cargo && <span className="ml-1 text-xs text-slate-400">{props.cargo}</span>}
      <p className="text-xs text-slate-600">{props.children}</p>
    </li>
  );
}

function Faltam({ tipos }: { tipos: TipoDoc[] }) {
  return (
    <span className="mt-0.5 block text-amber-700">
      falta: {tipos.map((t) => t.rotulo).join(' · ')}
    </span>
  );
}
