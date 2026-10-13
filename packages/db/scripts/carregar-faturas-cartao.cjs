// Carga das faturas de cartão que o dono mandou em 12/10/2026 (52 arquivos:
// Itaú 5207, 8807, 1304 e Banco do Brasil Elo 9489, out/2025 a out/2026).
// Lê um JSON já conferido (soma dos lançamentos = total do banco em cada
// fatura), sobe o arquivo original pro bucket dos extratos (pasta cartoes/)
// e grava cartao_fatura + cartao_lancamento — o mesmo que a tela
// /financeiro/cartoes faz no envio. Pula a fatura que já existe (mesmo banco,
// cartão e vencimento). Sem --gravar só mostra o que faria.
//
//   node scripts/carregar-faturas-cartao.cjs <faturas.json> [--gravar]
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const ORG = 'a7238ba3-b150-4fb5-aa37-a895866df03f';
const USUARIO = 'ed9317ef-7360-4c88-9564-298b39846a81'; // prainhatur@gmail.com
const FILIAL = { 'Prainha Bar': '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9', 'Tabuará': 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7', 'Prainha Mar': 'e899dae2-38bf-4f3f-9149-7effd059fab8' };
const BUCKET = 'extratos-fechamento';
const TIPO = { '.pdf': 'application/pdf', '.csv': 'text/csv', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

// Mesmas regras de categoriaSugerida (apps/web/src/lib/cartao-fatura.ts).
const REGRAS = [
  [/LEVEROS|PROSOLARE|CHOPERIA|SORVEPAN/i, 'Equipamento / imobilizado'],
  [/TUDOTEC|CONECTE TUDO|UBIQUITI/i, 'Informática e rede'],
  [/CONSUMER|SPOTIFY/i, 'Software'],
  [/FERREIRA COS|DIMARA|ZABATA|PISOLAR|PS PARAF|MADAL|ANCORA|ELETRICA BAHIANA/i, 'Manutenção e reforma'],
  [/PETROX|VASPETRO|A C POSTO|MIRELLE|CIMAVEL|ESTACION|RIOMAR/i, 'Combustível e veículo'],
  [/MAPFRE/i, 'Seguro'],
  [/ESTOK|CASA CUSTON|LOJAS PINGUI|MERCADO\*|MERCADOLIVRE/i, 'Utensílios e material de uso'],
  [/ASSAI|FILIAL DIA|SAMS CLUB|G BARBOSA|MERCADO SUL|MABENI/i, 'Insumos / mercado'],
  [/DONANA/i, 'Decoração'],
  [/GRUPO ALPHA/i, 'Marketing'],
  [/AGROVEL/i, 'Dedetização'],
  [/COMEL/i, 'Embalagens'],
  [/JUROS|MULTA|ENCARGOS|IOF/i, 'Despesa financeira'],
  [/ANUIDADE/i, 'Anuidade'],
  [/MAPLE ?BEAR|FORMATU|DUFRY|DUTY|SGV|DROGASIL|FARMAC|DUOCLINIQUE|JCN REST|FORNERIA|JoseDaPaixao|PBKIDS|^ARACAJU|CAPPTA|KIDS BRINQUE|OSMARIO/i, 'Despesa interna'],
];
const categoria = (e) => { for (const [re, c] of REGRAS) if (re.test(e)) return c; return null; };

(async () => {
  const gravar = process.argv.includes('--gravar');
  const faturas = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const sql = postgres(process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL, { ssl: 'require' });
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let novas = 0, puladas = 0, linhas = 0, semCat = 0;
  try {
    for (const f of faturas) {
      const soma = f.lanc.reduce((s, l) => s + Math.round(l[4] * 100), 0);
      if (soma !== Math.round(f.total * 100)) throw new Error('soma não bate: ' + f.arquivo);
      const [ja] = await sql`select id from cartao_fatura where organizacao_id=${ORG} and banco=${f.banco}
        and cartao_final=${f.cartaoFinal} and vencimento=${f.vencimento} and excluido_em is null`;
      if (ja) { puladas++; continue; }
      const nome = path.basename(f.arquivo);
      const ext = path.extname(nome).toLowerCase();
      const buf = fs.readFileSync(f.arquivo);
      const seguro = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_');
      const caminho = `cartoes/${ORG}/${new Date().toISOString().replace(/[:.]/g, '-')}-${seguro}`;
      const rows = f.lanc.map((l, i) => ({
        organizacao_id: ORG, ordem: i, cartao_final: l[5], data_compra: l[0], estabelecimento: l[1],
        parcela: l[2], total_parcelas: l[3], valor: l[4].toFixed(2),
        categoria: l[6] || categoria(l[1]), filial_id: l[7] ? FILIAL[l[7]] : null,
      }));
      if (rows.some((r) => r.filial_id === undefined)) throw new Error('casa desconhecida: ' + f.arquivo);
      semCat += rows.filter((r) => !r.categoria).length;
      linhas += rows.length; novas++;
      console.log(`${gravar ? 'grava' : 'gravaria'} ${f.banco} ${f.cartaoFinal} venc ${f.vencimento} — ${rows.length} lanç, R$ ${f.total.toFixed(2)} — ${nome}`);
      if (!gravar) continue;
      const r = await fetch(`${base}/storage/v1/object/${BUCKET}/${caminho}`, {
        method: 'POST', headers: { Authorization: `Bearer ${chave}`, apikey: chave, 'Content-Type': TIPO[ext] }, body: buf,
      });
      if (!r.ok) throw new Error(`upload ${nome}: ${r.status} ${await r.text()}`);
      await sql.begin(async (tx) => {
        const [fat] = await tx`insert into cartao_fatura (organizacao_id, banco, cartao_final, titular, vencimento, total,
            soma_lida, qtd_lancamentos, status, nome_original, storage_path, content_type, tamanho_bytes, enviado_por)
          values (${ORG}, ${f.banco}, ${f.cartaoFinal}, ${f.titular}, ${f.vencimento}, ${f.total.toFixed(2)},
            ${(soma / 100).toFixed(2)}, ${rows.length}, 'LIDA', ${nome}, ${caminho}, ${TIPO[ext]}, ${buf.length}, ${USUARIO})
          returning id`;
        for (let i = 0; i < rows.length; i += 200) {
          await tx`insert into cartao_lancamento ${tx(rows.slice(i, i + 200).map((x) => ({ ...x, fatura_id: fat.id })))}`;
        }
      });
    }
    console.log(`\n${novas} faturas ${gravar ? 'gravadas' : 'a gravar'}, ${puladas} já existiam, ${linhas} lançamentos (${semCat} sem categoria).`);
  } finally {
    await sql.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
