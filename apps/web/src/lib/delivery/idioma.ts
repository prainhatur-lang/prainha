// Idiomas do delivery público (/delivery/[slug]?lang=xx). O site prainhabar.com
// manda o turista pra cá com ?lang=en|es|fr|it; sem o parâmetro tudo fica em
// português, exatamente como era. Os textos fixos da tela estão aqui; os do
// cardápio (prato, descrição, pergunta, opção) vêm da tabela traducao_texto,
// via @/lib/traduzir-cardapio, só no servidor.
//
// Sem import de banco: este arquivo vai também pro navegador.

export const IDIOMAS_DELIVERY = ['pt', 'en', 'es', 'fr', 'it'] as const;
export type IdiomaDelivery = (typeof IDIOMAS_DELIVERY)[number];

/** "es", "ES", "es-AR" → "es"; vazio ou desconhecido → "pt". */
export function idiomaDe(v: unknown): IdiomaDelivery {
  const s = String(Array.isArray(v) ? v[0] : (v ?? '')).slice(0, 2).toLowerCase();
  return (IDIOMAS_DELIVERY as readonly string[]).includes(s) ? (s as IdiomaDelivery) : 'pt';
}

export const NOME_IDIOMA: Record<IdiomaDelivery, string> = {
  pt: 'Português',
  en: 'English',
  es: 'Español',
  fr: 'Français',
  it: 'Italiano',
};

export interface TextosDelivery {
  voltarCardapio: string;
  suaSacola: string;
  sacolaVazia: string;
  menos: string;
  mais: string;
  cupomPromocional: string;
  cupomEx: string;
  aplicar: string;
  comoReceber: string;
  entrega: string;
  retirar: string;
  cep: string;
  buscando: string;
  numero: string;
  rua: string;
  bairro: string;
  complemento: string;
  complementoEx: string;
  referencia: string;
  referenciaEx: string;
  calculandoTaxa: string;
  entregaGratis: string;
  taxaEntrega: string;
  quandoEntregar: string;
  quandoRetirar: string;
  oQuantoAntes: string;
  fechadoAgende: string;
  agendar: string;
  semHorarios: string;
  escolhaDia: string;
  seusDados: string;
  cpf: string;
  soNumeros: string;
  procurando: string;
  cpfDica: string;
  nome: string;
  whatsapp: string;
  observacaoPedido: string;
  obsEx: string;
  pagamento: string;
  pagamentoOnline: string;
  pix: string;
  cartao: string;
  naEntrega: string;
  notaNaEntrega: string;
  notaOnline: string;
  subtotal: string;
  cupom: string;
  entregaResumo: string;
  gratisResumo: string;
  total: string;
  enviando: string;
  pedirPix: string;
  pedirCartao: string;
  voltarSite: string;
  pausado: string;
  aberto: string;
  fechado: string;
  buscar: string;
  destaques: string;
  nadaEncontrado: string;
  emMontagem: string;
  esgotado: string;
  duvidas: string;
  chamaZap: string;
  opcional: string;
  gratisOpcao: string;
  algumaObs: string;
  obsItemEx: string;
  adicionar: string;
  erroSacolaVazia: string;
  informeNome: string;
  informeZap: string;
  preenchaEndereco: string;
  foraArea: string;
  escolhaDiaHora: string;
  falhaConexao: string;
  cupomFalha: string;
  gratisPrimeira: string;
  hoje: string;
  amanha: string;
  idioma: string;
  traducaoPendente: string;
  /** Domingo primeiro, como Date.getDay(). */
  dias: readonly string[];
  achamos: (nome: string) => string;
  minimoFalta: (minimo: string, falta: string) => string;
  minimoErro: (minimo: string) => string;
  verSacola: (qtd: number, valor: string) => string;
  gratisAcima: (valor: string) => string;
  gratisKm: (km: number | string) => string;
  obrigatorio: (min: number, max: number) => string;
  /** Mensagem pronta do WhatsApp da página do delivery. */
  assuntoZap: string;
}

const pt: TextosDelivery = {
  voltarCardapio: '◂ Voltar pro cardápio',
  suaSacola: 'Sua sacola',
  sacolaVazia: 'Sacola vazia.',
  menos: 'menos',
  mais: 'mais',
  cupomPromocional: 'Cupom promocional',
  cupomEx: 'Ex: PRAINHA10',
  aplicar: 'Aplicar',
  comoReceber: 'Como você quer receber?',
  entrega: '🛵 Entrega',
  retirar: '🏖️ Retirar no balcão',
  cep: 'CEP',
  buscando: '(buscando…)',
  numero: 'Número',
  rua: 'Rua',
  bairro: 'Bairro',
  complemento: 'Complemento',
  complementoEx: 'Apto, bloco…',
  referencia: 'Ponto de referência',
  referenciaEx: 'Ex: portão azul',
  calculandoTaxa: 'Calculando a taxa de entrega…',
  entregaGratis: 'Entrega grátis',
  taxaEntrega: 'Taxa de entrega:',
  quandoEntregar: 'Quando entregar?',
  quandoRetirar: 'Quando retirar?',
  oQuantoAntes: '⚡ O quanto antes',
  fechadoAgende: 'Estamos fechados agora — agende seu pedido pra um horário aberto. 👇',
  agendar: '📅 Agendar dia e hora',
  semHorarios: 'Sem horários nesse dia.',
  escolhaDia: 'Escolha um dia acima.',
  seusDados: 'Seus dados',
  cpf: 'CPF',
  soNumeros: 'Só os números',
  procurando: 'Procurando seu cadastro…',
  cpfDica: 'Com o CPF a gente já reconhece você e preenche o resto.',
  nome: 'Nome',
  whatsapp: 'WhatsApp',
  observacaoPedido: 'Observação do pedido',
  obsEx: 'Ex: tirar a cebola',
  pagamento: 'Pagamento',
  pagamentoOnline: 'Pagamento — 100% online e seguro',
  pix: '⚡ Pix',
  cartao: '💳 Cartão',
  naEntrega: '🛵 Na entrega',
  notaNaEntrega:
    'Você paga na porta: cartão ou Pix na maquininha do entregador, ou dinheiro. O pedido já vai pra cozinha.',
  notaOnline: 'O pedido só vai pra cozinha depois do pagamento aprovado.',
  subtotal: 'Subtotal',
  cupom: 'Cupom',
  entregaResumo: 'Entrega',
  gratisResumo: 'Grátis 🎉',
  total: 'Total',
  enviando: 'Enviando…',
  pedirPix: 'Fazer pedido e pagar com Pix',
  pedirCartao: 'Fazer pedido e pagar com cartão',
  voltarSite: '◂ VOLTAR AO SITE',
  pausado: '⏸ Pausado agora — volte já já',
  aberto: '● Aberto — pedindo agora',
  fechado: '🌙 Fechado agora — agende seu pedido',
  buscar: '🔎 Buscar no cardápio…',
  destaques: '⭐ Destaques',
  nadaEncontrado: 'Nada encontrado com essa busca.',
  emMontagem: 'Cardápio em montagem — volte logo!',
  esgotado: 'Esgotado',
  duvidas: 'Dúvidas?',
  chamaZap: 'Chama no WhatsApp',
  opcional: 'opcional',
  gratisOpcao: 'grátis',
  algumaObs: 'Alguma observação?',
  obsItemEx: 'Ex: sem cebola',
  adicionar: 'Adicionar ·',
  erroSacolaVazia: 'Sua sacola está vazia.',
  informeNome: 'Informe seu nome.',
  informeZap: 'Informe seu WhatsApp com DDD.',
  preenchaEndereco: 'Preencha o endereço de entrega (rua, número e bairro).',
  foraArea: 'Endereço fora da área de entrega.',
  escolhaDiaHora: 'Escolha o dia e o horário.',
  falhaConexao: 'Falha de conexão — tente de novo.',
  cupomFalha: 'Não consegui validar o cupom agora.',
  gratisPrimeira: '🎉 Entrega grátis na 1ª compra',
  hoje: 'Hoje',
  amanha: 'Amanhã',
  idioma: 'Idioma',
  traducaoPendente: 'Alguns pratos ainda aparecem em português — a tradução está a caminho.',
  dias: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'],
  achamos: (n) => `Achamos seu cadastro, ${n}! Confira os dados abaixo.`,
  minimoFalta: (min, falta) => `Pedido mínimo de ${min} — falta ${falta}.`,
  minimoErro: (min) => `Pedido mínimo de ${min} (sem contar a entrega).`,
  verSacola: (q, v) => `Ver sacola (${q}) · ${v}`,
  gratisAcima: (v) => `🛵 Entrega grátis acima de ${v}`,
  gratisKm: (km) => `📍 Entrega grátis até ${km} km`,
  obrigatorio: (min, max) => `obrigatório · escolha ${min}${max > min ? ` a ${max}` : ''}`,
  assuntoZap: 'Tenho uma dúvida sobre o delivery.',
};

const en: TextosDelivery = {
  voltarCardapio: '◂ Back to the menu',
  suaSacola: 'Your bag',
  sacolaVazia: 'Your bag is empty.',
  menos: 'decrease',
  mais: 'increase',
  cupomPromocional: 'Promo code',
  cupomEx: 'E.g. PRAINHA10',
  aplicar: 'Apply',
  comoReceber: 'How would you like to get it?',
  entrega: '🛵 Delivery',
  retirar: '🏖️ Pick up at the counter',
  cep: 'CEP (postal code)',
  buscando: '(searching…)',
  numero: 'Number',
  rua: 'Street',
  bairro: 'Neighborhood',
  complemento: 'Apt / unit',
  complementoEx: 'Apt, block…',
  referencia: 'Landmark',
  referenciaEx: 'E.g. blue gate',
  calculandoTaxa: 'Calculating the delivery fee…',
  entregaGratis: 'Free delivery',
  taxaEntrega: 'Delivery fee:',
  quandoEntregar: 'When should we deliver?',
  quandoRetirar: 'When will you pick it up?',
  oQuantoAntes: '⚡ As soon as possible',
  fechadoAgende: "We're closed right now — schedule your order for an open time. 👇",
  agendar: '📅 Schedule day and time',
  semHorarios: 'No times available on this day.',
  escolhaDia: 'Pick a day above.',
  seusDados: 'Your details',
  cpf: 'CPF (Brazilian ID — optional)',
  soNumeros: 'Numbers only',
  procurando: 'Looking up your details…',
  cpfDica: 'Brazilian? With your CPF we recognize you and fill in the rest.',
  nome: 'Name',
  whatsapp: 'WhatsApp',
  observacaoPedido: 'Order notes',
  obsEx: 'E.g. no onions',
  pagamento: 'Payment',
  pagamentoOnline: 'Payment — 100% online and secure',
  pix: '⚡ Pix',
  cartao: '💳 Card',
  naEntrega: '🛵 On delivery',
  notaNaEntrega:
    "You pay at the door: card or Pix on the courier's card machine, or cash. Your order goes straight to the kitchen.",
  notaOnline: 'Your order goes to the kitchen only after the payment is approved.',
  subtotal: 'Subtotal',
  cupom: 'Coupon',
  entregaResumo: 'Delivery',
  gratisResumo: 'Free 🎉',
  total: 'Total',
  enviando: 'Sending…',
  pedirPix: 'Place order and pay with Pix',
  pedirCartao: 'Place order and pay by card',
  voltarSite: '◂ BACK TO THE WEBSITE',
  pausado: '⏸ Paused right now — back soon',
  aberto: '● Open — ordering now',
  fechado: '🌙 Closed now — schedule your order',
  buscar: '🔎 Search the menu…',
  destaques: '⭐ Highlights',
  nadaEncontrado: 'Nothing found for that search.',
  emMontagem: 'Menu coming soon — check back shortly!',
  esgotado: 'Sold out',
  duvidas: 'Questions?',
  chamaZap: 'Message us on WhatsApp',
  opcional: 'optional',
  gratisOpcao: 'free',
  algumaObs: 'Any notes?',
  obsItemEx: 'E.g. no onions',
  adicionar: 'Add ·',
  erroSacolaVazia: 'Your bag is empty.',
  informeNome: 'Enter your name.',
  informeZap: 'Enter your WhatsApp number with area code.',
  preenchaEndereco: 'Fill in the delivery address (street, number and neighborhood).',
  foraArea: 'Address outside the delivery area.',
  escolhaDiaHora: 'Choose the day and time.',
  falhaConexao: 'Connection failed — please try again.',
  cupomFalha: "Couldn't validate the coupon right now.",
  gratisPrimeira: '🎉 Free delivery on your first order',
  hoje: 'Today',
  amanha: 'Tomorrow',
  idioma: 'Language',
  traducaoPendente: 'Some dishes still show in Portuguese — the translation is on its way.',
  dias: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  achamos: (n) => `We found you, ${n}! Please check the details below.`,
  minimoFalta: (min, falta) => `Minimum order ${min} — ${falta} to go.`,
  minimoErro: (min) => `Minimum order of ${min} (not counting delivery).`,
  verSacola: (q, v) => `View bag (${q}) · ${v}`,
  gratisAcima: (v) => `🛵 Free delivery over ${v}`,
  gratisKm: (km) => `📍 Free delivery within ${km} km`,
  obrigatorio: (min, max) => `required · choose ${min}${max > min ? ` to ${max}` : ''}`,
  assuntoZap: 'I have a question about delivery.',
};

const es: TextosDelivery = {
  voltarCardapio: '◂ Volver al menú',
  suaSacola: 'Tu carrito',
  sacolaVazia: 'El carrito está vacío.',
  menos: 'menos',
  mais: 'más',
  cupomPromocional: 'Cupón promocional',
  cupomEx: 'Ej: PRAINHA10',
  aplicar: 'Aplicar',
  comoReceber: '¿Cómo quieres recibirlo?',
  entrega: '🛵 Entrega a domicilio',
  retirar: '🏖️ Retirar en el mostrador',
  cep: 'CEP (código postal)',
  buscando: '(buscando…)',
  numero: 'Número',
  rua: 'Calle',
  bairro: 'Barrio',
  complemento: 'Complemento',
  complementoEx: 'Depto., bloque…',
  referencia: 'Punto de referencia',
  referenciaEx: 'Ej: portón azul',
  calculandoTaxa: 'Calculando el costo de envío…',
  entregaGratis: 'Envío gratis',
  taxaEntrega: 'Costo de envío:',
  quandoEntregar: '¿Cuándo lo entregamos?',
  quandoRetirar: '¿Cuándo lo retiras?',
  oQuantoAntes: '⚡ Lo antes posible',
  fechadoAgende: 'Estamos cerrados ahora — programa tu pedido para un horario abierto. 👇',
  agendar: '📅 Programar día y hora',
  semHorarios: 'No hay horarios ese día.',
  escolhaDia: 'Elige un día arriba.',
  seusDados: 'Tus datos',
  cpf: 'CPF (documento brasileño — opcional)',
  soNumeros: 'Solo números',
  procurando: 'Buscando tu registro…',
  cpfDica: '¿Eres brasileño? Con el CPF te reconocemos y completamos el resto.',
  nome: 'Nombre',
  whatsapp: 'WhatsApp',
  observacaoPedido: 'Observación del pedido',
  obsEx: 'Ej: sin cebolla',
  pagamento: 'Pago',
  pagamentoOnline: 'Pago — 100% en línea y seguro',
  pix: '⚡ Pix',
  cartao: '💳 Tarjeta',
  naEntrega: '🛵 Al recibir',
  notaNaEntrega:
    'Pagas en la puerta: tarjeta o Pix en la maquinita del repartidor, o en efectivo. El pedido va directo a la cocina.',
  notaOnline: 'El pedido va a la cocina solo después de aprobado el pago.',
  subtotal: 'Subtotal',
  cupom: 'Cupón',
  entregaResumo: 'Envío',
  gratisResumo: 'Gratis 🎉',
  total: 'Total',
  enviando: 'Enviando…',
  pedirPix: 'Hacer el pedido y pagar con Pix',
  pedirCartao: 'Hacer el pedido y pagar con tarjeta',
  voltarSite: '◂ VOLVER AL SITIO',
  pausado: '⏸ En pausa — volvemos enseguida',
  aberto: '● Abierto — pide ahora',
  fechado: '🌙 Cerrado ahora — programa tu pedido',
  buscar: '🔎 Buscar en el menú…',
  destaques: '⭐ Destacados',
  nadaEncontrado: 'No encontramos nada con esa búsqueda.',
  emMontagem: 'Menú en preparación — ¡vuelve pronto!',
  esgotado: 'Agotado',
  duvidas: '¿Dudas?',
  chamaZap: 'Escríbenos por WhatsApp',
  opcional: 'opcional',
  gratisOpcao: 'gratis',
  algumaObs: '¿Alguna observación?',
  obsItemEx: 'Ej: sin cebolla',
  adicionar: 'Agregar ·',
  erroSacolaVazia: 'Tu carrito está vacío.',
  informeNome: 'Escribe tu nombre.',
  informeZap: 'Escribe tu WhatsApp con código de área.',
  preenchaEndereco: 'Completa la dirección de entrega (calle, número y barrio).',
  foraArea: 'Dirección fuera del área de entrega.',
  escolhaDiaHora: 'Elige el día y el horario.',
  falhaConexao: 'Falla de conexión — inténtalo de nuevo.',
  cupomFalha: 'No pude validar el cupón ahora.',
  gratisPrimeira: '🎉 Envío gratis en tu primera compra',
  hoje: 'Hoy',
  amanha: 'Mañana',
  idioma: 'Idioma',
  traducaoPendente: 'Algunos platos aún aparecen en portugués — la traducción está en camino.',
  dias: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
  achamos: (n) => `¡Te encontramos, ${n}! Revisa los datos abajo.`,
  minimoFalta: (min, falta) => `Pedido mínimo de ${min} — faltan ${falta}.`,
  minimoErro: (min) => `Pedido mínimo de ${min} (sin contar el envío).`,
  verSacola: (q, v) => `Ver carrito (${q}) · ${v}`,
  gratisAcima: (v) => `🛵 Envío gratis por encima de ${v}`,
  gratisKm: (km) => `📍 Envío gratis hasta ${km} km`,
  obrigatorio: (min, max) => (max > min ? `obligatorio · elige de ${min} a ${max}` : `obligatorio · elige ${min}`),
  assuntoZap: 'Tengo una duda sobre el delivery.',
};

const fr: TextosDelivery = {
  voltarCardapio: '◂ Retour à la carte',
  suaSacola: 'Votre panier',
  sacolaVazia: 'Panier vide.',
  menos: 'moins',
  mais: 'plus',
  cupomPromocional: 'Code promo',
  cupomEx: 'Ex : PRAINHA10',
  aplicar: 'Appliquer',
  comoReceber: 'Comment souhaitez-vous le recevoir ?',
  entrega: '🛵 Livraison',
  retirar: '🏖️ À emporter au comptoir',
  cep: 'CEP (code postal)',
  buscando: '(recherche…)',
  numero: 'Numéro',
  rua: 'Rue',
  bairro: 'Quartier',
  complemento: "Complément d'adresse",
  complementoEx: 'Appt, bâtiment…',
  referencia: 'Point de repère',
  referenciaEx: 'Ex : portail bleu',
  calculandoTaxa: 'Calcul des frais de livraison…',
  entregaGratis: 'Livraison offerte',
  taxaEntrega: 'Frais de livraison :',
  quandoEntregar: 'Quand livrer ?',
  quandoRetirar: 'Quand passer le récupérer ?',
  oQuantoAntes: '⚡ Dès que possible',
  fechadoAgende: 'Nous sommes fermés en ce moment — programmez votre commande sur un créneau ouvert. 👇',
  agendar: "📅 Choisir le jour et l'heure",
  semHorarios: 'Aucun créneau ce jour-là.',
  escolhaDia: 'Choisissez un jour ci-dessus.',
  seusDados: 'Vos coordonnées',
  cpf: "CPF (pièce d'identité brésilienne — facultatif)",
  soNumeros: 'Chiffres uniquement',
  procurando: 'Recherche de votre fiche…',
  cpfDica: 'Brésilien ? Avec votre CPF, on vous reconnaît et on remplit le reste.',
  nome: 'Nom',
  whatsapp: 'WhatsApp',
  observacaoPedido: 'Remarque sur la commande',
  obsEx: 'Ex : sans oignon',
  pagamento: 'Paiement',
  pagamentoOnline: 'Paiement — 100 % en ligne et sécurisé',
  pix: '⚡ Pix',
  cartao: '💳 Carte',
  naEntrega: '🛵 À la livraison',
  notaNaEntrega:
    'Vous payez à la porte : carte ou Pix sur le terminal du livreur, ou en espèces. La commande part tout de suite en cuisine.',
  notaOnline: "La commande ne part en cuisine qu'après la validation du paiement.",
  subtotal: 'Sous-total',
  cupom: 'Code promo',
  entregaResumo: 'Livraison',
  gratisResumo: 'Offerte 🎉',
  total: 'Total',
  enviando: 'Envoi…',
  pedirPix: 'Commander et payer par Pix',
  pedirCartao: 'Commander et payer par carte',
  voltarSite: '◂ RETOUR AU SITE',
  pausado: '⏸ En pause — de retour très vite',
  aberto: '● Ouvert — commandez maintenant',
  fechado: '🌙 Fermé pour le moment — programmez votre commande',
  buscar: '🔎 Rechercher dans la carte…',
  destaques: '⭐ Coups de cœur',
  nadaEncontrado: 'Aucun résultat pour cette recherche.',
  emMontagem: 'Carte en préparation — revenez bientôt !',
  esgotado: 'Épuisé',
  duvidas: 'Des questions ?',
  chamaZap: 'Écrivez-nous sur WhatsApp',
  opcional: 'facultatif',
  gratisOpcao: 'offert',
  algumaObs: 'Une remarque ?',
  obsItemEx: 'Ex : sans oignon',
  adicionar: 'Ajouter ·',
  erroSacolaVazia: 'Votre panier est vide.',
  informeNome: 'Indiquez votre nom.',
  informeZap: "Indiquez votre WhatsApp avec l'indicatif.",
  preenchaEndereco: "Complétez l'adresse de livraison (rue, numéro et quartier).",
  foraArea: 'Adresse hors de la zone de livraison.',
  escolhaDiaHora: "Choisissez le jour et l'heure.",
  falhaConexao: 'Échec de connexion — réessayez.',
  cupomFalha: 'Impossible de valider le code promo pour le moment.',
  gratisPrimeira: '🎉 Livraison offerte pour la 1re commande',
  hoje: "Aujourd'hui",
  amanha: 'Demain',
  idioma: 'Langue',
  traducaoPendente: 'Certains plats sont encore en portugais — la traduction arrive.',
  dias: ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'],
  achamos: (n) => `Nous vous avons trouvé, ${n} ! Vérifiez les informations ci-dessous.`,
  minimoFalta: (min, falta) => `Commande minimum de ${min} — il manque ${falta}.`,
  minimoErro: (min) => `Commande minimum de ${min} (hors livraison).`,
  verSacola: (q, v) => `Voir le panier (${q}) · ${v}`,
  gratisAcima: (v) => `🛵 Livraison offerte dès ${v}`,
  gratisKm: (km) => `📍 Livraison offerte jusqu'à ${km} km`,
  obrigatorio: (min, max) =>
    max > min ? `obligatoire · choisissez de ${min} à ${max}` : `obligatoire · choisissez ${min}`,
  assuntoZap: "J'ai une question sur la livraison.",
};

const it: TextosDelivery = {
  voltarCardapio: '◂ Torna al menù',
  suaSacola: 'Il tuo carrello',
  sacolaVazia: 'Carrello vuoto.',
  menos: 'meno',
  mais: 'più',
  cupomPromocional: 'Codice sconto',
  cupomEx: 'Es: PRAINHA10',
  aplicar: 'Applica',
  comoReceber: 'Come vuoi riceverlo?',
  entrega: '🛵 Consegna',
  retirar: '🏖️ Ritiro al banco',
  cep: 'CEP (codice postale)',
  buscando: '(ricerca…)',
  numero: 'Numero civico',
  rua: 'Via',
  bairro: 'Quartiere',
  complemento: 'Interno',
  complementoEx: 'Appartamento, scala…',
  referencia: 'Punto di riferimento',
  referenciaEx: 'Es: cancello blu',
  calculandoTaxa: 'Calcolo della tariffa di consegna…',
  entregaGratis: 'Consegna gratuita',
  taxaEntrega: 'Tariffa di consegna:',
  quandoEntregar: 'Quando consegnare?',
  quandoRetirar: 'Quando ritiri?',
  oQuantoAntes: '⚡ Il prima possibile',
  fechadoAgende: 'Ora siamo chiusi — programma il tuo ordine per un orario di apertura. 👇',
  agendar: '📅 Scegli giorno e ora',
  semHorarios: 'Nessun orario disponibile in questo giorno.',
  escolhaDia: 'Scegli un giorno qui sopra.',
  seusDados: 'I tuoi dati',
  cpf: 'CPF (documento brasiliano — facoltativo)',
  soNumeros: 'Solo numeri',
  procurando: 'Cerchiamo i tuoi dati…',
  cpfDica: 'Sei brasiliano? Con il CPF ti riconosciamo e compiliamo il resto.',
  nome: 'Nome',
  whatsapp: 'WhatsApp',
  observacaoPedido: "Note sull'ordine",
  obsEx: 'Es: senza cipolla',
  pagamento: 'Pagamento',
  pagamentoOnline: 'Pagamento — 100% online e sicuro',
  pix: '⚡ Pix',
  cartao: '💳 Carta',
  naEntrega: '🛵 Alla consegna',
  notaNaEntrega:
    "Paghi alla porta: carta o Pix sul POS del fattorino, oppure in contanti. L'ordine va subito in cucina.",
  notaOnline: "L'ordine va in cucina solo dopo l'approvazione del pagamento.",
  subtotal: 'Subtotale',
  cupom: 'Codice sconto',
  entregaResumo: 'Consegna',
  gratisResumo: 'Gratis 🎉',
  total: 'Totale',
  enviando: 'Invio…',
  pedirPix: 'Ordina e paga con Pix',
  pedirCartao: 'Ordina e paga con carta',
  voltarSite: '◂ TORNA AL SITO',
  pausado: '⏸ In pausa — torniamo subito',
  aberto: '● Aperto — ordina adesso',
  fechado: '🌙 Chiuso ora — programma il tuo ordine',
  buscar: '🔎 Cerca nel menù…',
  destaques: '⭐ In evidenza',
  nadaEncontrado: 'Nessun risultato per questa ricerca.',
  emMontagem: 'Menù in preparazione — torna presto!',
  esgotado: 'Esaurito',
  duvidas: 'Domande?',
  chamaZap: 'Scrivici su WhatsApp',
  opcional: 'facoltativo',
  gratisOpcao: 'gratis',
  algumaObs: 'Qualche nota?',
  obsItemEx: 'Es: senza cipolla',
  adicionar: 'Aggiungi ·',
  erroSacolaVazia: 'Il carrello è vuoto.',
  informeNome: 'Inserisci il tuo nome.',
  informeZap: 'Inserisci il tuo WhatsApp con prefisso.',
  preenchaEndereco: "Compila l'indirizzo di consegna (via, numero civico e quartiere).",
  foraArea: "Indirizzo fuori dall'area di consegna.",
  escolhaDiaHora: 'Scegli giorno e orario.',
  falhaConexao: 'Connessione non riuscita — riprova.',
  cupomFalha: 'Non riesco a verificare il codice sconto adesso.',
  gratisPrimeira: '🎉 Consegna gratuita al primo ordine',
  hoje: 'Oggi',
  amanha: 'Domani',
  idioma: 'Lingua',
  traducaoPendente: 'Alcuni piatti sono ancora in portoghese — la traduzione è in arrivo.',
  dias: ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'],
  achamos: (n) => `Ti abbiamo trovato, ${n}! Controlla i dati qui sotto.`,
  minimoFalta: (min, falta) => `Ordine minimo di ${min} — mancano ${falta}.`,
  minimoErro: (min) => `Ordine minimo di ${min} (consegna esclusa).`,
  verSacola: (q, v) => `Vedi carrello (${q}) · ${v}`,
  gratisAcima: (v) => `🛵 Consegna gratuita sopra ${v}`,
  gratisKm: (km) => `📍 Consegna gratuita entro ${km} km`,
  obrigatorio: (min, max) => (max > min ? `obbligatorio · scegli da ${min} a ${max}` : `obbligatorio · scegli ${min}`),
  assuntoZap: 'Ho una domanda sulla consegna a domicilio.',
};

export const TXT_DELIVERY: Record<IdiomaDelivery, TextosDelivery> = { pt, en, es, fr, it };

// ---- Acompanhamento do pedido (/delivery/pedido/[token]?lang=xx) ----
// O cardápio já manda o cliente pra cá com o ?lang= dele. Em português os
// textos são exatamente os de antes; o rótulo de entrega grátis em português
// continua vindo do servidor (MOTIVO_FRETE_LABEL), por isso freteMotivo do pt
// fica vazio.

export interface TextosPedido {
  naoEncontrado: string;
  pixErro: string;
  falhaConexao: string;
  carregando: string;
  recebido: string;
  naCozinha: string;
  pronto: string;
  saiuEntrega: string;
  naPorta: string;
  entregue: string;
  prontoRetirada: string;
  retirado: string;
  pedido: string;
  asap: string;
  agendado: (data: string, hora: string | null) => string;
  faltaPagamento: (valor: string) => string;
  explicaPagamento: string;
  qrAlt: string;
  qrInstrucao: string;
  copiado: string;
  copiar: string;
  pagouAviso: string;
  gerandoPix: string;
  gerarPix: string;
  preferePix: string;
  prefereCartao: string;
  cancelado: string;
  estornado: string;
  novoPedido: string;
  obrigado: string;
  pagEntregaTitulo: string;
  pagEntregaResto: (valor: string) => string;
  tempoEstimado: (min: number, max: number) => string;
  resumo: string;
  subtotal: string;
  cupom: string;
  entrega: string;
  gratisSufixo: string;
  total: string;
  /** Motivo da entrega grátis (distancia, promocao, primeira_compra, cupom). */
  freteMotivo: Partial<Record<string, string>>;
  entregarEm: string;
  ref: string;
  retirarEm: string;
  balcao: string;
  obs: string;
  precisaFalar: string;
  chamaZap: string;
  zapTexto: (numero: number) => string;
}

const pedPt: TextosPedido = {
  naoEncontrado: 'Pedido não encontrado.',
  pixErro: 'Não consegui gerar o Pix agora.',
  falhaConexao: 'Falha de conexão — tente de novo.',
  carregando: 'Carregando seu pedido…',
  recebido: 'Pedido recebido',
  naCozinha: 'Na cozinha',
  pronto: 'Pronto',
  saiuEntrega: 'Saiu pra entrega',
  naPorta: 'Entregador na porta',
  entregue: 'Entregue',
  prontoRetirada: 'Pronto pra retirada',
  retirado: 'Retirado',
  pedido: 'Pedido',
  asap: 'o quanto antes',
  agendado: (d, h) => `${d} às ${h}`,
  faltaPagamento: (v) => `Falta só o pagamento — ${v}`,
  explicaPagamento:
    'Seu pedido segue pra cozinha assim que o pagamento for aprovado. Você tem até 40 minutos antes de ele expirar.',
  qrAlt: 'QR code Pix',
  qrInstrucao: 'Abra o app do seu banco, escolha Pix e escaneie — ou copie o código:',
  copiado: '✓ Código copiado!',
  copiar: 'Copiar código Pix',
  pagouAviso: 'Pagou? A confirmação aparece aqui sozinha em segundos.',
  gerandoPix: 'Gerando Pix…',
  gerarPix: 'Gerar QR code Pix',
  preferePix: 'Prefiro pagar com Pix',
  prefereCartao: 'Prefiro pagar com cartão',
  cancelado: 'Pedido cancelado',
  estornado: 'O valor pago foi estornado — pode levar alguns dias pra aparecer na fatura.',
  novoPedido: 'Fazer novo pedido',
  obrigado: ' — obrigado! 🌅',
  pagEntregaTitulo: 'Pagamento na entrega',
  pagEntregaResto: (v) => ` — ${v} no cartão ou Pix na maquininha do entregador, ou em dinheiro.`,
  tempoEstimado: (a, b) => `Tempo estimado: ${a}–${b} min.`,
  resumo: 'Resumo',
  subtotal: 'Subtotal',
  cupom: 'Cupom',
  entrega: 'Entrega',
  gratisSufixo: ' (grátis)',
  total: 'Total',
  freteMotivo: {},
  entregarEm: 'Entregar em',
  ref: 'Ref: ',
  retirarEm: 'Retirar em',
  balcao: 'No balcão da loja',
  obs: 'Obs: ',
  precisaFalar: 'Precisa falar com a gente?',
  chamaZap: 'Chama no WhatsApp',
  zapTexto: (n) => `Oi! Sobre o pedido #${n}:`,
};

const pedEn: TextosPedido = {
  naoEncontrado: 'Order not found.',
  pixErro: "Couldn't generate the Pix right now.",
  falhaConexao: 'Connection failed — please try again.',
  carregando: 'Loading your order…',
  recebido: 'Order received',
  naCozinha: 'In the kitchen',
  pronto: 'Ready',
  saiuEntrega: 'Out for delivery',
  naPorta: 'Courier at your door',
  entregue: 'Delivered',
  prontoRetirada: 'Ready for pickup',
  retirado: 'Picked up',
  pedido: 'Order',
  asap: 'as soon as possible',
  agendado: (d, h) => `${d} at ${h}`,
  faltaPagamento: (v) => `Only the payment is left — ${v}`,
  explicaPagamento:
    'Your order goes to the kitchen as soon as the payment is approved. You have up to 40 minutes before it expires.',
  qrAlt: 'Pix QR code',
  qrInstrucao: 'Open your bank app, choose Pix and scan — or copy the code:',
  copiado: '✓ Code copied!',
  copiar: 'Copy Pix code',
  pagouAviso: 'Paid? The confirmation shows up here on its own within seconds.',
  gerandoPix: 'Generating Pix…',
  gerarPix: 'Generate Pix QR code',
  preferePix: "I'd rather pay with Pix",
  prefereCartao: "I'd rather pay by card",
  cancelado: 'Order cancelled',
  estornado: 'The amount paid has been refunded — it may take a few days to show on your statement.',
  novoPedido: 'Place a new order',
  obrigado: ' — thank you! 🌅',
  pagEntregaTitulo: 'Payment on delivery',
  pagEntregaResto: (v) => ` — ${v} by card or Pix on the courier's card machine, or in cash.`,
  tempoEstimado: (a, b) => `Estimated time: ${a}–${b} min.`,
  resumo: 'Summary',
  subtotal: 'Subtotal',
  cupom: 'Coupon',
  entrega: 'Delivery',
  gratisSufixo: ' (free)',
  total: 'Total',
  freteMotivo: {
    distancia: "Free delivery — you're close to us",
    promocao: 'Free delivery — order above the promotion amount',
    primeira_compra: 'Free delivery on your first order 🎉',
    cupom: 'Free delivery with your coupon',
  },
  entregarEm: 'Deliver to',
  ref: 'Ref: ',
  retirarEm: 'Pick up at',
  balcao: 'At the restaurant counter',
  obs: 'Notes: ',
  precisaFalar: 'Need to talk to us?',
  chamaZap: 'Message us on WhatsApp',
  zapTexto: (n) => `Hi! About order #${n}:`,
};

const pedEs: TextosPedido = {
  naoEncontrado: 'Pedido no encontrado.',
  pixErro: 'No pudimos generar el Pix ahora.',
  falhaConexao: 'Falló la conexión — inténtalo de nuevo.',
  carregando: 'Cargando tu pedido…',
  recebido: 'Pedido recibido',
  naCozinha: 'En la cocina',
  pronto: 'Listo',
  saiuEntrega: 'En camino',
  naPorta: 'Repartidor en la puerta',
  entregue: 'Entregado',
  prontoRetirada: 'Listo para recoger',
  retirado: 'Recogido',
  pedido: 'Pedido',
  asap: 'lo antes posible',
  agendado: (d, h) => `${d} a las ${h}`,
  faltaPagamento: (v) => `Solo falta el pago — ${v}`,
  explicaPagamento:
    'Tu pedido pasa a la cocina en cuanto se apruebe el pago. Tienes hasta 40 minutos antes de que caduque.',
  qrAlt: 'Código QR Pix',
  qrInstrucao: 'Abre la app de tu banco, elige Pix y escanea — o copia el código:',
  copiado: '✓ ¡Código copiado!',
  copiar: 'Copiar código Pix',
  pagouAviso: '¿Ya pagaste? La confirmación aparece aquí sola en segundos.',
  gerandoPix: 'Generando Pix…',
  gerarPix: 'Generar código QR Pix',
  preferePix: 'Prefiero pagar con Pix',
  prefereCartao: 'Prefiero pagar con tarjeta',
  cancelado: 'Pedido cancelado',
  estornado: 'El importe pagado fue reembolsado — puede tardar unos días en aparecer en tu estado de cuenta.',
  novoPedido: 'Hacer un nuevo pedido',
  obrigado: ' — ¡gracias! 🌅',
  pagEntregaTitulo: 'Pago al recibir',
  pagEntregaResto: (v) => ` — ${v} con tarjeta o Pix en la máquina del repartidor, o en efectivo.`,
  tempoEstimado: (a, b) => `Tiempo estimado: ${a}–${b} min.`,
  resumo: 'Resumen',
  subtotal: 'Subtotal',
  cupom: 'Cupón',
  entrega: 'Envío',
  gratisSufixo: ' (gratis)',
  total: 'Total',
  freteMotivo: {
    distancia: 'Envío gratis — estás muy cerca de nosotros',
    promocao: 'Envío gratis — pedido por encima del valor de la promoción',
    primeira_compra: 'Envío gratis en tu primera compra 🎉',
    cupom: 'Envío gratis con tu cupón',
  },
  entregarEm: 'Entregar en',
  ref: 'Ref.: ',
  retirarEm: 'Recoger en',
  balcao: 'En el mostrador del restaurante',
  obs: 'Obs.: ',
  precisaFalar: '¿Necesitas hablar con nosotros?',
  chamaZap: 'Escríbenos por WhatsApp',
  zapTexto: (n) => `¡Hola! Sobre el pedido #${n}:`,
};

const pedFr: TextosPedido = {
  naoEncontrado: 'Commande introuvable.',
  pixErro: 'Impossible de générer le Pix pour le moment.',
  falhaConexao: 'Échec de connexion — réessayez.',
  carregando: 'Chargement de votre commande…',
  recebido: 'Commande reçue',
  naCozinha: 'En cuisine',
  pronto: 'Prête',
  saiuEntrega: 'En cours de livraison',
  naPorta: 'Livreur à votre porte',
  entregue: 'Livrée',
  prontoRetirada: 'Prête à retirer',
  retirado: 'Retirée',
  pedido: 'Commande',
  asap: 'dès que possible',
  agendado: (d, h) => `${d} à ${h}`,
  faltaPagamento: (v) => `Il ne reste que le paiement — ${v}`,
  explicaPagamento:
    'Votre commande part en cuisine dès que le paiement est approuvé. Vous avez jusqu’à 40 minutes avant son expiration.',
  qrAlt: 'QR code Pix',
  qrInstrucao: 'Ouvrez l’application de votre banque, choisissez Pix et scannez — ou copiez le code :',
  copiado: '✓ Code copié !',
  copiar: 'Copier le code Pix',
  pagouAviso: 'Payé ? La confirmation s’affiche ici toute seule en quelques secondes.',
  gerandoPix: 'Génération du Pix…',
  gerarPix: 'Générer le QR code Pix',
  preferePix: 'Je préfère payer par Pix',
  prefereCartao: 'Je préfère payer par carte',
  cancelado: 'Commande annulée',
  estornado: 'Le montant payé a été remboursé — il peut falloir quelques jours pour qu’il apparaisse sur votre relevé.',
  novoPedido: 'Passer une nouvelle commande',
  obrigado: ' — merci ! 🌅',
  pagEntregaTitulo: 'Paiement à la livraison',
  pagEntregaResto: (v) => ` — ${v} par carte ou Pix sur le terminal du livreur, ou en espèces.`,
  tempoEstimado: (a, b) => `Temps estimé : ${a}–${b} min.`,
  resumo: 'Récapitulatif',
  subtotal: 'Sous-total',
  cupom: 'Code promo',
  entrega: 'Livraison',
  gratisSufixo: ' (offerte)',
  total: 'Total',
  freteMotivo: {
    distancia: 'Livraison offerte — vous êtes tout près de chez nous',
    promocao: 'Livraison offerte — commande au-dessus du montant de la promotion',
    primeira_compra: 'Livraison offerte pour votre première commande 🎉',
    cupom: 'Livraison offerte grâce à votre code promo',
  },
  entregarEm: 'Livrer à',
  ref: 'Repère : ',
  retirarEm: 'À retirer à',
  balcao: 'Au comptoir du restaurant',
  obs: 'Remarque : ',
  precisaFalar: 'Besoin de nous parler ?',
  chamaZap: 'Écrivez-nous sur WhatsApp',
  zapTexto: (n) => `Bonjour ! À propos de la commande #${n} :`,
};

const pedIt: TextosPedido = {
  naoEncontrado: 'Ordine non trovato.',
  pixErro: 'Non è stato possibile generare il Pix ora.',
  falhaConexao: 'Connessione non riuscita — riprova.',
  carregando: 'Caricamento del tuo ordine…',
  recebido: 'Ordine ricevuto',
  naCozinha: 'In cucina',
  pronto: 'Pronto',
  saiuEntrega: 'In consegna',
  naPorta: 'Corriere alla porta',
  entregue: 'Consegnato',
  prontoRetirada: 'Pronto per il ritiro',
  retirado: 'Ritirato',
  pedido: 'Ordine',
  asap: 'il prima possibile',
  agendado: (d, h) => `${d} alle ${h}`,
  faltaPagamento: (v) => `Manca solo il pagamento — ${v}`,
  explicaPagamento:
    'Il tuo ordine passa in cucina appena il pagamento viene approvato. Hai fino a 40 minuti prima che scada.',
  qrAlt: 'Codice QR Pix',
  qrInstrucao: 'Apri l’app della tua banca, scegli Pix e scansiona — oppure copia il codice:',
  copiado: '✓ Codice copiato!',
  copiar: 'Copia codice Pix',
  pagouAviso: 'Hai pagato? La conferma compare qui da sola in pochi secondi.',
  gerandoPix: 'Generazione del Pix…',
  gerarPix: 'Genera codice QR Pix',
  preferePix: 'Preferisco pagare con Pix',
  prefereCartao: 'Preferisco pagare con carta',
  cancelado: 'Ordine annullato',
  estornado: 'L’importo pagato è stato rimborsato — potrebbero volerci alcuni giorni prima che compaia sull’estratto conto.',
  novoPedido: 'Fai un nuovo ordine',
  obrigado: ' — grazie! 🌅',
  pagEntregaTitulo: 'Pagamento alla consegna',
  pagEntregaResto: (v) => ` — ${v} con carta o Pix sul POS del corriere, oppure in contanti.`,
  tempoEstimado: (a, b) => `Tempo stimato: ${a}–${b} min.`,
  resumo: 'Riepilogo',
  subtotal: 'Subtotale',
  cupom: 'Codice sconto',
  entrega: 'Consegna',
  gratisSufixo: ' (gratis)',
  total: 'Totale',
  freteMotivo: {
    distancia: 'Consegna gratuita — sei vicinissimo a noi',
    promocao: 'Consegna gratuita — ordine sopra l’importo della promozione',
    primeira_compra: 'Consegna gratuita sul tuo primo ordine 🎉',
    cupom: 'Consegna gratuita con il tuo codice sconto',
  },
  entregarEm: 'Consegna a',
  ref: 'Rif.: ',
  retirarEm: 'Ritiro presso',
  balcao: 'Al banco del ristorante',
  obs: 'Note: ',
  precisaFalar: 'Hai bisogno di parlarci?',
  chamaZap: 'Scrivici su WhatsApp',
  zapTexto: (n) => `Ciao! A proposito dell’ordine #${n}:`,
};

export const TXT_PEDIDO: Record<IdiomaDelivery, TextosPedido> = {
  pt: pedPt,
  en: pedEn,
  es: pedEs,
  fr: pedFr,
  it: pedIt,
};
