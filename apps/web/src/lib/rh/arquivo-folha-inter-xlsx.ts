// Preenche o modelo oficial do Inter (inter-folha-modelo.ts) com o pagador e os
// beneficiários. Mexe só no XML das abas Pagador e Beneficiarios e no tamanho
// das tabelas — a aba Instruções, os estilos e a proteção ficam como o Inter
// mandou (regra 11 do modelo: "Não altere, adicione ou remova planilhas").

import * as XLSX from 'xlsx';
import { MODELO_FOLHA_INTER_BASE64 } from './inter-folha-modelo';

export interface PagadorInter {
  nome: string;
  cnpj: string;
  conta: string;
  total: number;
}
export interface BeneficiarioInter {
  nome: string;
  cpf: string;
  conta: string;
  valor: number;
}

// Estilos do próprio modelo (xl/styles.xml): 19 texto, 20 R$, 21 texto
// centralizado (conta), 22 data.
const S_TEXTO = 19;
const S_VALOR = 20;
const S_CONTA = 21;
const S_DATA = 22;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const txt = (ref: string, s: number, v: string) =>
  `<c r="${ref}" s="${s}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
const num = (ref: string, s: number, v: number) => `<c r="${ref}" s="${s}"><v>${v}</v></c>`;

/** AAAA-MM-DD → número de série do Excel. */
function serialExcel(ymd: string): number {
  const [a, m, d] = ymd.split('-').map(Number);
  return Date.UTC(a, m - 1, d) / 86400000 + 25569;
}

type Cfb = ReturnType<typeof XLSX.CFB.read>;
function lerXml(cfb: Cfb, caminho: string): { ent: { content: unknown }; xml: string } {
  const ent = XLSX.CFB.find(cfb, '/' + caminho) as { content: unknown } | null;
  if (!ent) throw new Error(`modelo do Inter sem ${caminho}`);
  return { ent, xml: Buffer.from(ent.content as Uint8Array).toString('utf8') };
}
function gravarXml(ent: { content: unknown }, xml: string) {
  ent.content = Buffer.from(xml, 'utf8');
}

export function gerarArquivoFolhaInter(
  pagador: PagadorInter,
  linhas: BeneficiarioInter[],
  dataYmd: string,
): Buffer {
  const cfb = XLSX.CFB.read(Buffer.from(MODELO_FOLHA_INTER_BASE64, 'base64'), { type: 'buffer' });
  const ultima = Math.max(2, linhas.length + 1);

  // Pagador: linha 2.
  {
    const { ent, xml } = lerXml(cfb, 'xl/worksheets/sheet2.xml');
    const linha2 =
      `<row r="2" spans="1:4">` +
      txt('A2', S_TEXTO, pagador.nome) +
      txt('B2', S_TEXTO, pagador.cnpj) +
      txt('C2', S_TEXTO, pagador.conta) +
      num('D2', S_VALOR, Math.round(pagador.total * 100) / 100) +
      `</row>`;
    gravarXml(ent, xml.replace(/<row r="2"[\s\S]*?<\/row>/, linha2));
  }

  // Beneficiarios: da linha 2 em diante, sem linha em branco.
  {
    const { ent, xml } = lerXml(cfb, 'xl/worksheets/sheet3.xml');
    const serial = serialExcel(dataYmd);
    const rows = linhas
      .map((l, i) => {
        const r = i + 2;
        return (
          `<row r="${r}" spans="1:6">` +
          txt(`A${r}`, S_TEXTO, l.nome) +
          txt(`B${r}`, S_TEXTO, l.cpf) +
          txt(`C${r}`, S_CONTA, l.conta) +
          num(`D${r}`, S_VALOR, Math.round(l.valor * 100) / 100) +
          num(`E${r}`, S_DATA, serial) +
          num(`F${r}`, S_DATA, serial) +
          `</row>`
        );
      })
      .join('');
    gravarXml(
      ent,
      xml
        .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:F${ultima}"/>`)
        .replace(/(<row r="1"[\s\S]*?<\/row>)/, `$1${rows}`),
    );
  }

  // Tabela7 (Beneficiarios) cobre todas as linhas.
  {
    const { ent, xml } = lerXml(cfb, 'xl/tables/table2.xml');
    gravarXml(ent, xml.replace(/ref="A1:F\d+"/g, `ref="A1:F${ultima}"`));
  }

  return Buffer.from(XLSX.CFB.write(cfb, { fileType: 'zip', type: 'buffer' }) as Uint8Array);
}
