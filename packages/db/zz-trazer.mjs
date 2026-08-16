import fs from 'node:fs';
import postgres from 'postgres';
import dotenv from 'dotenv';
import Firebird from 'node-firebird';
dotenv.config({ path: '../../.env' });
const sql = postgres(process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL, { ssl: 'require' });
const P = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';
const S = '/private/tmp/claude-501/-Volumes-PortableSSD-Aplicativos-concilia/5606e9ce-e6ac-42af-8afe-3e36b7467b0d/scratchpad';
const APLICAR = process.argv.includes('--aplicar');

const limpar = (n) => { const c=(n??'').trim(); if(/^\W*exclu[ií]do\b/i.test(c)) return null;
  const l=c.replace(/^[.*\s]+/,'').replace(/^T\s+/,''); return l||null; };
const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const terraco = (n) => /^T\s+/.test((n??'').replace(/^[.*\s]+/,''));

// ordem das categorias vinda do Consumer (ETIQUETAS.ORDEM); se a VPN cair, alfabetica
function ordemDoConsumer() {
  return new Promise((res) => {
    const t = setTimeout(() => res(null), 9000);
    Firebird.attach({host:'10.0.0.252',port:3050,database:'C:\\Users\\Administrator\\AppData\\Local\\RAL Tecnologia\\CreateInstall\\consumer.fdb',user:'SYSDBA',password:'masterkey',lowercase_keys:false,pageSize:4096},
      (e,db)=>{ clearTimeout(t); if(e) return res(null);
        db.query(`SELECT CODIGO, ORDEM FROM ETIQUETAS WHERE DATADELETE IS NULL`,[],(err,rows)=>{ db.detach(); res(err?null:rows); }); });
  });
}

const cods = new Set(fs.readFileSync(S+'/codigos.txt','utf8').trim().split('\n').map(Number).filter(Number.isFinite));

const rows = await sql`
  SELECT pv.id variante_id, p.codigo_externo cod, p.nome, p.descricao,
         coalesce(pv.preco_venda,p.preco_venda) preco, pt.descricao tamanho,
         et.nome categoria, et.codigo_externo etiq
  FROM produto_variante pv
  JOIN produto p ON p.filial_id=pv.filial_id AND p.codigo_externo=pv.codigo_produto_externo
  LEFT JOIN produto_tamanho pt ON pt.id=pv.produto_tamanho_id
  LEFT JOIN produto_etiqueta et ON et.filial_id=p.filial_id
    AND et.codigo_externo = NULLIF(regexp_replace(p.codigo_etiqueta,'\\D','','g'),'')::integer
  WHERE pv.filial_id=${P} AND pv.data_pausado IS NULL AND pv.data_delete IS NULL
    AND (p.descontinuado=false OR p.descontinuado IS NULL)
    AND p.codigo_produto_tipo IN (1,5)`;

const porChave = new Map();
for (const r of rows) {
  if (terraco(r.nome) || /terra[çc]o/i.test(r.categoria??'')) continue;
  if (!cods.has(Number(r.cod))) continue;                    // SÓ COM FOTO
  // Tabaco fora: venda de cigarro pela internet é proibida (Lei 9.294/96).
  if (/^cigarro/i.test((r.categoria??'').trim())) continue;
  const limpo = limpar(r.nome); if (!limpo) continue;
  const pn = Number(r.preco); if (!Number.isFinite(pn) || pn<=0) continue;
  const cent = Math.round(pn*100);
  const tam = (r.tamanho??'').trim() || null;
  const nome = tam ? `${limpo} — ${tam}` : limpo;
  const chave = `${norm(nome)}|${cent}`;
  const cand = { varianteId:r.variante_id, nome, descricao:(r.descricao??'').trim()||null,
                 cent, categoria:(r.categoria??'').trim()||'Outros', etiq:r.etiq };
  const atual = porChave.get(chave);
  if (!atual || (!atual.descricao && cand.descricao)) porChave.set(chave, cand);
}
const itens = [...porChave.values()];

const ordemFB = await ordemDoConsumer();
const ordemPorEtiq = new Map((ordemFB??[]).map(x=>[Number(x.CODIGO), Number(x.ORDEM)??0]));
console.log(ordemFB ? `ordem das categorias: do Consumer (${ordemFB.length} etiquetas)` : 'ordem das categorias: alfabetica (VPN indisponivel)');

const cats = new Map();
for (const i of itens) {
  const a = cats.get(i.categoria) ?? { n:0, ordem: ordemPorEtiq.get(Number(i.etiq)) ?? 999 };
  a.n++; cats.set(i.categoria, a);
}
const catsOrdenadas = [...cats.entries()].sort((a,b)=> (a[1].ordem-b[1].ordem) || a[0].localeCompare(b[0],'pt-BR'));

console.log(`\nVAI TRAZER ${itens.length} itens em ${cats.size} categorias:`);
for (const [nome,a] of catsOrdenadas) console.log('  '+String(a.n).padStart(3), nome);

if (!APLICAR) { console.log('\n--- PREVIA: nada gravado. --aplicar pra valer. ---'); await sql.end(); process.exit(0); }

let ordem = 0, criados = 0;
for (const [nomeCat] of catsOrdenadas) {
  ordem++;
  let [cat] = await sql`SELECT id FROM delivery_categoria WHERE filial_id=${P} AND lower(nome)=${nomeCat.toLowerCase()} LIMIT 1`;
  if (!cat) [cat] = await sql`INSERT INTO delivery_categoria (filial_id, nome, ordem) VALUES (${P}, ${nomeCat.slice(0,80)}, ${ordem}) RETURNING id`;
  else await sql`UPDATE delivery_categoria SET ordem=${ordem} WHERE id=${cat.id}`;
  const doGrupo = itens.filter(i=>i.categoria===nomeCat).sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
  let o = 0;
  for (const i of doGrupo) {
    o++;
    await sql`INSERT INTO delivery_item (filial_id, categoria_id, nome, descricao, preco, variante_id, ordem)
      VALUES (${P}, ${cat.id}, ${i.nome.slice(0,160)}, ${i.descricao}, ${(i.cent/100).toFixed(2)}, ${i.varianteId}, ${o})`;
    criados++;
  }
  process.stdout.write(`\r  gravando... ${criados}/${itens.length}`);
}
console.log(`\n\nPronto: ${criados} itens em ${cats.size} categorias.`);
await sql.end();
