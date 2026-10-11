// NF-e avulsa: nota (modelo 55) de venda de um BEM DA EMPRESA — o carro, um
// equipamento — pro comprador. Não vem de cupom nem de transferência: os dados
// são digitados aqui. ?nfeId=… abre uma nota já pedida (teste, rejeitada,
// autorizada) com o DANFE A4 pra imprimir.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { db, schema } from '@concilia/db';
import type { FiscalConfig } from '@concilia/db/schema';
import { eq } from 'drizzle-orm';
import { exigirPermPage } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { logoDaFilial } from '@/lib/logo-filial';
import { formatarDocumento } from '@/lib/nfce/documento';
import { code128C } from '@/lib/nfe/barras';
import { pendenciasNfe, regimeNfe } from '@/lib/nfe/xml';
import { FORMAS_PAGAMENTO_AVULSA, infoPadraoAtivo } from '@/lib/nfe/xml-avulsa';
import { nfesAvulsas } from '@/lib/nfe/emitir-avulsa';
import { AcoesNfeAvulsa, FormNfeAvulsa } from './form';

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

/** Um campo do XML guardado (o detalhe do bem e o pagamento não ficam em coluna). */
function doXml(xml: string | null, tagNome: string): string {
  const m = new RegExp(`<${tagNome}>([^<]*)</${tagNome}>`).exec(xml ?? '');
  return (m?.[1] ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}

function Campo({ rotulo, children, className = '' }: { rotulo: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`border border-black px-1.5 py-0.5 ${className}`}>
      <div className="text-[7px] uppercase leading-tight text-slate-700">{rotulo}</div>
      <div className="text-[11px] font-medium leading-tight">{children}</div>
    </div>
  );
}

export default async function NfeAvulsaPage(props: { searchParams: Promise<{ filialId?: string; nfeId?: string }> }) {
  const user = await exigirPermPage('nfce.read');
  const sp = await props.searchParams;
  const filiais = await filiaisDoUsuario(user.id);
  const escolhida = await escolherFilial(filiais, sp.filialId);
  if (!escolhida) redirect('/');
  const filial = escolhida;

  const [emit] = await db
    .select({ nome: schema.filial.nome, cnpj: schema.filial.cnpj, cfg: schema.filial.fiscalConfig })
    .from(schema.filial)
    .where(eq(schema.filial.id, filial.id))
    .limit(1);
  if (!emit) redirect('/');
  const logo = logoDaFilial(filial.id, emit.cfg);
  const pendencias = pendenciasNfe(emit.cfg);
  const regimeNormal = regimeNfe(emit.cfg) === 3;

  const todas = await nfesAvulsas(filial.id);
  const nota = sp.nfeId ? (todas.find((n) => n.id === sp.nfeId) ?? null) : null;

  const autorizada = nota?.status === 'AUTORIZADA';
  const homolog = nota ? nota.ambiente !== 1 : false;
  const itens = nota?.itens ?? [];
  const d = nota?.dest ?? null;
  const bc = nota ? code128C(nota.chave) : null;
  const vProd = itens.reduce((s, i) => s + i.valorTotal, 0);
  const detalheBem = doXml(nota?.xml ?? null, 'infAdProd');
  const tPag = doXml(nota?.xml ?? null, 'tPag');
  const faixa = !nota
    ? null
    : !autorizada
      ? nota.status === 'CANCELADA'
        ? 'NOTA CANCELADA — sem valor fiscal'
        : nota.status === 'REJEITADA'
          ? `NOTA REJEITADA PELA SEFAZ (${nota.cstat ?? ''}) — ${nota.xmotivo ?? ''}`
          : 'NOTA AINDA NÃO AUTORIZADA — sem valor fiscal'
      : homolog
        ? 'EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO — SEM VALOR FISCAL'
        : null;

  return (
    <main className="min-h-screen bg-slate-100 print:bg-white">
      <div className="no-print">
        <AppHeader userEmail={user.email} />
      </div>
      <div className="mx-auto w-fit max-w-full px-3 py-6 print:px-0 print:py-0">
        <div className="no-print mb-4 max-w-3xl">
          <Link href={`/fiscal/nfce?filialId=${filial.id}`} className="text-sm text-slate-600 underline">
            ◂ notas fiscais
          </Link>
          <h1 className="mt-2 text-lg font-semibold text-slate-900">NF-e de venda de bem da empresa</h1>
          <p className="mt-1 text-sm text-slate-600">
            Pra quando a empresa vende um bem que era dela — o carro, um equipamento, um móvel (bem do ativo imobilizado).
            Sai uma NF-e (nota grande, modelo 55) no nome do comprador.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">Quem está vendendo:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/fiscal/nfe-avulsa?filialId=${f.id}`}
                className={
                  f.id === filial.id
                    ? 'rounded-md bg-slate-900 px-2.5 py-1 font-semibold text-white'
                    : 'rounded-md border border-slate-300 px-2.5 py-1 text-slate-700 hover:bg-slate-100'
                }
              >
                {f.nome}
              </Link>
            ))}
          </div>
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            A nota sai pelo CNPJ <b>{cnpjFmt(emit.cnpj)}</b> — {emit.cfg?.razaoSocial ?? emit.nome}. Tem que ser o{' '}
            <b>mesmo CNPJ que está no documento do bem</b> (no carro, o CRLV). Se o bem está em outro CNPJ, troque a casa
            acima.
          </p>
          {pendencias.length > 0 && (
            <p className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
              Esta casa ainda não emite NF-e: {pendencias.join('; ')}.{' '}
              <Link href="/configuracoes/fiscal" className="underline">
                Abrir a config fiscal
              </Link>
            </p>
          )}
        </div>

        <div className="mb-5">
          <FormNfeAvulsa
            key={filial.id}
            filialId={filial.id}
            casa={emit.cfg?.razaoSocial ?? emit.nome}
            ufCasa={emit.cfg?.endereco?.uf ?? ''}
            regimeNormal={regimeNormal}
            infoPadrao={infoPadraoAtivo(emit.cfg)}
            formas={FORMAS_PAGAMENTO_AVULSA}
          />
        </div>

        {todas.length > 0 && (
          <div className="no-print mb-4 max-w-3xl rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Notas já pedidas nesta casa</h2>
            <ul className="mt-2 space-y-1 text-xs text-slate-700">
              {todas.map((n) => (
                <li key={n.id}>
                  <Link
                    href={`/fiscal/nfe-avulsa?filialId=${filial.id}&nfeId=${n.id}#nota`}
                    className={n.id === nota?.id ? 'font-semibold text-slate-900' : 'underline'}
                  >
                    nº {n.numero} série {n.serie} {n.ambiente === 1 ? '' : '(teste) '}— {n.status.toLowerCase()}
                  </Link>{' '}
                  · {dataHora(n.criadoEm)} · {n.dest?.nome ?? '—'} · R$ {num(Number(n.valorTotal))}
                  {n.status === 'REJEITADA' && n.xmotivo ? ` · ${n.cstat ?? ''} ${n.xmotivo}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        {nota && (
          <div id="nota">
            <div className="no-print mb-3 flex flex-wrap items-center gap-3">
              <AcoesNfeAvulsa nfeId={nota.id} temXml={!!nota.xml} podeCancelar={autorizada} />
            </div>

            <div className="danfe bg-white p-4 text-black shadow print:p-0 print:shadow-none">
              {faixa && (
                <div className="mb-2 border-2 border-black px-2 py-1 text-center text-sm font-bold uppercase">{faixa}</div>
              )}

              <div className="grid grid-cols-[1fr_120px_1.1fr]">
                <div className="border border-black p-2">
                  {logo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logo} alt="" className="float-left mr-3 h-[88px] w-[88px] object-contain" />
                  )}
                  <div className="text-[7px] uppercase text-slate-700">Identificação do emitente</div>
                  <div className={`${logo ? 'mt-1 text-[11px]' : 'text-sm'} font-bold leading-tight`}>{emit.cfg?.razaoSocial ?? emit.nome}</div>
                  {emit.cfg?.nomeFantasia && <div className={logo ? 'text-[10px]' : 'text-[11px]'}>{emit.cfg.nomeFantasia}</div>}
                  {enderecoLinhas(emit.cfg).map((l) => (
                    <div key={l} className={`${logo ? 'text-[9px]' : 'text-[10px]'} leading-tight`}>{l}</div>
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
                  {bc && bc.largura > 0 && (
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
                  {homolog ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL' : (d?.nome ?? '—')}
                </Campo>
                <Campo rotulo="CNPJ / CPF">{d ? formatarDocumento(d.documento) : '—'}</Campo>
                <Campo rotulo="Inscrição estadual">{d?.ie ?? '—'}</Campo>
              </div>
              <div className="grid grid-cols-[1.6fr_1fr_0.8fr]">
                <Campo rotulo="Endereço">
                  {d ? `${d.logradouro}, ${d.numero}${d.complemento ? ` — ${d.complemento}` : ''}` : '—'}
                </Campo>
                <Campo rotulo="Bairro / município / UF">{d ? `${d.bairro} · ${d.municipio}/${d.uf}` : '—'}</Campo>
                <Campo rotulo="CEP">{cepFmt(d?.cep) || '—'}</Campo>
              </div>

              <div className="mt-1.5 text-[8px] font-bold uppercase">Cálculo do imposto</div>
              <div className="grid grid-cols-6">
                <Campo rotulo="Base de cálc. do ICMS">0,00</Campo>
                <Campo rotulo="Valor do ICMS">0,00</Campo>
                <Campo rotulo="Desconto">0,00</Campo>
                <Campo rotulo="Outras despesas">0,00</Campo>
                <Campo rotulo="Valor total dos produtos">{num(vProd)}</Campo>
                <Campo rotulo="Valor total da nota" className="font-bold">{num(Number(nota.valorTotal))}</Campo>
              </div>

              <div className="mt-1.5 text-[8px] font-bold uppercase">Transportador / pagamento</div>
              <div className="grid grid-cols-2">
                <Campo rotulo="Frete por conta">9 - Sem ocorrência de transporte</Campo>
                <Campo rotulo="Forma de pagamento">{FORMAS_PAGAMENTO_AVULSA[tPag] ?? '—'}</Campo>
              </div>

              <div className="mt-1.5 text-[8px] font-bold uppercase">Dados dos produtos</div>
              <table className="w-full border-collapse text-[10px]">
                <thead>
                  <tr className="text-[7px] uppercase">
                    {['Cód.', 'Descrição', 'NCM', itens.some((x) => x.cst) ? 'CST' : 'CSOSN', 'CFOP', 'Un.', 'Qtd.', 'V. unit.', 'V. total'].map((h, i) => (
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
                      <td className="border border-black px-1">
                        {i.descricao}
                        {k === 0 && detalheBem ? <div className="text-[9px]">{detalheBem}</div> : null}
                      </td>
                      <td className="border border-black px-1">{i.ncm}</td>
                      <td className="border border-black px-1">{i.cst ?? i.csosn}</td>
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
              </div>
            </div>
          </div>
        )}
      </div>
      <style>{`
        .danfe { width: 200mm; max-width: 100%; }
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
