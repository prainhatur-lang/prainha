// Importa os EDI reais (CIELO03/04 de 31/07–06/08) pro banco de produção,
// roteando cada linha pra filial dona do EC — mesmo comportamento do /upload.
// Dedupe pelo unique (filial, adquirente, nsu, data, autorizacao) + ON CONFLICT.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import * as dotenv from 'dotenv';
import {
  lerCabecalhoEdi,
  parseCieloEdiVendas,
  parseCieloEdiRecebiveis,
} from '/Volumes/PortableSSD/Aplicativos/concilia/packages/conciliador/src/parsers/cielo-edi';

dotenv.config({ path: '/Volumes/PortableSSD/Aplicativos/concilia/.env' });
const sql = postgres(process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL!, { ssl: 'require' });

const DIR = '/Users/elisonbomfim/Downloads/CIELO_EDI_1_1_ad6e3f1a-69b1-4d93-8ab9-645025954604';

// EC → filial (confirmado contra o histórico de venda_adquirente em produção)
const PRAINHA = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';
const TABUARA = 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7';
const FILIAL_POR_EC: Record<string, string> = {
  '1115651924': PRAINHA,
  '2900246061': TABUARA,
  '2899958040': TABUARA,
};
const NOME: Record<string, string> = { [PRAINHA]: 'Prainha Bar', [TABUARA]: 'Tabuara' };

const parseDateBR = (s: string): string | null =>
  /^\d{2}\/\d{2}\/\d{4}$/.test(s) ? s.split('/').reverse().join('-') : null;

async function main() {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.TXT')).sort();
  const totais = new Map<string, { vLidas: number; vIns: number; rLidos: number; rIns: number }>();
  const tot = (fid: string) => {
    const t = totais.get(fid) ?? { vLidas: 0, vIns: 0, rLidos: 0, rIns: 0 };
    totais.set(fid, t);
    return t;
  };
  const semDono: Record<string, number> = {};

  for (const f of files) {
    const buf = readFileSync(join(DIR, f));
    const info = lerCabecalhoEdi(buf);
    if (!info || (info.tipoArquivo !== 'CIELO03' && info.tipoArquivo !== 'CIELO04')) continue;
    const origem = `edi-manual/2026-08-06/${f}`;

    if (info.tipoArquivo === 'CIELO03') {
      const rows = parseCieloEdiVendas(buf)
        .map((r) => ({ r, filial: FILIAL_POR_EC[r.estabelecimento] }))
        .filter(({ r, filial }) => {
          if (!filial) { semDono[r.estabelecimento] = (semDono[r.estabelecimento] ?? 0) + 1; return false; }
          return true;
        })
        .map(({ r, filial }) => ({
          filial_id: filial!,
          adquirente: 'CIELO',
          codigo_estabelecimento: r.estabelecimento || null,
          data_venda: parseDateBR(r.data) ?? '',
          hora_venda: r.hora || null,
          forma_pagamento: r.formaPagamento || null,
          bandeira: r.bandeira || null,
          valor_bruto: String(r.valorBruto),
          valor_taxa: r.valorTaxa ? String(r.valorTaxa) : null,
          valor_liquido: r.valorLiquido ? String(r.valorLiquido) : null,
          nsu: r.nsu,
          autorizacao: r.autorizacao || null,
          tid: r.tid,
          data_prevista_pagamento: parseDateBR(r.dataPrevistaPagamento),
          arquivo_origem: origem,
        }));
      for (const row of rows) tot(row.filial_id).vLidas++;
      if (rows.length) {
        const ins = await sql`INSERT INTO venda_adquirente ${sql(rows)} ON CONFLICT DO NOTHING RETURNING id, filial_id`;
        for (const i of ins) tot(i.filial_id).vIns++;
      }
    } else {
      const rows = parseCieloEdiRecebiveis(buf)
        .map((r) => ({ r, filial: FILIAL_POR_EC[r.estabelecimento] }))
        .filter(({ r, filial }) => {
          if (!filial) { semDono[r.estabelecimento] = (semDono[r.estabelecimento] ?? 0) + 1; return false; }
          return true;
        })
        .map(({ r, filial }) => ({
          filial_id: filial!,
          adquirente: 'CIELO',
          codigo_estabelecimento: r.estabelecimento || null,
          data_pagamento: parseDateBR(r.dataPagamento) ?? '',
          data_venda: parseDateBR(r.dataVenda),
          forma_pagamento: r.formaPagamento || null,
          bandeira: r.bandeira || null,
          valor_bruto: String(r.valorBruto),
          valor_taxa: r.valorTaxa ? String(r.valorTaxa) : null,
          valor_liquido: String(r.valorLiquido),
          nsu: r.nsu,
          autorizacao: r.autorizacao || null,
          status: r.status || null,
          arquivo_origem: origem,
        }));
      for (const row of rows) tot(row.filial_id).rLidos++;
      if (rows.length) {
        const ins = await sql`INSERT INTO recebivel_adquirente ${sql(rows)} ON CONFLICT DO NOTHING RETURNING id, filial_id`;
        for (const i of ins) tot(i.filial_id).rIns++;
      }
    }
  }

  console.log('=== importação concluída ===');
  for (const [fid, t] of totais) {
    console.log(
      `${NOME[fid] ?? fid}: vendas ${t.vIns}/${t.vLidas} inseridas (resto já existia) · recebíveis ${t.rIns}/${t.rLidos}`,
    );
  }
  if (Object.keys(semDono).length) console.log('⚠️ linhas ignoradas por EC desconhecido:', semDono);

  const conferencia = await sql`
    SELECT f.nome, max(va.data_venda)::text AS ultima_venda,
           (SELECT max(ra.data_pagamento)::text FROM recebivel_adquirente ra WHERE ra.filial_id = f.id) AS ultimo_recebivel
    FROM venda_adquirente va JOIN filial f ON f.id = va.filial_id
    WHERE va.adquirente = 'CIELO' GROUP BY f.id, f.nome ORDER BY 1`;
  console.log('=== estado pós-import ===');
  for (const c of conferencia) console.log(`${c.nome}: última venda ${c.ultima_venda} · último recebível ${c.ultimo_recebivel}`);
  await sql.end();
}

main().catch((e) => { console.error('ERRO:', e); process.exit(1); });
