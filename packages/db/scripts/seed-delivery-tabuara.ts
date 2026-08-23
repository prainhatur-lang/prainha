// Cardápio inicial do delivery da Tabuará.
//
// Os pratos vêm do cardápio REAL da casa (PDV 0002) e as descrições saem da
// FICHA TÉCNICA — não do que a foto sugere. Foi assim que apareceram o
// presunto parma e o gorgonzola dentro do Wellington, e que a "bruschetta de
// camarão" se revelou Tapas de camarão (a bruschetta da casa é de cogumelos).
//
// Preço nasce IGUAL ao do salão; o delivery tem preço próprio e o dono ajusta
// na tela. Item que não aguenta viajar é desmarcado lá, não aqui.
//
// Idempotente (casa por nome dentro da filial). Não desativa nem apaga nada
// que já exista — rodar de novo só repõe o que falta.
//
// Uso: pnpm --filter @concilia/db seed:delivery-tabuara

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

const TABUARA = 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7';

interface Item {
  nome: string;
  /** A rua/avenida que dá nome ao prato no cardápio da casa. */
  rua?: string;
  preco: number;
  desc: string;
}

const CARDAPIO: { categoria: string; itens: Item[] }[] = [
  {
    categoria: 'Entradas',
    itens: [
      { nome: 'Bruschetta', rua: 'Rua Estância', preco: 40,
        desc: 'Ciabatta tostada com shitake e shimeji salteados, muçarela derretida e tomate confit, com orégano e manjericão fresco.' },
      { nome: 'Dadinho de tapioca', rua: 'Rua Itaporanga', preco: 49,
        desc: 'Cubos de tapioca com queijo coalho, crocantes por fora e macios por dentro, servidos com presunto parma e geleia de pimenta.' },
      { nome: 'Tapas de camarão', rua: 'Rua Capela', preco: 54,
        desc: 'Camarões salteados sobre torradas, com tomate crostine, fio de pesto, manjericão e xerém de castanha.' },
      { nome: 'Carpaccio', rua: 'Rua Aquidabã', preco: 68,
        desc: 'Fatias finíssimas com rúcula, lascas de parmesão e aioli de alcaparra, acompanhado de torradas.' },
      { nome: 'Camarões empanados', rua: 'Rua João Pessoa', preco: 75,
        desc: 'Camarões empanados em panko e goma de tapioca, dourados na hora — crocância que não amolece no caminho.' },
      { nome: 'Mini Fondue', rua: 'Rua Laranjeiras', preco: 75,
        desc: 'Pão italiano recheado de molho de queijo quente, com filé em cubos empanado pra mergulhar.' },
      { nome: 'Triologia do Mangue', rua: 'Rua Boquim', preco: 80,
        desc: 'Caranguejo, siri e aratu ao molho de moqueca, com limão siciliano e três farofas — de castanha, de coco e de limão.' },
    ],
  },
  {
    categoria: 'Do mar',
    itens: [
      { nome: 'Salmão grelhado', rua: 'Avenida Beira Mar', preco: 119,
        desc: 'Salmão grelhado com calda de laranja, arroz branco, brócolis, batata bolinha, cenoura e tomate-cereja.' },
      { nome: 'Filé de robalo grelhado', rua: 'Avenida Santos Dumont', preco: 135,
        desc: 'Robalo grelhado sobre banana da terra, com brócolis, batata bolinha, tomate-cereja e crocante de panko com xerém de castanha e parmesão.' },
      { nome: 'Polvo embrasado', rua: 'Avenida Desembargador Maynard', preco: 155,
        desc: 'Polvo embrasado sobre arroz negro cremoso de parmesão, com espuma de abóbora e lâminas de amêndoa.' },
      { nome: 'Risoto all Mare', rua: 'Avenida Tancredo Neves', preco: 165,
        desc: 'Arroz arbóreo cremoso com polvo, camarão, lula e mexilhão, finalizado em parmesão, manteiga e um toque de molho de ostra.' },
      { nome: 'Lagosta grelhada', rua: 'Avenida Maranhão', preco: 175,
        desc: 'Lagosta grelhada com fettuccine ao creme de manteiga e molho de ostra, com camarões salteados.' },
    ],
  },
  {
    categoria: 'Carnes',
    itens: [
      { nome: 'Baião de Dois Tabuará', preco: 119,
        desc: 'Feijão tropeiro com filé em cubos, charque e banana da terra, coberto por funduta de queijo e arroz branco. O prato mais sergipano da casa.' },
      { nome: 'Filé ao demi glace', rua: 'Avenida Francisco Porto', preco: 135,
        desc: 'Tornedor de 200 g grelhado no ponto que você pedir, ao clássico molho demi-glace.' },
      { nome: 'Filé Wellington', rua: 'Avenida José Carlos Silva', preco: 140,
        desc: 'O prato nº 1 da casa: tornedor envolto em presunto parma e gorgonzola, assado dentro da massa folhada até dourar.' },
      { nome: 'Carré de cordeiro', rua: 'Avenida Augusto Maynard', preco: 155,
        desc: 'Carré de cordeiro de 300 g sobre risoto de funghi com parmesão, finalizado com gremolata.' },
      { nome: 'Picanha com batatas gratinadas', rua: 'Avenida Ivo do Prado', preco: 159,
        desc: 'Picanha steak selada, com gratin dauphinois, chimichurri e farofa de alho.' },
    ],
  },
];

async function main() {
  const [f] = await sql<{ nome: string }[]>`select nome from filial where id = ${TABUARA}`;
  if (!f) throw new Error('filial Tabuará não encontrada');
  console.log(`Filial: ${f.nome}\n`);

  let novosCat = 0;
  let novosItem = 0;
  let jaTinha = 0;

  for (const [i, bloco] of CARDAPIO.entries()) {
    const [cat] = await sql<{ id: string }[]>`
      insert into delivery_categoria (filial_id, nome, ordem, ativo)
      values (${TABUARA}, ${bloco.categoria}, ${i * 10}, true)
      on conflict do nothing
      returning id`;
    let catId = cat?.id;
    if (catId) novosCat += 1;
    else {
      const [ex] = await sql<{ id: string }[]>`
        select id from delivery_categoria
        where filial_id = ${TABUARA} and nome = ${bloco.categoria} limit 1`;
      catId = ex?.id;
    }
    if (!catId) throw new Error(`categoria ${bloco.categoria} não resolveu`);

    console.log(`${bloco.categoria}`);
    for (const [j, it] of bloco.itens.entries()) {
      // O nome no cardápio leva a rua, como na casa.
      const nome = it.rua ? `${it.nome} — ${it.rua}` : it.nome;
      const [existe] = await sql<{ id: string }[]>`
        select id from delivery_item
        where filial_id = ${TABUARA} and nome = ${nome} limit 1`;
      if (existe) {
        jaTinha += 1;
        console.log(`   · ${nome}  (já existia, não mexi)`);
        continue;
      }
      await sql`
        insert into delivery_item
          (filial_id, categoria_id, nome, descricao, preco, ordem, ativo, checar_estoque)
        values
          (${TABUARA}, ${catId}, ${nome}, ${it.desc}, ${it.preco}, ${j * 10}, true, false)`;
      novosItem += 1;
      console.log(`   + ${nome}  R$ ${it.preco}`);
    }
    console.log('');
  }

  console.log(`Categorias novas: ${novosCat} · Itens novos: ${novosItem} · Já existiam: ${jaTinha}`);
  console.log('\nO delivery da Tabuará continua DESLIGADO (deliveryConfig.ativo = false).');
  await sql.end();
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
