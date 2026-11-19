// Copia a CONTA BANCÁRIA (banco, agência, conta — o Pix não é tocado) pro
// cadastro da pessoa nas casas onde ela está na folha e a conta está vazia,
// trazendo do cadastro dela em outra casa (mesmo CPF; a E.B. primeiro).
// Pedido do dono 19/11/2026 ("Sim, corrigir"). Idempotente. Ficam DE FORA, pra
// o dono decidir: quem tem duas contas diferentes, quem tem Pix diferente entre
// as casas, e conta anotada em nome de outra pessoa ("CAIXA( FULANO )").
// Uso: node scripts/copiar-conta-entre-casas-2026-11-19.cjs [--gravar]
const postgres = require('postgres');
require('dotenv').config({ path: '../../.env' });
const sql = postgres(process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL, { ssl: 'require' });
const gravar = process.argv.includes('--gravar');
(async () => {
  const r = await sql`
  with f as (
    select fo.id, regexp_replace(coalesce(fo.cnpj_ou_cpf,''),'[^0-9]','','g') cpf, fo.nome, fi.nome casa,
      nullif(trim(fo.banco_nome),'') bn, nullif(trim(fo.banco_agencia),'') ag, nullif(trim(fo.banco_conta),'') conta, nullif(trim(fo.chave_pix),'') pix,
      (exists(select 1 from fornecedor_folha ff where ff.fornecedor_id=fo.id) or exists(select 1 from funcionario fu where fu.fornecedor_id=fo.id)) alvo
    from fornecedor fo join filial fi on fi.id=fo.filial_id where fo.data_delete is null
  ), pes as (
    select cpf, count(distinct regexp_replace(conta,'[^0-9]','','g')) n_conta, count(distinct pix) n_pix from f where length(cpf)=11 group by cpf
  ), src as (
    select distinct on (cpf) cpf, bn, ag, conta, casa de from f where length(cpf)=11 and conta is not null
    order by cpf, (casa ilike 'E.B.%') desc, casa
  )
  select f.id, f.nome, f.casa, s.bn, s.ag, s.conta, s.de,
    case when p.n_conta > 1 then 'duas contas diferentes'
         when p.n_pix > 1 then 'Pix diferente entre as casas'
         when s.bn ~ '\\(.*[A-Za-z]{2,}.*\\)' or s.bn ilike '%titular%' then 'conta em nome de outra pessoa'
    end pular
  from f join src s using(cpf) join pes p using(cpf)
  where f.alvo and f.conta is null order by f.nome, f.casa`;
  let n = 0;
  await sql.begin(async (tx) => {
    for (const x of r) {
      if (x.pular) { console.log('PULOU  |', x.nome, '|', x.casa, '|', x.pular, '|', x.de, x.bn, x.ag, x.conta); continue; }
      if (gravar) {
        const u = await tx`update fornecedor set banco_nome=${x.bn}, banco_agencia=${x.ag}, banco_conta=${x.conta}
          where id=${x.id} and nullif(trim(banco_conta),'') is null returning id`;
        n += u.length;
      }
      console.log(gravar ? 'GRAVOU |' : 'gravaria |', x.nome, '|', x.casa, '<=', x.de, '|', x.bn, x.ag, x.conta);
    }
  });
  console.log(gravar ? `${n} cadastros gravados` : 'simulação (use --gravar)');
  await sql.end();
})();
