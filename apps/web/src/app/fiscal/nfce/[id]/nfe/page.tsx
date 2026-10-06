// Cupom → nota: emite a NF-e (modelo 55) de um cupom (NFC-e) já autorizado, no
// CNPJ/CPF do cliente, e mostra o DANFE A4 pra imprimir. O cupom continua
// valendo; a NF-e referencia a chave dele (CFOP 5929). ?nfeId=… abre uma
// tentativa específica (teste, rejeitada, cancelada).

import { logoDaFilial } from '@/lib/logo-filial';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db, schema } from '@concilia/db';
import type { FiscalConfig } from '@concilia/db/schema';
import { and, eq } from 'drizzle-orm';
import { exigirPermPage } from '@/lib/exigir-perm';
import { brl } from '@/lib/format';
import { formatarDocumento } from '@/lib/nfce/documento';
import { nfesDoCupom } from '@/lib/nfe/emitir-cupom';
import { code128C } from '@/lib/nfe/barras';
import { AcoesNfeCupom, FormNfeCupom } from './form';

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

export default async function NfeDoCupomPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ nfeId?: string }>;
}) {
  const user = await exigirPermPage('nfce.read');
  const { id } = await props.params;
  const sp = await props.searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [cupom] = await db.select().from(schema.nfceEmitida).where(eq(schema.nfceEmitida.id, id)).limit(1);
  if (!cupom) notFound();
  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, cupom.filialId)))
    .limit(1);
  if (!acesso) notFound();

  const [emit] = await db
    .select({ nome: schema.filial.nome, cnpj: schema.filial.cnpj, cfg: schema.filial.fiscalConfig })
    .from(schema.filial)
    .where(eq(schema.filial.id, cupom.filialId))
    .limit(1);
  if (!emit) notFound();
  const logo = logoDaFilial(cupom.filialId, emit.cfg);

  const todas = await nfesDoCupom(cupom.id);
  const valendo = todas.find((n) => n.ambiente === 1 && n.status === 'AUTORIZADA') ?? null;
  const nota = (sp.nfeId ? todas.find((n) => n.id === sp.nfeId) : null) ?? valendo ?? todas[0] ?? null;
  const cupomOk = cupom.status === 'AUTORIZADA';
  // Formulário aparece enquanto não houver NF-e de produção valendo.
  const mostraForm = cupomOk && !valendo;
  const ultimoDest = todas.find((n) => n.dest)?.dest ?? null;
  const inicial = ultimoDest
    ? {
        documento: ultimoDest.documento,
        nome: ultimoDest.nome,
        ie: ultimoDest.ie ?? '',
        email: ultimoDest.email ?? '',
        cep: ultimoDest.cep,
        logradouro: ultimoDest.logradouro,
        numero: ultimoDest.numero,
        complemento: ultimoDest.complemento ?? '',
        bairro: ultimoDest.bairro,
        municipio: ultimoDest.municipio,
        uf: ultimoDest.uf,
        codigoMunicipio: ultimoDest.codigoMunicipio,
        fone: ultimoDest.fone ?? '',
      }
    : { documento: cupom.destDocumento ?? '' };

  const autorizada = nota?.status === 'AUTORIZADA';
  const homolog = nota ? nota.ambiente !== 1 : false;
  const itens = nota?.itens ?? [];
  const d = nota?.dest ?? null;
  const bc = nota ? code128C(nota.chave) : null;
  const vProd = itens.reduce((s, i) => s + i.valorTotal, 0);
  const vDesc = itens.reduce((s, i) => s + (i.valorDesconto ?? 0), 0);
  const vOutro = itens.reduce((s, i) => s + (i.valorOutro ?? 0), 0);
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
    <main className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto w-fit max-w-full px-3 print:px-0">
        <div className="no-print mb-4">
          <Link href={`/fiscal/nfce?filialId=${cupom.filialId}`} className="text-sm text-slate-600 underline">
            ◂ notas fiscais
          </Link>
          <h1 className="mt-2 text-lg font-semibold text-slate-900">Cupom → NF-e (nota grande)</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            {emit.nome} · cupom (NFC-e) nº <b>{cupom.numero}</b> série {cupom.serie} ·{' '}
            {dataHora(cupom.autorizadaEm ?? cupom.criadoEm)} · {cupom.mesa ? `${cupom.mesa} · ` : ''}
            <b>{brl(cupom.valorTotal)}</b>
            {cupom.destDocumento
              ? ` · saiu no documento ${formatarDocumento(cupom.destDocumento)}`
              : ' · consumidor não identificado'}
          </p>
          <p className="mt-1 max-w-3xl text-xs text-slate-500">
            A NF-e sai com os mesmos itens e o mesmo valor, citando a chave do cupom. O cupom continua valendo — a venda
            não é lançada duas vezes.
          </p>
          {!cupomOk && (
            <p className="mt-3 max-w-3xl rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
              Este cupom está <b>{cupom.status}</b> — só cupom autorizado vira NF-e.
            </p>
          )}
          {valendo && (
            <p className="mt-3 max-w-3xl rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Este cupom já tem NF-e autorizada: nº <b>{valendo.numero}</b> série {valendo.serie}
              {valendo.dest ? ` — ${valendo.dest.nome}` : ''}. Pra trocar o cliente, cancele essa (até 24 h) e emita
              outra.
            </p>
          )}
        </div>

        {todas.length > 1 && (
          <p className="no-print mb-3 text-xs text-slate-500">
            Tentativas deste cupom:{' '}
            {todas.map((n, i) => (
              <span key={n.id}>
                {i > 0 && ' · '}
                <Link
                  href={`/fiscal/nfce/${cupom.id}/nfe?nfeId=${n.id}`}
                  className={n.id === nota?.id ? 'font-semibold text-slate-800' : 'underline'}
                >
                  nº {n.numero} {n.ambiente === 1 ? '' : '(teste) '}— {n.status.toLowerCase()}
                </Link>
              </span>
            ))}
          </p>
        )}

        {mostraForm && (
          <div className="mb-5">
            <FormNfeCupom
              nfceId={cupom.id}
              inicial={inicial}
              rotuloEmitir={todas.some((n) => n.ambiente === 1) ? '🧾 Tentar emitir de novo' : '🧾 Emitir NF-e'}
            />
          </div>
        )}

        {nota && (
          <>
            <div className="no-print mb-3 flex flex-wrap items-center gap-3">
              <AcoesNfeCupom nfeId={nota.id} temXml={!!nota.xml} podeCancelar={autorizada} />
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
                <Campo rotulo="Desconto">{num(vDesc)}</Campo>
                <Campo rotulo="Outras despesas">{num(vOutro)}</Campo>
                <Campo rotulo="Valor total dos produtos">{num(vProd)}</Campo>
                <Campo rotulo="Valor total da nota" className="font-bold">{num(Number(nota.valorTotal))}</Campo>
              </div>

              <div className="mt-1.5 text-[8px] font-bold uppercase">Transportador / volumes</div>
              <div className="grid grid-cols-1">
                <Campo rotulo="Frete por conta">9 - Sem ocorrência de transporte</Campo>
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
                      <td className="border border-black px-1">{i.descricao}</td>
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
                <div className="mt-1 text-slate-700">
                  Documento referenciado: NFC-e {chaveFmt(nota.chaveReferenciada ?? cupom.chave)}
                </div>
              </div>
            </div>
          </>
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
