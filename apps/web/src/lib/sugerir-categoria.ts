// Sugere categoria_compras pra um produto baseado em palavras-chave no nome.
// Retorna null se nao bater com nenhuma regra.
//
// As regras sao ordenadas por especificidade — destilados antes de bebidas
// genericas pra evitar 'aperol' ser pego como 'bebida' generica.

const REGRAS: Array<{ categoria: string; padroes: RegExp[] }> = [
  // Bebidas - Destilados (alta especificidade)
  {
    categoria: 'Bebidas - Destilados',
    padroes: [
      /\b(vodka|whisky|whiskey|gin|cachaca|cachaça|tequila|rum|run|conhaque|absinto)\b/i,
      /\b(aperol|cointreau|campari|jagermeister|jager|fernet|baileys|amarula)\b/i,
      /\b(martini|sake|vermouth|licor|destilad|cachaça)\b/i,
      /\b(ypioca|ypióca|smirnoff|absolut|johnnie\s*walker|jack\s*daniel|chivas|paragon)\b/i,
    ],
  },
  // Bebidas - Vinhos
  {
    categoria: 'Bebidas - Vinhos',
    padroes: [
      /\b(vinho|wine|chianti|merlot|cabernet|carmenere|malbec|sauvignon|chardonnay|prosecco|espumante|champagne|champanhe)\b/i,
    ],
  },
  // Bebidas - Cervejas
  {
    categoria: 'Bebidas - Cervejas',
    padroes: [
      /\b(cerveja|beer|chopp|chope|ipa|pilsen|pilsner|lager|stout|porter|weiss|witbier|witibier|gold)\b/i,
      /\b(heineken|brahma|skol|antarctica|antartica|amstel|stella|stella\s*artois|original|bohemia|corona|budweiser|sol|baden|colorado|eisenbahn|kaiser|spaten)\b/i,
    ],
  },
  // Bebidas - Refrigerantes (e aguas/tonicas)
  {
    categoria: 'Bebidas - Refrigerantes',
    padroes: [
      /\b(coca[\s-]*cola|guarana|guaraná|sprite|fanta|schweppes|tonica|tônica|pepsi|antartica|kuat|soda|refrigerante)\b/i,
      /\b(agua|água|aqua|acqua|h2o|cristal|minalba|prata|perrier|schin)\b.*\b(mineral|com\s*gas|sem\s*gas|tonic)/i,
      /\bagua\s+mineral\b|\bagua\s+tonica\b|\bagua\s+com\s*gas\b|\bagua\s+sem\s*gas\b/i,
    ],
  },
  // Proteína (carnes, peixes)
  {
    categoria: 'Proteína',
    padroes: [
      /\b(carne|frango|peixe|salmao|salmão|tilapia|atum|polvo|lula|camarao|camarão|lagosta|siri|caranguejo)\b/i,
      /\b(picanha|costela|costelinha|alcatra|file|filé|maminha|fraldinha|bife|chuleta|patinho|coxao)\b/i,
      /\b(linguica|linguiça|salsicha|presunto|bacon|peito|coxa|sobrecoxa|asa|moela|figado|fígado|pe\s+de\s+galinha)\b/i,
      /\b(porco|suino|suína|cordeiro|carneiro|cabrito|charque|defumad)\b/i,
    ],
  },
  // Refrigeração (laticinios + frios + congelados)
  {
    categoria: 'Refrigeração',
    padroes: [
      /\b(manteiga|queijo|mussarela|requeijao|requeijão|creme\s+de\s+leite|iogurte|nata|coalho)\b/i,
      /\b(leite\b(?!\s+condensado|\s+em\s+po))/i, // leite liquido (exclui leite condensado/em po)
      /\b(mortadela|salame|peito\s*peru|catupiry|cream\s*cheese|gorgonzola|parmesao|parmesão|provolone)\b/i,
      /\b(margarina|maionese|shoyu|alcaparra)\b/i,
      /\bbatata\s+palito\b|\bbatata\s+frita\b|\bbatata\s+congelada\b/i,
    ],
  },
  // Confeitaria (doce, pão, sorvete)
  {
    categoria: 'Confeitaria',
    padroes: [
      /\b(chocolate|cacau|achocolatado|nutella|brigadeiro|bombom|trufa|doce\s+de\s+leite)\b/i,
      /\b(pao|pão|bolo|biscoito|cookie|torta|sobremesa|pudim|mousse|gelatina)\b/i,
      /\b(sorvete|gelado|picole|picolé|paleta|sundae)\b/i,
      /\b(acucar|açúcar|adocante|adoçante|stevia|mel|melaco|melaço|xarope|calda)\b/i,
      /\b(fermento|farinha|polvilho|maizena|amido|amendoa|amêndoa|castanha)\b/i,
      /\b(polpa|geleia|frutas\s*vermelhas|cereja|amora|morango)\b/i,
      /\b(leite\s+condensado|leite\s+em\s+po|leite\s+em\s+pó|leite\s+ninho|nestl[eé])\b/i,
      /\b(massa\s*folhada|massa\s*negra|massa\s*nero|brioche|ciabata|baguete|fondue|fondie|sicao|sicão|callebaut|moniere)\b/i,
    ],
  },
  // Hortifruti
  {
    categoria: 'Hortifruti',
    padroes: [
      /\b(tomate|cebola|alface|alho|cenoura|batata\s+inglesa|batata\s+bolinha|banana|maca|maçã|laranja|limao|limão)\b/i,
      /\b(brocolis|brócolis|abobrinha|abóbora|repolho|pimentao|pimentão|pepino|berinjela|chuchu)\b/i,
      /\b(coentro|salsa|cebolinha|alho\s*poro|alho\s*porró|hortela|hortelã|tomilho|alecrim|manjericao|manjericão|sálvia)\b/i,
      /\b(shitake|shiitake|shimeji|funghi|cogumel)\b/i,
      /\b(manga|mangaba|maracuja|maracujá|abacaxi|melao|melão|melancia|uva|pera|kiwi|abacate)\b/i,
    ],
  },
  // Estoque seco
  {
    categoria: 'Estoque seco',
    padroes: [
      /\b(arroz|feijao|feijão|macarrao|macarrão|massa|espaguete|penne|talharim|bifum|nhoque)\b/i,
      /\b(oleo|óleo|azeite|vinagre|molho|tempero|sal|pimenta|paprica|páprica|lemon\s*pepper|curry|cominho)\b/i,
      /\b(cafe|café|cha|chá|erva\s*mate|capsula)\b/i,
      /\b(tapioca|farofa|granola|aveia|quinoa|chia|linhaca|linhaça)\b/i,
      /\b(fumaca|fumaça|gergelim|noz|nozes|damasco|amendoa\s*seca)\b/i,
      /\b(papel\s+aluminio|papel\s+alumínio)\b/i,
      /\b(grao|grão|cereal|farelo|farinhada|trigo|cevada|aveia|centeio)\b/i,
    ],
  },
  // Limpeza
  {
    categoria: 'Limpeza',
    padroes: [
      /\b(detergente|sabao|sabão|sabonete|amaciante|alvejante|desinfetante|alcool|álcool|cloro|agua\s+sanitaria|sanit[aá]ria)\b/i,
      /\b(bucha|esponja|pano|vassoura|rodo|balde|tapete)\b/i,
      /\b(luva|fibraco|fibraço|fibra)\b/i,
      /\b(papel\s+higienico|papel\s+higiênico|papel\s+toalha|guardanapo|fralda)\b/i,
    ],
  },
  // Utensílios
  {
    categoria: 'Utensílios',
    padroes: [
      /\b(saco|sacola|filme|plastico|plástico|pote|potinho|copo\s+descartavel|copinho)\b/i,
      /\b(espatula|espátula|fouet|escumadeira|colher|garfo|faca|tabua|tábua)\b/i,
      /\b(forma|tijela|panela|frigideira|caçarola|peneira|funil|abridor)\b/i,
      /\b(espeto|palito|canudo|porcionamento)\b/i,
    ],
  },
];

export function sugerirCategoria(nome: string | null | undefined): string | null {
  if (!nome) return null;
  const lower = nome.toLowerCase();
  for (const r of REGRAS) {
    for (const p of r.padroes) {
      if (p.test(lower)) return r.categoria;
    }
  }
  return null;
}

export const CATEGORIAS_DISPONIVEIS = [
  'Confeitaria',
  'Estoque seco',
  'Hortifruti',
  'Limpeza',
  'Proteína',
  'Refrigeração',
  'Utensílios',
  'Bebidas - Refrigerantes',
  'Bebidas - Cervejas',
  'Bebidas - Destilados',
  'Bebidas - Vinhos',
];
