export type MenuIconName =
  | 'home'
  | 'operation'
  | 'clients'
  | 'inventory'
  | 'finance'
  | 'people'
  | 'admin';

export type NotificationKey = 'opsAguardandoRevisao';

export interface MenuLinkItem {
  label: string;
  href: string;
  perm?: string;
  soon?: boolean;
  badge?: NotificationKey;
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
 * Navegação organizada por área de trabalho (não por tipo técnico de tela).
 * Rotas e códigos de permissão são os mesmos do menu horizontal antigo —
 * nenhuma URL nem permissão nova foi inventada aqui.
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
          { label: 'Dashboard analítico', href: '/dashboard', perm: 'dashboard.read' },
          { label: 'Relatório consolidado', href: '/relatorio', perm: 'relatorio.read' },
        ],
      },
    ],
  },
  {
    id: 'operacao',
    label: 'Operação',
    icon: 'operation',
    badge: 'opsAguardandoRevisao',
    sections: [
      {
        label: 'Vendas e salão',
        links: [
          { label: 'Pedidos e vendas', href: '/movimento/pedidos', perm: 'conciliacao.read' },
          { label: 'Pagamentos do PDV', href: '/financeiro/pagamentos', perm: 'conciliacao.read' },
          { label: 'Cancelamentos do caixa', href: '/movimento/cancelamentos', perm: 'conciliacao.read' },
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
            label: 'Templates de produção',
            href: '/cadastros/templates-producao',
            perm: 'ordem_producao.read',
          },
          {
            label: 'Perdas por cozinheiro',
            href: '/relatorios/producao',
            perm: 'relatorio.read',
          },
        ],
      },
      {
        label: 'Delivery',
        links: [
          { label: 'Pedidos', href: '/delivery-admin', perm: 'delivery.read' },
          { label: 'Cardápio', href: '/delivery-admin/cardapio', perm: 'delivery.read' },
          { label: 'Cupons', href: '/delivery-admin/cupons', perm: 'delivery.read' },
          {
            label: 'Configuração do delivery',
            href: '/delivery-admin/config',
            perm: 'delivery.configurar',
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
          { label: 'Agenda de reservas', href: '/reservas', perm: 'reserva.read' },
          { label: 'Lista de espera', href: '/lista-espera', perm: 'lista_espera.read' },
        ],
      },
      {
        label: 'Eventos',
        links: [
          { label: 'Orçamentos', href: '/orcamentos', perm: 'orcamento.read' },
          { label: 'Leads de eventos', href: '/atendimento/eventos', perm: 'atendimento.read' },
        ],
      },
      {
        label: 'Relacionamento',
        links: [
          { label: 'Conversas da Nina', href: '/atendimento', perm: 'atendimento.read' },
          { label: 'Avaliações', href: '/avaliacoes', perm: 'avaliacao.read' },
          { label: 'Cadastro de clientes', href: '/cadastros/clientes', perm: 'reserva.read' },
        ],
      },
      {
        label: 'Configuração',
        links: [
          {
            label: 'Configuração da Nina',
            href: '/atendimento/config',
            perm: 'atendimento.config',
          },
        ],
      },
    ],
  },
  {
    id: 'compras-estoque',
    label: 'Compras e Estoque',
    icon: 'inventory',
    sections: [
      {
        label: 'Compras',
        links: [
          { label: 'Sugestão de compra', href: '/compras/sugestao', perm: 'cotacao.read' },
          { label: 'Cotações', href: '/cotacao', perm: 'cotacao.read' },
          { label: 'Pedidos de compra', href: '/compras/pedidos', perm: 'pedido_compra.read' },
          {
            label: 'Aguardando nota fiscal',
            href: '/compras/aguardando-nf',
            perm: 'pedido_compra.read',
          },
          {
            label: 'Revisar itens de nota fiscal',
            href: '/compras/match-items',
            perm: 'nota_compra.vincular_produto',
          },
        ],
      },
      {
        label: 'Recebimento',
        links: [
          {
            label: 'Entrada de notas',
            href: '/movimento/entrada-notas',
            perm: 'nota_compra.read',
          },
        ],
      },
      {
        label: 'Catálogo',
        links: [
          { label: 'Produtos', href: '/cadastros/produtos', perm: 'produto.read' },
          { label: 'Fornecedores', href: '/cadastros/fornecedores', perm: 'fornecedor.read' },
          {
            label: 'Categorizar produtos',
            href: '/cadastros/produtos/categorizar',
            perm: 'produto.categorizar',
          },
          {
            label: 'Produto × fornecedor',
            href: '/compras/reconciliacao',
            perm: 'produto.vincular_fornecedor',
          },
        ],
      },
      {
        label: 'Estoque',
        links: [
          { label: 'Posição de estoque', href: '/relatorios/estoque', perm: 'relatorio.read' },
          {
            label: 'Movimentações de estoque',
            href: '/relatorios/movimentos',
            perm: 'relatorio.read',
          },
          {
            label: 'Insumos mais utilizados',
            href: '/relatorios/insumos',
            perm: 'relatorio.read',
          },
        ],
      },
    ],
  },
  {
    id: 'financeiro-fiscal',
    label: 'Financeiro e Fiscal',
    icon: 'finance',
    sections: [
      {
        label: 'Financeiro',
        links: [
          { label: 'Contas a pagar', href: '/financeiro', perm: 'conta_pagar.read' },
          { label: 'Contas a receber', href: '/financeiro/receber', perm: 'conta_receber.read' },
          { label: 'A receber de canais (iFood)', href: '/financeiro/receber-canal', perm: 'conta_receber.read' },
          { label: 'Plano de contas', href: '/cadastros/plano-contas', perm: 'configuracao.read' },
        ],
      },
      {
        label: 'Conciliação',
        links: [
          {
            label: '1. PDV × Cielo',
            href: '/conciliacao/operadora',
            perm: 'conciliacao.read',
          },
          {
            label: '2. Cielo × recebíveis',
            href: '/conciliacao/recebiveis',
            perm: 'conciliacao.read',
          },
          {
            label: '3. Recebíveis × banco',
            href: '/conciliacao/banco',
            perm: 'conciliacao.read',
          },
          {
            label: 'Pagamentos diretos',
            href: '/conciliacao/pdv-banco-direto',
            perm: 'conciliacao.read',
          },
          {
            label: 'Correções de canal',
            href: '/conciliacao/cross-route-sugestoes',
            perm: 'conciliacao.read',
          },
          { label: 'Exceções', href: '/excecoes', perm: 'conciliacao.read' },
          { label: 'Importação de arquivos', href: '/upload', perm: 'conciliacao.read' },
          { label: 'Fechamento', href: '/fechamento', perm: 'conciliacao.fechar' },
          {
            label: 'Formas de pagamento',
            href: '/configuracoes/formas-pagamento',
            perm: 'configuracao.read',
          },
        ],
      },
      {
        label: 'Fiscal',
        links: [
          { label: 'NFC-e emitidas', href: '/fiscal/nfce', perm: 'nfce.read' },
          {
            label: 'Certificados A1',
            href: '/configuracoes/certificados',
            perm: 'configuracao.certificado',
          },
          {
            label: 'Configuração fiscal',
            href: '/configuracoes/fiscal',
            perm: 'configuracao.read',
          },
        ],
      },
      {
        label: 'Análises financeiras',
        links: [
          { label: 'DRE', href: '/relatorios/dre', perm: 'relatorio.read' },
          { label: 'Conferência de caixa', href: '/financeiro/conferencia-caixa', perm: 'relatorio.read' },
          {
            label: 'Fluxo de caixa',
            href: '/relatorios/fluxo-caixa',
            perm: 'relatorio.read',
            soon: true,
          },
          {
            label: 'Fechamento do mês',
            href: '/relatorios/fechamento',
            perm: 'relatorio.read',
          },
          {
            label: 'Histórico de fechamentos',
            href: '/relatorios/fechamento-mensal',
            perm: 'relatorio.read',
          },
        ],
      },
    ],
  },
  {
    id: 'pessoas',
    label: 'Pessoas',
    icon: 'people',
    sections: [
      {
        label: 'Equipe',
        links: [
          { label: 'Funcionários', href: '/rh/funcionarios', perm: 'funcionario.read' },
          { label: 'Ponto', href: '/rh/ponto', perm: 'ponto.read' },
          { label: 'Turnover', href: '/rh/turnover', perm: 'funcionario.read' },
          { label: 'Remuneração (folha)', href: '/folha-equipe/pessoas', perm: 'folha_equipe.read' },
          { label: 'Cozinheiros', href: '/cadastros/colaboradores', perm: 'folha_equipe.read' },
          { label: 'Banco de talentos', href: '/talentos', perm: 'folha_equipe.read' },
        ],
      },
      {
        label: 'Folha',
        links: [
          {
            label: 'Folhas semanais',
            href: '/folha-equipe/folhas',
            perm: 'folha_equipe.read',
          },
          { label: 'Metas e premiação', href: '/rh/metas', perm: 'meta.read' },
          {
            label: 'Configuração da folha',
            href: '/folha-equipe/configuracao',
            perm: 'folha_equipe.read',
          },
        ],
      },
      {
        label: 'Escuta',
        links: [
          { label: 'Clima organizacional', href: '/rh/clima', perm: 'clima.read' },
          { label: 'Ouvidoria', href: '/rh/ouvidoria', perm: 'ouvidoria.read' },
        ],
      },
    ],
  },
  {
    id: 'administracao',
    label: 'Administração',
    icon: 'admin',
    sections: [
      {
        label: 'Organização',
        links: [
          {
            label: 'Filiais e taxas',
            href: '/configuracoes',
            perm: 'configuracao.read',
          },
          {
            label: 'Pagamento (Cielo por casa)',
            href: '/configuracoes/pagamento',
            perm: 'configuracao.read',
          },
        ],
      },
      {
        label: 'Acessos',
        links: [
          { label: 'Usuários', href: '/configuracoes/usuarios', perm: 'usuario.read' },
          {
            label: 'Grupos e permissões',
            href: '/configuracoes/grupos',
            perm: 'grupo_usuario.read',
          },
        ],
      },
      {
        label: 'Integrações',
        links: [
          {
            label: 'Sincronização dos agentes',
            href: '/sync',
            perm: 'configuracao.read',
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
];

export function isRouteActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
