// Cardápio da Prainha Mar e Grill (filial 03) como está no cardápio impresso
// do soft open (set/2026). Nome e preço conferidos contra os produtos da
// filial 03 no Concilia em 28/09/2026 — bateram todos. Mudou preço no PDV?
// Muda aqui também, senão o site vende um preço e o garçom cobra outro.

export type ItemCardapio = { nome: string; preco: number; desc?: string; consulta?: boolean };
export type SecaoCardapio = { titulo: string; itens: ItemCardapio[] };

export const COZINHA: SecaoCardapio[] = [
  {
    titulo: 'Caldinhos',
    itens: [
      { nome: 'Caldinho de sururu', preco: 26, desc: 'Receita tradicional com o toque do Prainha: sururu bem temperado e caldo quentinho' },
      { nome: 'Caldinho de camarão', preco: 31, desc: 'Cremoso e cheio de sabor, com camarões e tempero da casa' },
      { nome: 'Caldinho de bacalhau', preco: 27, desc: 'Cremoso e leve, com o sabor marcante do mar' },
    ],
  },
  {
    titulo: 'Petiscos',
    itens: [
      { nome: 'Batata frita', preco: 28, desc: 'Dourada, crocante e cheia de sabor' },
      { nome: 'Mix de minipastéis', preco: 41, desc: 'Queijo derretido, filé, camarão e aratu' },
      { nome: 'Porção de pastel de camarão', preco: 50, desc: 'Massa fininha e crocante, recheio generoso de camarão' },
      { nome: 'Isca de frango', preco: 59, desc: 'Empanada em farinha especial, com molho rosé ou limão-siciliano' },
      { nome: 'Isca de robalo', preco: 69, desc: 'Empanada em farinha especial, com molho rosé ou limão-siciliano' },
      { nome: 'Filé ao molho exclusivo com torradas', preco: 72, desc: 'Cubos de filé ao molho de shiitake, shimeji e creme de leite. Torradas feitas na hora' },
      { nome: 'Burrata, prosciutto, tomate-cereja confit e azeite trufado', preco: 78, desc: 'Burrata italiana sobre tomate-cereja confit, prosciutto, pesto e azeite trufado' },
      { nome: 'Catado de caranguejo', preco: 38, desc: 'Refogado e crocante na farinha panko' },
      { nome: 'Catado de aratu', preco: 49, desc: 'Refogado e crocante na farinha panko' },
      { nome: 'Camarão paris no panko com molho dijon especial', preco: 138, desc: 'Camarão VG crocante em panko, molho dijon de creme fresco e cogumelo-paris' },
    ],
  },
  {
    titulo: 'Do Mar',
    itens: [
      { nome: 'Robalo grelhado no azeite com legumes', preco: 89, desc: 'Leve e saudável, com legumes grelhados no azeite de oliva' },
      { nome: 'Dueto do mar', preco: 94, desc: 'Filé alto de robalo e camarão zero de Santa Catarina grelhados no azeite extravirgem' },
      { nome: 'Risoto de camarão', preco: 99, desc: 'Ultracremoso, com camarões suculentos' },
    ],
  },
  {
    titulo: 'Moquecas',
    itens: [
      { nome: 'Moqueca de filé de robalo', preco: 199 },
      { nome: 'Moqueca de camarão VG de Santa Catarina', preco: 230 },
      { nome: 'Moqueca de lagosta', preco: 240 },
      { nome: 'Moqueca de lagosta e camarão VG', preco: 250 },
    ],
  },
  {
    titulo: 'Massas & Risotos',
    itens: [
      { nome: 'Penne ao molho pomodoro', preco: 45, desc: 'Al dente, com molho de tomate fresco, ervas e temperos' },
      { nome: 'Risoto com alho-poró', preco: 64, desc: 'Cremoso e aromático, finalizado com parmesão' },
      { nome: 'Berinjela à parmegiana', preco: 58, desc: 'Molho de tomate artesanal e queijo gratinado' },
    ],
  },
  {
    titulo: 'Da Terra',
    itens: [
      { nome: 'Carne de sol de filé', preco: 79, desc: 'Iguaria nordestina feita com filé-mignon, com farofa de farinha fina e vinagrete' },
      { nome: 'Filé à parmegiana', preco: 79, desc: 'Lâmina de filé empanada e crocante, pomodoro fresco e queijo gratinado' },
      { nome: 'Filé Matapoã com purê leve', preco: 78, desc: 'Molho feito com o fundo da própria carne, tomate confit e purê leve' },
      { nome: 'Filé Shi-Shi com massa especial', preco: 83, desc: 'Molho exclusivo de shiitake e shimeji, com creme e especiarias' },
    ],
  },
  {
    titulo: 'Na Brasa',
    itens: [
      { nome: 'Picanha CaraPreta 250 g', preco: 179, consulta: true, desc: 'Farofa amanteigada, cebola caramelizada, vinagrete e guarnição à escolha' },
      { nome: 'Picanha do Sertão na chapa 250 g', preco: 80, consulta: true, desc: 'Picanha de novilho do sertão, farofa amanteigada, cebola caramelizada e vinagrete' },
    ],
  },
  {
    titulo: 'Kids',
    itens: [{ nome: 'Prato Kids', preco: 54, desc: 'Carne ou frango grelhados, com duas guarnições à escolha' }],
  },
  {
    titulo: 'Sobremesas',
    itens: [
      { nome: 'Petit gâteau de chocolate com sorvete de creme', preco: 28 },
      { nome: 'Banana flambada no Licor 43 com sorvete', preco: 28 },
      { nome: 'Folhado de creme com geleia de morango', preco: 28 },
      { nome: 'Suspiro de Aracaju', preco: 22 },
      { nome: 'Minipudim', preco: 19 },
    ],
  },
];

export const BAR: SecaoCardapio[] = [
  {
    titulo: 'Drinks',
    itens: [
      { nome: 'Aperol Prainha', preco: 35 },
      { nome: 'Prainha Sunset', preco: 31 },
      { nome: 'Prainha Mule', preco: 31 },
      { nome: 'Prainha GT', preco: 32 },
      { nome: 'Negroni', preco: 32 },
      { nome: 'Moscow Mule', preco: 30 },
      { nome: 'Mojito', preco: 28 },
      { nome: 'Margarita', preco: 28 },
    ],
  },
  {
    titulo: 'Chopp',
    itens: [
      { nome: 'Chopp Brahma', preco: 14 },
      { nome: 'Chopp Heineken', preco: 14 },
    ],
  },
  {
    titulo: 'Cervejas',
    itens: [
      { nome: 'Heineken long neck', preco: 16 },
      { nome: 'Corona Extra', preco: 16 },
      { nome: 'Stella Artois', preco: 16 },
      { nome: 'Budweiser', preco: 14 },
      { nome: 'Baden Baden 600 ml', preco: 26 },
      { nome: 'Heineken 0.0', preco: 15 },
    ],
  },
  {
    titulo: 'Sem Álcool',
    itens: [
      { nome: 'Água de coco', preco: 10 },
      { nome: 'Jarra de água de coco', preco: 19 },
      { nome: 'Refrigerante lata', preco: 10 },
      { nome: 'Soda italiana', preco: 26 },
      { nome: 'Red Bull', preco: 23 },
    ],
  },
  {
    titulo: 'Cafés',
    itens: [
      { nome: 'Expresso', preco: 9 },
      { nome: 'Cappuccino italiano', preco: 16 },
      { nome: 'Affogato especial', preco: 22 },
      { nome: 'Irish coffee', preco: 35 },
    ],
  },
];
