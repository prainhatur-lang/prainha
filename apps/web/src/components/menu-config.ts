export type MenuIconName =
  | 'home'
  | 'operation'
  | 'menu'
  | 'clients'
  | 'inventory'
  | 'finance'
  | 'fiscal'
  | 'reports'
  | 'people'
  | 'admin'
  | 'marketing';

export type NotificationKey = 'opsAguardandoRevisao';

export interface MenuLinkItem {
  label: string;
  href: string;
  perm?: string;
  soon?: boolean;
  badge?: NotificationKey;
  /** Esconde do contador de fora (grupo só "Contador") mesmo tendo a perm. */
  semContador?: boolean;
  /**
   * Nomes antigos e palavras que as pessoas usam pra procurar a tela. A busca
   * do menu acha por eles (ex.: "lotérica" acha "Baixa por comprovantes").
   */
  aka?: string[];
  /** Uso interno do Prainha: some na instância dos clientes do SaaS. */
  interno?: boolean;
  /**
   * Tela que já abre por dentro de outra (ex.: Admissão sai de Funcionários):
   * não ocupa linha no menu, só aparece quando a pessoa busca.
   */
  soNaBusca?: boolean;
}

export interface MenuSection {
  label?: string;
  links: MenuLinkItem[];
}

export interface MenuArea {
  id: string;
  label: string;
  icon: MenuIconName;
  badge?: NotificationKey;
  sections: MenuSection[];
}

/**
 * Navegação por área de trabalho, com nomes que qualquer loja entende
 * (reestruturação de 04/11/2026, antes da revenda do SaaS).
 *
 * Regra: as rotas e os códigos de permissão são os MESMOS de antes — só mudou
 * o nome e o lugar. O nome antigo fica em `aka` pra busca do menu achar.
 * Itens `interno` (E.B., Lelis, energia) aparecem no Prainha e somem na
 * instância dos clientes.
 */
export const MENU_AREAS: MenuArea[] = [
  {
    id: 'inicio',
    label: 'Início',
    icon: 'home',
    sections: [
      {
        links: [
          { label: 'Meu painel', href: '/' },
          {
            label: 'Painel de indicadores',
            href: '/dashboard',
            perm: 'dashboard.read',
            aka: ['Dashboard analítico', 'dashboard', 'calendário de eventos'],
          },
          { label: 'Balanço do dia', href: '/balanco', perm: 'dashboard.read', aka: ['resumo do dia'] },
        ],
      },
    ],
  },
  {
    id: 'vendas',
    label: 'Vendas',
    icon: 'operation',
    sections: [
      {
        label: 'Salão e caixa',
        links: [
          {
            label: 'Pedidos e vendas',
            href: '/movimento/pedidos',
            perm: 'conciliacao.read',
            aka: ['mesas', 'comandas', 'contas'],
          },
          {
            label: 'Pagamentos recebidos',
            href: '/financeiro/pagamentos',
            perm: 'conciliacao.read',
            aka: ['Pagamentos do PDV', 'formas de pagamento das vendas'],
          },
          {
            label: 'Cancelamentos',
            href: '/movimento/cancelamentos',
            perm: 'conciliacao.read',
            aka: ['Cancelamentos do caixa', 'estornos', 'itens cancelados'],
          },
        ],
      },
      {
        label: 'Delivery próprio',
        links: [
          { label: 'Pedidos do delivery', href: '/delivery-admin', perm: 'delivery.read', aka: ['Delivery: Pedidos'] },
          {
            label: 'Cardápio do delivery',
            href: '/delivery-admin/cardapio',
            perm: 'delivery.read',
            aka: ['Delivery: Cardápio'],
          },
          {
            label: 'Cupons de desconto',
            href: '/delivery-admin/cupons',
            perm: 'delivery.read',
            aka: ['Delivery: Cupons'],
          },
          {
            label: 'Configuração do delivery',
            href: '/delivery-admin/config',
            perm: 'delivery.configurar',
            aka: ['site de pedidos', 'taxa de entrega'],
          },
        ],
      },
      {
        label: 'iFood',
        links: [
          {
            label: 'Loja no iFood (abrir e pausar)',
            href: '/ifood',
            perm: 'delivery.read',
            aka: ['Loja (abrir e pausar)', 'aplicativo de delivery'],
          },
          { label: 'Cardápio no iFood', href: '/ifood/cardapio', perm: 'delivery.read' },
          {
            label: 'Credenciais do iFood',
            href: '/configuracoes/ifood',
            perm: 'configuracao.read',
            aka: ['iFood (credencial por casa)'],
          },
        ],
      },
    ],
  },
  {
    id: 'cardapio-producao',
    label: 'Cardápio e produção',
    icon: 'menu',
    badge: 'opsAguardandoRevisao',
    sections: [
      {
        label: 'Produtos e cardápio',
        links: [
          { label: 'Produtos', href: '/cadastros/produtos', perm: 'produto.read', aka: ['itens', 'preços', 'ficha técnica'] },
          {
            label: 'O que esta loja vende',
            href: '/cadastros/produtos/ativar',
            perm: 'produto.update',
            aka: ['ativar produtos', 'mix da loja'],
          },
          {
            label: 'Categorias dos produtos',
            href: '/cadastros/produtos/categorizar',
            perm: 'produto.categorizar',
            aka: ['Categorizar produtos', 'grupos'],
          },
          { label: 'Combos', href: '/cadastros/produtos/combos', soNaBusca: true, perm: 'produto.update', aka: ['executivo', 'kit'] },
          {
            label: 'Promoções',
            href: '/cardapio/promocoes',
            perm: 'produto.read',
            aka: ['happy hour', 'preço por horário', 'paga 1 leva 2'],
          },
          {
            label: 'Preço por horário',
            href: '/cardapio/preco-horario', soNaBusca: true,
            perm: 'produto.read',
            aka: ['happy hour'],
          },
        ],
      },
      {
        label: 'Cardápio digital',
        links: [
          {
            label: 'Cardápio digital (QR da mesa)',
            href: '/cardapio',
            perm: 'produto.read',
            aka: ['Cardápio do QR', 'QR code', 'fotos dos produtos'],
          },
          {
            label: 'Destaques do cardápio',
            href: '/cardapio/destaques', soNaBusca: true,
            perm: 'produto.read',
            aka: ['almoço', 'happy hour', 'sugestões'],
          },
          {
            label: 'Restrições alimentares',
            href: '/cardapio/restricoes', soNaBusca: true,
            perm: 'produto.read',
            aka: ['cardápio inclusivo', 'alérgenos', 'vegano', 'sem glúten'],
          },
          {
            label: 'Carta de vinhos (imprimir)',
            href: '/cardapio/vinhos',
            perm: 'produto.read',
            aka: ['carta de vinho', 'vinhos', 'imprimir cardápio', 'menu impresso'],
          },
          {
            label: 'Totem de autoatendimento',
            href: '/cardapio/totem', soNaBusca: true,
            perm: 'produto.read',
            aka: ['autoatendimento'],
          },
        ],
      },
      {
        label: 'Produção',
        links: [
          {
            label: 'Ordens de produção',
            href: '/movimento/producao',
            perm: 'ordem_producao.read',
            badge: 'opsAguardandoRevisao',
          },
          {
            label: 'Modelos de produção',
            href: '/cadastros/templates-producao',
            perm: 'ordem_producao.read',
            aka: ['Templates de produção', 'receitas', 'rendimento'],
          },
          {
            label: 'Rendimento e perdas da produção',
            href: '/relatorios/producao',
            perm: 'relatorio.read',
            aka: ['Perdas por cozinheiro', 'Relatório de produção', 'quebra'],
          },
          {
            label: 'Equipe de produção',
            href: '/cadastros/colaboradores',
            perm: 'folha_equipe.read',
            aka: ['Cozinheiros', 'colaboradores'],
          },
        ],
      },
    ],
  },
  {
    id: 'compras-estoque',
    label: 'Compras e estoque',
    icon: 'inventory',
    sections: [
      {
        label: 'Compras',
        links: [
          { label: 'Sugestão de compra', href: '/compras/sugestao', perm: 'cotacao.read' },
          {
            label: 'Lista semanal de compras',
            href: '/compras/sugestao/semana',
            perm: 'cotacao.read',
            aka: ['Lista da semana (cozinha)', 'cotação semanal'],
          },
          { label: 'Cotações', href: '/cotacao', perm: 'cotacao.read', aka: ['orçamento de fornecedor'] },
          { label: 'Pedidos de compra', href: '/compras/pedidos', perm: 'pedido_compra.read' },
          {
            label: 'Pedidos aguardando nota',
            href: '/compras/aguardando-nf',
            perm: 'pedido_compra.read',
            aka: ['Aguardando nota fiscal'],
          },
        ],
      },
      {
        label: 'Notas de entrada',
        links: [
          {
            label: 'Entrada de notas fiscais',
            href: '/movimento/entrada-notas',
            perm: 'nota_compra.read',
            aka: ['Entrada de notas', 'NF-e de compra', 'XML', 'SEFAZ', 'DANFE'],
          },
          {
            label: 'Conferir itens das notas',
            href: '/compras/match-items',
            perm: 'nota_compra.vincular_produto',
            aka: ['Revisar itens de nota fiscal', 'vincular item'],
          },
          {
            label: 'Produto × fornecedor',
            href: '/compras/reconciliacao',
            perm: 'produto.vincular_fornecedor',
            aka: ['código do fornecedor'],
          },
        ],
      },
      {
        label: 'Estoque',
        links: [
          {
            label: 'Posição de estoque',
            href: '/relatorios/estoque',
            perm: 'relatorio.read',
            aka: ['saldo', 'contagem', 'inventário', 'CMV'],
          },
          { label: 'Estoque por setor', href: '/estoque/locais', perm: 'produto.read', aka: ['locais', 'bar', 'cozinha'] },
          {
            label: 'Transferência entre setores',
            href: '/estoque/locais?aba=transferir',
            perm: 'produto.read',
          },
          {
            label: 'Transferência entre lojas',
            href: '/movimento/transferencias',
            perm: 'nota_compra.read',
            aka: ['Transferências entre casas', 'filiais'],
          },
          {
            label: 'Movimentações de estoque',
            href: '/relatorios/movimentos',
            perm: 'relatorio.read',
            aka: ['entradas e saídas do estoque', 'kardex'],
          },
          {
            label: 'Insumos mais usados',
            href: '/relatorios/insumos',
            perm: 'relatorio.read',
            aka: ['Insumos mais utilizados', 'curva ABC'],
          },
          {
            label: 'Vendido sem baixa no estoque',
            href: '/cadastros/produtos/sem-baixa', soNaBusca: true,
            perm: 'produto.read',
            aka: ['Vendeu e não baixou nada', 'ficha técnica faltando'],
          },
        ],
      },
      {
        label: 'Fornecedores',
        links: [
          { label: 'Fornecedores', href: '/cadastros/fornecedores', perm: 'fornecedor.read' },
          {
            label: 'Vendedores dos fornecedores',
            href: '/cadastros/vendedores',
            perm: 'fornecedor.read',
            aka: ['Vendedores', 'representantes'],
          },
        ],
      },
    ],
  },
  {
    id: 'clientes',
    label: 'Clientes',
    icon: 'clients',
    sections: [
      {
        label: 'Reservas',
        links: [
          { label: 'Agenda de reservas', href: '/reservas', perm: 'reserva.read', aka: ['mesas reservadas'] },
          { label: 'Lista de espera', href: '/lista-espera', perm: 'lista_espera.read', aka: ['fila'] },
          {
            label: 'Vales-presente',
            href: '/reservas/vales-presente', soNaBusca: true,
            perm: 'reserva.read',
            aka: ['gift card', 'presente'],
          },
        ],
      },
      {
        label: 'Eventos',
        links: [
          {
            label: 'Orçamentos de eventos',
            href: '/orcamentos',
            perm: 'orcamento.read',
            aka: ['Orçamentos', 'aniversário', 'confraternização'],
          },
          {
            label: 'Interessados em eventos',
            href: '/atendimento/eventos',
            perm: 'atendimento.read',
            aka: ['Leads de eventos', 'leads'],
          },
        ],
      },
      {
        label: 'Relacionamento',
        links: [
          { label: 'Cadastro de clientes', href: '/cadastros/clientes', perm: 'reserva.read', aka: ['CPF', 'SPC'] },
          { label: 'Avaliações', href: '/avaliacoes', perm: 'avaliacao.read', aka: ['Google', 'TripAdvisor', 'notas'] },
          {
            label: 'Atendimento virtual: conversas',
            href: '/atendimento',
            perm: 'atendimento.read',
            aka: ['Conversas da Nina', 'Nina', 'WhatsApp', 'chat', 'robô'],
          },
          {
            label: 'Atendimento virtual: configuração',
            href: '/atendimento/config',
            perm: 'atendimento.config',
            aka: ['Configuração da Nina', 'Nina', 'ensinar'],
          },
        ],
      },
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    icon: 'marketing',
    sections: [
      {
        label: 'Redes sociais e anúncios',
        links: [
          {
            label: 'Instagram e TikTok',
            href: '/marketing',
            perm: 'atendimento.read',
            aka: ['posts', 'publicar', 'redes sociais'],
          },
          {
            label: 'Anúncios (Meta)',
            href: '/marketing/anuncios', soNaBusca: true,
            perm: 'atendimento.read',
            aka: ['Anúncios da Meta', 'Facebook', 'impulsionar', 'tráfego pago'],
          },
        ],
      },
      {
        label: 'Fidelidade e campanhas',
        links: [
          {
            label: 'Programa de fidelidade',
            href: '/fidelidade',
            perm: 'fidelidade.read',
            aka: ['Cartão fidelidade', 'cliente VIP', 'pontos', 'carteira'],
          },
          {
            label: 'Campanhas por WhatsApp',
            href: '/campanha',
            perm: 'fidelidade.read',
            aka: ['Convite por WhatsApp', 'disparo'],
          },
        ],
      },
    ],
  },
  {
    id: 'financeiro',
    label: 'Financeiro',
    icon: 'finance',
    sections: [
      {
        label: 'Contas a pagar',
        links: [
          { label: 'Contas a pagar', href: '/financeiro', perm: 'conta_pagar.read', aka: ['boletos', 'despesas'] },
          {
            label: 'Pagar por Pix',
            href: '/financeiro/pedidos-pix',
            perm: 'conta_pagar.read',
            aka: ['Pedidos a pagar por Pix', 'pedidos Pix'],
          },
          {
            label: 'Impostos (guias)',
            href: '/financeiro/impostos',
            perm: 'conta_pagar.read',
            aka: ['DAS', 'FGTS', 'INSS', 'DARF'],
          },
          {
            label: 'Faturas de cartão de crédito',
            href: '/financeiro/cartoes',
            perm: 'conta_pagar.read',
            aka: ['Faturas de cartão'],
          },
          {
            label: 'Histórico de exclusões',
            href: '/financeiro/excluidas',
            perm: 'conta_pagar.read',
            aka: ['Registro de exclusões', 'excluídas'],
          },
        ],
      },
      {
        label: 'Contas a receber',
        links: [
          { label: 'Contas a receber', href: '/financeiro/receber', perm: 'conta_receber.read', aka: ['fiado'] },
          {
            label: 'A receber de apps de delivery',
            href: '/financeiro/receber-canal',
            perm: 'conta_receber.read',
            aka: ['A receber de canais (iFood)', 'iFood'],
          },
          {
            label: 'Repasses do iFood',
            href: '/ifood/financeiro',
            perm: 'conta_receber.read',
            aka: ['Faturamento do iFood'],
          },
          { label: 'Permutas e parcerias', href: '/financeiro/permutas', perm: 'conta_receber.read' },
          {
            label: 'Encontro de contas entre lojas',
            href: '/movimento/transferencias/encontro', soNaBusca: true,
            perm: 'conta_pagar.read',
            aka: ['Encontro de contas', 'casas'],
          },
        ],
      },
      {
        label: 'Banco e caixa',
        links: [
          {
            label: 'Boletos pagos (Inter)',
            href: '/financeiro/boletos-inter',
            perm: 'conta_pagar.read',
            aka: ['Boletos pagos no Inter', 'banco'],
          },
          {
            label: 'Pix pagos (Inter)',
            href: '/financeiro/pix-inter',
            perm: 'conta_pagar.read',
            aka: ['Pix pagos no Inter', 'banco'],
          },
          {
            label: 'Empréstimos entre empresas',
            href: '/financeiro/emprestimos',
            perm: 'conta_pagar.read',
            aka: ['mútuo', 'mutuo', 'emprestar', 'E.B. emprestou'],
          },
          {
            label: 'Dinheiro em espécie (cofre)',
            href: '/financeiro/portadores',
            perm: 'conta_pagar.read',
            aka: ['Portadores (cofre e dinheiro)', 'cofre', 'sangria'],
          },
          {
            label: 'Conferência dos caixas',
            href: '/financeiro/conferencia-caixa',
            perm: 'relatorio.read',
            semContador: true,
            aka: ['Conferência de caixa', 'quebra de caixa'],
          },
        ],
      },
      {
        label: 'Conciliação',
        links: [
          {
            label: '1. Vendas × maquininha',
            href: '/conciliacao/operadora',
            perm: 'conciliacao.read',
            aka: ['PDV × Cielo', 'Cielo', 'adquirente', 'cartão'],
          },
          {
            label: '2. Maquininha × recebíveis',
            href: '/conciliacao/recebiveis',
            perm: 'conciliacao.read',
            aka: ['Cielo × recebíveis', 'Cielo', 'agenda de recebimento'],
          },
          {
            label: '3. Recebíveis × banco',
            href: '/conciliacao/banco',
            perm: 'conciliacao.read',
            aka: ['extrato'],
          },
          {
            label: 'Vendas × banco (Pix e TED)',
            href: '/conciliacao/pdv-banco-direto',
            perm: 'conciliacao.read',
            aka: ['Pagamentos diretos', 'PDV × banco direto', 'Pix manual'],
          },
          {
            label: 'Pagamento na forma errada',
            href: '/conciliacao/cross-route-sugestoes',
            perm: 'conciliacao.read',
            aka: ['Correções de canal', 'Sugestões cross-route', 'canal errado'],
          },
          {
            label: 'Divergências a resolver',
            href: '/excecoes',
            perm: 'conciliacao.read',
            aka: ['Exceções', 'dinheiro que não entrou'],
          },
          {
            label: 'Importar arquivos e extratos',
            href: '/upload',
            perm: 'conciliacao.read',
            aka: ['Importação de arquivos', 'OFX', 'EDI', 'upload'],
          },
          {
            label: 'Fechar período',
            href: '/fechamento',
            perm: 'conciliacao.fechar',
            aka: ['Fechamento', 'Fechamento de período'],
          },
        ],
      },
      {
        label: 'Cadastros do financeiro',
        links: [
          {
            label: 'Plano de contas',
            href: '/cadastros/plano-contas',
            perm: 'configuracao.read',
            aka: ['categorias de despesa'],
          },
          {
            label: 'Plano de contas × contabilidade',
            href: '/cadastros/plano-contas/contabil', soNaBusca: true,
            perm: 'configuracao.read',
            aka: ['Plano de contas × contador', 'conta contábil'],
          },
          {
            label: 'Formas de pagamento',
            href: '/configuracoes/formas-pagamento',
            perm: 'configuracao.read',
          },
        ],
      },
    ],
  },
  {
    id: 'fiscal',
    label: 'Fiscal',
    icon: 'fiscal',
    sections: [
      {
        label: 'Notas emitidas',
        links: [
          {
            label: 'NFC-e emitidas (cupom fiscal)',
            href: '/fiscal/nfce',
            perm: 'nfce.read',
            aka: ['NFC-e emitidas', 'cupom', 'nota de consumidor'],
          },
          {
            label: 'NF-e avulsa (venda de bem)',
            href: '/fiscal/nfe-avulsa',
            perm: 'nfce.read',
            aka: ['NF-e de venda de bem'],
          },
          { label: 'Mapa mensal do ICMS', href: '/fiscal/mapa-icms', perm: 'nfce.read' },
        ],
      },
      {
        label: 'Configuração fiscal',
        links: [
          {
            label: 'Certificado digital (A1)',
            href: '/configuracoes/certificados',
            perm: 'configuracao.certificado',
            aka: ['Certificados A1'],
          },
          {
            label: 'Configuração fiscal',
            href: '/configuracoes/fiscal',
            perm: 'configuracao.read',
            aka: ['CSC', 'série', 'regime tributário'],
          },
        ],
      },
    ],
  },
  {
    id: 'relatorios',
    label: 'Relatórios',
    icon: 'reports',
    sections: [
      {
        label: 'Resultado',
        links: [
          { label: 'DRE', href: '/relatorios/dre', perm: 'relatorio.read', aka: ['lucro', 'resultado'] },
          {
            label: 'Fluxo de caixa',
            href: '/relatorios/fluxo-caixa',
            perm: 'relatorio.read',
            soon: true,
          },
          { label: 'Fechamento do mês', href: '/relatorios/fechamento', perm: 'relatorio.read' },
          {
            label: 'Histórico de fechamentos',
            href: '/relatorios/fechamento-mensal',
            perm: 'relatorio.read',
          },
          {
            label: 'Extratos bancários do ano',
            href: '/relatorios/fechamento/extratos',
            perm: 'relatorio.read',
            aka: ['Extratos bancários (ano)'],
          },
          {
            label: 'Histórico de faturamento',
            href: '/relatorios/historico-faturamento',
            perm: 'faturamento_historico.read',
            aka: ['Histórico de faturamento (VGV)', 'VGV'],
          },
        ],
      },
      {
        label: 'Operação',
        links: [
          {
            label: 'Relatório diário das lojas',
            href: '/relatorios/diario',
            perm: 'relatorio.read',
            aka: ['Relatório diário das casas'],
          },
          { label: 'Relatório consolidado', href: '/relatorio', perm: 'relatorio.read' },
          {
            label: 'Eventos: pratos por ticket',
            href: '/relatorios/evento',
            perm: 'relatorio.read',
            aka: ['Evento: pratos de ticket', 'ticket'],
          },
          {
            label: 'Custo da equipe ÷ faturamento',
            href: '/relatorios/folha-faturamento',
            perm: 'relatorio.read',
            semContador: true,
            aka: ['Folha ÷ faturamento'],
          },
        ],
      },
    ],
  },
  {
    id: 'pessoas',
    label: 'Equipe',
    icon: 'people',
    sections: [
      {
        label: 'Cadastro',
        links: [
          { label: 'Funcionários', href: '/rh/funcionarios', perm: 'funcionario.read', aka: ['colaboradores', 'RH'] },
          {
            label: 'Admissão pelo WhatsApp',
            href: '/rh/admissao', soNaBusca: true,
            perm: 'funcionario.create',
            aka: ['contratar', 'contrato', 'ASO'],
          },
          {
            label: 'Entradas e saídas da equipe',
            href: '/rh/entradas-saidas',
            perm: 'funcionario.read',
            aka: ['Entradas e saídas (pendências)', 'desligamento', 'demissão'],
          },
          {
            label: 'Rotatividade (turnover)',
            href: '/rh/turnover',
            perm: 'funcionario.read',
            aka: ['Turnover'],
          },
          { label: 'Banco de talentos', href: '/talentos', perm: 'folha_equipe.read', aka: ['currículos', 'vagas'] },
        ],
      },
      {
        label: 'Ponto e escala',
        links: [
          { label: 'Ponto', href: '/rh/ponto', perm: 'ponto.read', aka: ['batidas', 'ponto facial'] },
          { label: 'Relatório do ponto', href: '/rh/ponto/relatorio', perm: 'ponto.read', aka: ['espelho de ponto'] },
          {
            label: 'Ajustes do ponto',
            href: '/rh/ponto/ajustes', soNaBusca: true,
            perm: 'ponto.read',
            aka: ['Histórico de ajustes do ponto', 'correções'],
          },
          { label: 'Histórico do ponto', href: '/rh/historico-ponto', perm: 'ponto.read' },
          { label: 'Banco de horas', href: '/rh/banco-horas', perm: 'ponto.read', aka: ['atestado', 'hora extra'] },
          {
            label: 'Escala do mês (folgas)',
            href: '/rh/escala-mensal',
            perm: 'folha_equipe.read',
            aka: ['escala', 'folga'],
          },
          {
            label: 'Horas: CLT × intermitente',
            href: '/rh/horas-regime',
            perm: 'folha_equipe.read',
            aka: ['regime'],
          },
          {
            label: 'Estudo de equipe',
            href: '/rh/estudo-equipe',
            perm: 'folha_equipe.read',
            aka: ['estudo', 'equipe', 'escala x venda', '12x36', 'diarista'],
          },
        ],
      },
      {
        label: 'Pagamentos da equipe',
        links: [
          {
            label: 'Folha semanal',
            href: '/folha-equipe/folhas',
            perm: 'folha_equipe.read',
            aka: ['Folhas semanais', 'diárias', 'taxa de serviço', '10%', 'gorjeta', 'comissão'],
          },
          {
            label: 'Baixa por comprovantes',
            href: '/folha-equipe/comprovantes',
            perm: 'folha_equipe.read',
            aka: [
              'Comprovantes da lotérica (10%)',
              'lotérica',
              '10%',
              'comissão',
              'taxa de serviço',
              'gorjeta',
              'vale-transporte',
              'bonificação',
              'gratificação',
              'rescisão',
              'comprovante de depósito',
            ],
          },
          {
            label: 'Vale-transporte (quinzenal)',
            href: '/rh/vale-transporte',
            perm: 'folha_equipe.read',
            aka: ['Vale transporte (quinzenal)', 'VT'],
          },
          {
            label: 'Metas e bonificação',
            href: '/rh/metas',
            perm: 'meta.read',
            aka: ['Metas e premiação', 'prêmio', 'gratificação'],
          },
          {
            label: 'Configuração da folha',
            href: '/folha-equipe/configuracao',
            perm: 'folha_equipe.read',
            aka: ['pontos do 10%', 'gorjeta', 'cargos'],
          },
        ],
      },
      {
        label: 'Folha de pagamento',
        links: [
          {
            // Dono 06/11/2026: "esquece o contador... suba a nossa folha".
            // A tela abre na nossa folha; a do contador fica como comparação.
            // Dono 06/11/2026 (depois): "tira o nome contador, coloca folha mensal".
            label: 'Folha mensal',
            href: '/rh/folha-contador',
            perm: 'folha_equipe.read',
            aka: ['Folha de pagamento', 'Nossa folha', 'contracheque', 'holerite', 'CLT'],
          },
        ],
      },
      {
        label: 'Escuta',
        links: [
          { label: 'Clima organizacional', href: '/rh/clima', perm: 'clima.read', aka: ['pesquisa'] },
          { label: 'Ouvidoria', href: '/rh/ouvidoria', perm: 'ouvidoria.read', aka: ['denúncia'] },
        ],
      },
    ],
  },
  {
    id: 'configuracoes',
    label: 'Configurações',
    icon: 'admin',
    sections: [
      {
        label: 'Empresa e lojas',
        links: [
          {
            label: 'Lojas e taxas',
            href: '/configuracoes',
            perm: 'configuracao.read',
            aka: ['Filiais e taxas', 'filiais', 'casas'],
          },
          {
            label: 'Documentos e alvarás',
            href: '/empresa/documentos',
            perm: 'configuracao.read',
            aka: ['Documentos da empresa (alvarás)', 'licenças', 'vencimento'],
          },
        ],
      },
      {
        label: 'Integrações',
        links: [
          {
            label: 'Maquininhas (Cielo)',
            href: '/configuracoes/pagamento',
            perm: 'configuracao.read',
            aka: ['Pagamento (Cielo por casa)', 'LIO', 'adquirente'],
          },
          {
            label: 'iFood (credenciais)',
            href: '/configuracoes/ifood',
            perm: 'configuracao.read',
            aka: ['iFood (credencial por casa)'],
          },
          {
            label: 'Sincronização com o servidor da loja',
            href: '/sync',
            perm: 'configuracao.read',
            aka: ['Sincronização dos agentes', 'agente'],
          },
        ],
      },
      {
        label: 'Acessos',
        links: [
          { label: 'Usuários', href: '/configuracoes/usuarios', perm: 'usuario.read', aka: ['login', 'senha'] },
          {
            label: 'Equipe do PDV (garçons e caixas)',
            href: '/configuracoes/equipe',
            perm: 'usuario.read',
            aka: ['Equipe da loja (PDV)', 'garçom'],
          },
          {
            label: 'Grupos e permissões',
            href: '/configuracoes/grupos',
            perm: 'grupo_usuario.read',
            aka: ['perfis de acesso'],
          },
          {
            label: 'Matriz de permissões',
            href: '/configuracoes/grupos/matriz', soNaBusca: true,
            perm: 'grupo_usuario.read',
          },
        ],
      },
      {
        label: 'Energia',
        links: [
          {
            label: 'Quadro de comando',
            href: '/energia',
            perm: 'tuya.read',
            interno: true,
            aka: ['energia', 'disjuntor', 'luzes'],
          },
          {
            label: 'Dispositivos (Tuya)',
            href: '/configuracoes/energia',
            perm: 'tuya.configurar',
            interno: true,
            aka: ['energia', 'Tuya'],
          },
        ],
      },
      {
        label: 'Sistema',
        links: [
          {
            label: 'Diagnóstico do sistema',
            href: '/diagnostico',
            perm: 'configuracao.read',
          },
        ],
      },
    ],
  },
  // Dono 11/11/2026: "essas coisas de Lelis e E.B., vamos separar do sistema em
  // si, porque são empresas externas. Lá no final, coloca a empresa Lelis e o que
  // a gente tem dela pra fazer, e a E.B. (emissão de notas etc.). O financeiro
  // trabalha junto." → as telas próprias das duas saíram de Fiscal e de Equipe e
  // ficam aqui, no fim do menu; rotas e permissões são as mesmas. Contas a pagar,
  // empréstimos e impostos das duas continuam no Financeiro.
  {
    id: 'externas',
    label: 'Lelis e E.B.',
    icon: 'admin',
    sections: [
      {
        label: 'Lelis (distribuidora)',
        links: [
          {
            label: 'Lelis: preço de venda e NF-e',
            href: '/lelis/precos',
            perm: 'configuracao.read',
            interno: true,
            aka: ['Lelis', 'distribuidora', 'Fiscal'],
          },
          {
            label: 'Lelis: vender pras casas (pedido)',
            href: '/lelis/vender',
            perm: 'configuracao.read',
            interno: true,
            aka: ['Lelis pedido', 'vender Lelis', 'saída Lelis'],
          },
        ],
      },
      {
        label: 'E.B. Serviços',
        links: [
          {
            label: 'Pagamentos da E.B. (extrato)',
            href: '/rh/folha-contador/pagamentos',
            perm: 'folha_equipe.read',
            interno: true,
            aka: ['E.B.', 'rateio'],
          },
          {
            label: 'Faturas da E.B. (NFS-e)',
            href: '/eb/faturas',
            perm: 'folha_equipe.fechar',
            interno: true,
            aka: ['E.B.'],
          },
          {
            label: 'Nota de serviço avulsa (NFS-e)',
            href: '/eb/nfse-avulsa',
            perm: 'folha_equipe.fechar',
            interno: true,
            aka: ['E.B.', 'NFS-e', 'nota fiscal de serviço', 'empresa de fora', 'tomador externo'],
          },
        ],
      },
    ],
  },
];

export function isRouteActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Minúsculo e sem acento, pra busca do menu. */
export function normalizarBusca(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}
