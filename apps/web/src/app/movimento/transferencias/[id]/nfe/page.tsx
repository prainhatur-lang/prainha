// DANFE (A4) da NF-e de transferência entre casas — página imprimível.
// Mostra a nota de PRODUÇÃO autorizada; sem ela, a mais recente (homologação,
// rejeitada, cancelada) com o estado bem claro. ?nfeId=… abre uma específica.

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { db, schema } from '@concilia/db';
import type { FiscalConfig } from '@concilia/db/schema';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { brl } from '@/lib/format';
import { nfesDasTransferencias } from '@/lib/nfe/emitir';
import { code128C } from '@/lib/nfe/barras';
import { AcoesNfe, EmitirNfeButton } from '../../nfe-btn';

export const dynamic = 'force-dynamic';

const cnpjFmt = (c: string) => c.replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const cepFmt = (c?: string) => (c ?? '').replace(/^(\d{5})(\d{3})$/, '$1-$2');
const chaveFmt = (c: string) => c.replace(/(\d{4})(?=\d)/g, '$1 ');
const num = (n: number, casas = 2) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const dataHora = (d: Date | null) =>
  d ? d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '—';

function enderecoLinhas(cfg: FiscalConfig | null) {
  const e = cfg?.endereco;
  if (!e) return ['—'];
  return [
    `${e.logradouro}, ${e.numero}${e.complemento ? ` — ${e.complemento}` : ''}`,
    `${e.bairro} · ${e.municipio}/${e.uf} · CEP ${cepFmt(e.cep)}`,
  ];
}

function Campo({ rotulo, children, className = '' }: { rotulo: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`border border-black px-1.5 py-0.5 ${className}`}>
      <div className="text-[7px] uppercase leading-tight text-slate-700">{rotulo}</div>
      <div className="text-[11px] font-medium leading-tight">{children}</div>
    </div>
  );
}

export default async function DanfeNfePage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ nfeId?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'nota_compra.read');
  const { id } = await props.params;
  const sp = await props.searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [t] = await db.select().from(schema.transferenciaFilial).where(eq(schema.transferenciaFilial.id, id)).limit(1);
  if (!t) notFound();
  const acessos = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        inArray(schema.usuarioFilial.filialId, [t.filialOrigemId, t.filialDestinoId]),
      ),
    );
  if (!acessos.length) notFound();
  const enviou = acessos.some((a) => a.filialId === t.filialOrigemId);

  let nota = (await nfesDasTransferencias([id])).get(id) ?? null;
  if (sp.nfeId && /^[0-9a-f-]{36}$/i.test(sp.nfeId)) {
    const [n] = await db
      .select()
      .from(schema.nfeEmitida)
      .where(and(eq(schema.nfeEmitida.id, sp.nfeId), eq(schema.nfeEmitida.transferenciaId, id)))
      .limit(1);
    if (n) nota = n;
  }
  const todas = await db
    .select({
      id: schema.nfeEmitida.id,
      numero: schema.nfeEmitida.numero,
      ambiente: schema.nfeEmitida.ambiente,
      status: schema.nfeEmitida.status,
    })
    .from(schema.nfeEmitida)
    .where(eq(schema.nfeEmitida.transferenciaId, id))
    .orderBy(desc(schema.nfeEmitida.criadoEm));

  const voltar = `/movimento/transferencias?filialId=${enviou ? t.filialOrigemId : t.filialDestinoId}&comp=${t.competencia}`;

  if (!nota) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-lg font-semibold text-slate-900">Transferência #{t.numero} sem nota fiscal</p>
          <p className="mt-2 max-w-sm text-sm text-slate-600">
            Ela vale sozinha (só financeiro). A NF-e de transferência é opcional e quem emite é a casa que enviou.
          </p>
          <div className="mt-4 flex items-center justify-center gap-3">
            {enviou && t.status !== 'CANCELADA' && <EmitirNfeButton id={t.id} numero={t.numero} />}
            <Link href={voltar} className="text-sm text-slate-700 underline">◂ voltar</Link>
          </div>
        </div>
      </main>
    );
  }

  const filiais = await db
    .select({ id: schema.filial.id, nome: schema.filial.nome, cnpj: schema.filial.cnpj, cfg: schema.filial.fiscalConfig })
    .from(schema.filial)
    .where(inArray(schema.filial.id, [t.filialOrigemId, t.filialDestinoId]));
  const emit = filiais.find((f) => f.id === t.filialOrigemId);
  const dest = filiais.find((f) => f.id === t.filialDestinoId);
  if (!emit || !dest) notFound();

  const autorizada = nota.status === 'AUTORIZADA';
  const homolog = nota.ambiente !== 1;
  const itens = nota.itens ?? [];
  const bc = code128C(nota.chave);
  const faixa = !autorizada
    ? nota.status === 'CANCELADA'
      ? 'NOTA CANCELADA — sem valor fiscal'
      : nota.status === 'REJEITADA'
        ? `NOTA REJEITADA PELA SEFAZ (${nota.cstat ?? ''}) — ${nota.xmotivo ?? ''}`
        : 'NOTA AINDA NÃO AUTORIZADA — não use pra circular mercadoria'
    : homolog
      ? 'EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO — SEM VALOR FISCAL'
      : null;

  return (
    <main className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto w-fit">
        <div className="no-print mb-4 flex flex-wrap items-center gap-3">
          <AcoesNfe transferenciaId={t.id} nfeId={nota.id} podeCancelar={enviou && autorizada} />
          {enviou && t.status !== 'CANCELADA' && !(autorizada && !homolog) && (
            <EmitirNfeButton
              id={t.id}
              numero={t.numero}
              rotulo={nota.status === 'REJEITADA' || nota.status === 'ERRO' ? '🧾 Tentar emitir de novo' : '🧾 Emitir NF-e (produção)'}
            />
          )}
          <Link href={voltar} className="text-sm text-slate-600 underline">◂ transferências</Link>
        </div>
        {todas.length > 1 && (
          <p className="no-print mb-3 text-xs text-slate-500">
            Notas dessa transferência:{' '}
            {todas.map((n, i) => (
              <span key={n.id}>
                {i > 0 && ' · '}
                <Link
                  href={`/movimento/transferencias/${t.id}/nfe?nfeId=${n.id}`}
                  className={n.id === nota.id ? 'font-semibold text-slate-800' : 'underline'}
                >
                  nº {n.numero} {n.ambiente === 1 ? '' : '(teste) '}— {n.status.toLowerCase()}
                </Link>
              </span>
            ))}
          </p>
        )}

        <div className="danfe bg-white p-4 text-black shadow print:p-0 print:shadow-none">
          {faixa && (
            <div className="mb-2 border-2 border-black px-2 py-1 text-center text-sm font-bold uppercase">{faixa}</div>
          )}

          <div className="grid grid-cols-[1fr_120px_1.1fr]">
            <div className="border border-black p-2">
              <div className="text-[7px] uppercase text-slate-700">Identificação do emitente</div>
              <div className="text-sm font-bold leading-tight">{emit.cfg?.razaoSocial ?? emit.nome}</div>
              {emit.cfg?.nomeFantasia && <div className="text-[11px]">{emit.cfg.nomeFantasia}</div>}
              {enderecoLinhas(emit.cfg).map((l) => (
                <div key={l} className="text-[10px] leading-tight">{l}</div>
              ))}
            </div>
            <div className="border border-black p-1 text-center">
              <div className="text-base font-bold leading-none">DANFE</div>
              <div className="text-[7px] leading-tight">Documento Auxiliar da Nota Fiscal Eletrônica</div>
              <div className="mt-1 text-[9px] leading-tight">0 - Entrada<br />1 - Saída</div>
              <div className="mx-auto mt-0.5 w-6 border border-black text-sm font-bold">1</div>
              <div className="mt-1 text-[11px] font-bold leading-tight">
                Nº {String(nota.numero).padStart(9, '0').replace(/(\d{3})(\d{3})(\d{3})/, '$1.$2.$3')}
                <br />
                Série {String(nota.serie).padStart(3, '0')}
              </div>
            </div>
            <div className="border border-black p-1.5">
              {bc.largura > 0 && (
                <svg viewBox={`0 0 ${bc.largura} 40`} preserveAspectRatio="none" className="h-11 w-full">
                  {bc.barras.map((b, i) => (
                    <rect key={i} x={b.x} y={0} width={b.w} height={40} fill="#000" />
                  ))}
                </svg>
              )}
              <div className="mt-1 text-[7px] uppercase text-slate-700">Chave de acesso</div>
              <div className="font-mono text-[10px] font-semibold">{chaveFmt(nota.chave)}</div>
              <div className="mt-1 text-[8px] leading-tight">
                Consulta de autenticidade no portal nacional da NF-e (www.nfe.fazenda.gov.br/portal) ou no site da
                SEFAZ autorizadora.
              </div>
            </div>
          </div>

          <div className="grid grid-cols-[1.2fr_1fr]">
            <Campo rotulo="Natureza da operação">{nota.naturezaOperacao}</Campo>
            <Campo rotulo="Protocolo de autorização de uso">
              {nota.protocolo ? `${nota.protocolo} — ${dataHora(nota.autorizadaEm)}` : '—'}
            </Campo>
          </div>
          <div className="grid grid-cols-3">
            <Campo rotulo="Inscrição estadual">{emit.cfg?.ie ?? '—'}</Campo>
            <Campo rotulo="CNPJ">{cnpjFmt(emit.cnpj)}</Campo>
            <Campo rotulo="Data da emissão">{dataHora(nota.criadoEm)}</Campo>
          </div>

          <div className="mt-1.5 text-[8px] font-bold uppercase">Destinatário / remetente</div>
          <div className="grid grid-cols-[1.6fr_1fr_0.8fr]">
            <Campo rotulo="Nome / razão social">
              {homolog ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL' : (dest.cfg?.razaoSocial ?? dest.nome)}
            </Campo>
            <Campo rotulo="CNPJ">{cnpjFmt(nota.destCnpj ?? dest.cnpj)}</Campo>
            <Campo rotulo="Inscrição estadual">{dest.cfg?.ie ?? '—'}</Campo>
          </div>
          <div className="grid grid-cols-[1.6fr_1fr_0.8fr]">
            <Campo rotulo="Endereço">{enderecoLinhas(dest.cfg)[0]}</Campo>
            <Campo rotulo="Bairro / município / UF">
              {dest.cfg?.endereco ? `${dest.cfg.endereco.bairro} · ${dest.cfg.endereco.municipio}/${dest.cfg.endereco.uf}` : '—'}
            </Campo>
            <Campo rotulo="CEP">{cepFmt(dest.cfg?.endereco?.cep) || '—'}</Campo>
          </div>

          <div className="mt-1.5 text-[8px] font-bold uppercase">Cálculo do imposto</div>
          <div className="grid grid-cols-5">
            <Campo rotulo="Base de cálc. do ICMS">0,00</Campo>
            <Campo rotulo="Valor do ICMS">0,00</Campo>
            <Campo rotulo="Valor do frete">0,00</Campo>
            <Campo rotulo="Valor total dos produtos">{num(Number(nota.valorTotal))}</Campo>
            <Campo rotulo="Valor total da nota" className="font-bold">{num(Number(nota.valorTotal))}</Campo>
          </div>

          <div className="mt-1.5 text-[8px] font-bold uppercase">Transportador / volumes</div>
          <div className="grid grid-cols-1">
            <Campo rotulo="Frete por conta">3 - Transporte próprio por conta do remetente</Campo>
          </div>

          <div className="mt-1.5 text-[8px] font-bold uppercase">Dados dos produtos</div>
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="text-[7px] uppercase">
                {['Cód.', 'Descrição', 'NCM', 'CSOSN', 'CFOP', 'Un.', 'Qtd.', 'V. unit.', 'V. total'].map((h, i) => (
                  <th key={h} className={`border border-black px-1 py-0.5 font-normal ${i >= 6 ? 'text-right' : 'text-left'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {itens.map((i, k) => (
                <tr key={k}>
                  <td className="border border-black px-1">{i.codigo}</td>
                  <td className="border border-black px-1">{i.descricao}</td>
                  <td className="border border-black px-1">{i.ncm}</td>
                  <td className="border border-black px-1">{i.csosn}</td>
                  <td className="border border-black px-1">{i.cfop}</td>
                  <td className="border border-black px-1">{i.unidade}</td>
                  <td className="border border-black px-1 text-right">{num(i.quantidade, 3)}</td>
                  <td className="border border-black px-1 text-right">{num(i.valorUnitario, 4)}</td>
                  <td className="border border-black px-1 text-right">{num(i.valorTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-1.5 text-[8px] font-bold uppercase">Dados adicionais</div>
          <div className="min-h-[60px] border border-black px-1.5 py-1 text-[10px] leading-snug">
            <div className="text-[7px] uppercase text-slate-700">Informações complementares</div>
            {nota.infoExtra}
            <div className="mt-1 text-slate-700">
              Transferência #{t.numero} · {emit.nome} → {dest.nome} · total {brl(nota.valorTotal)}
            </div>
          </div>
        </div>
      </div>
      <style>{`
        .danfe { width: 200mm; }
        @media print {
          .no-print { display: none !important; }
          header, nav { display: none !important; }
          @page { size: A4; margin: 6mm; }
          body { background: #fff; }
          .danfe { width: 100%; }
        }
      `}</style>
    </main>
  );
}
