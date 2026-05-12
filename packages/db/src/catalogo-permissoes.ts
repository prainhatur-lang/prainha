// Catalogo de permissoes do sistema. Usado pelo seed e pelos guards.
//
// Padrao de codigo: '<modulo>.<acao>'
// Acoes default: read | create | update | delete
// Acoes especiais sao adicionadas conforme cada modulo precisa.

export interface PermissaoDef {
  codigo: string;
  modulo: string;
  acao: string;
  descricao: string;
  escopo?: 'filial' | 'organizacao';
}

function crud(
  modulo: string,
  label: string,
  extras: Array<{ acao: string; descricao: string }> = [],
): PermissaoDef[] {
  return [
    { codigo: `${modulo}.read`, modulo, acao: 'read', descricao: `Ver ${label}` },
    { codigo: `${modulo}.create`, modulo, acao: 'create', descricao: `Criar ${label}` },
    { codigo: `${modulo}.update`, modulo, acao: 'update', descricao: `Editar ${label}` },
    { codigo: `${modulo}.delete`, modulo, acao: 'delete', descricao: `Deletar ${label}` },
    ...extras.map((e) => ({
      codigo: `${modulo}.${e.acao}`,
      modulo,
      acao: e.acao,
      descricao: e.descricao,
    })),
  ];
}

export const PERMISSOES: PermissaoDef[] = [
  // === Compras ===
  ...crud('cotacao', 'cotações', [
    { acao: 'aprovar', descricao: 'Aprovar cotação e gerar pedidos' },
    { acao: 'cancelar', descricao: 'Cancelar cotação' },
  ]),
  ...crud('pedido_compra', 'pedidos de compra', [
    { acao: 'enviar', descricao: 'Marcar pedido como enviado' },
    { acao: 'reconciliar', descricao: 'Vincular NF manualmente' },
    { acao: 'cancelar', descricao: 'Cancelar pedido' },
  ]),
  ...crud('fornecedor', 'fornecedores'),
  ...crud('produto', 'produtos/insumos', [
    { acao: 'categorizar', descricao: 'Atribuir categoria de compras' },
    { acao: 'vincular_marca', descricao: 'Gerenciar marcas aceitas' },
    { acao: 'vincular_fornecedor', descricao: 'Vincular fornecedor ao produto' },
  ]),
  ...crud('marca', 'marcas'),

  // === Movimentacao ===
  ...crud('nota_compra', 'notas de entrada', [
    { acao: 'lancar_estoque', descricao: 'Lançar NF no estoque' },
    { acao: 'manifestar', descricao: 'Manifestar ciência SEFAZ' },
    { acao: 'vincular_produto', descricao: 'Linkar item da NF ao produto' },
  ]),
  ...crud('conta_pagar', 'contas a pagar', [
    { acao: 'marcar_pago', descricao: 'Marcar conta como paga' },
  ]),
  ...crud('conta_receber', 'contas a receber', [
    { acao: 'marcar_recebido', descricao: 'Marcar conta como recebida' },
  ]),
  ...crud('ordem_producao', 'ordens de produção', [
    { acao: 'concluir', descricao: 'Concluir OP' },
    { acao: 'cancelar', descricao: 'Cancelar OP' },
  ]),

  // === Conciliacao ===
  {
    codigo: 'conciliacao.read',
    modulo: 'conciliacao',
    acao: 'read',
    descricao: 'Ver conciliações',
  },
  {
    codigo: 'conciliacao.conciliar',
    modulo: 'conciliacao',
    acao: 'conciliar',
    descricao: 'Conciliar manualmente',
  },
  {
    codigo: 'conciliacao.revogar',
    modulo: 'conciliacao',
    acao: 'revogar',
    descricao: 'Revogar conciliação',
  },
  {
    codigo: 'conciliacao.fechar',
    modulo: 'conciliacao',
    acao: 'fechar',
    descricao: 'Fechar mês',
  },

  // === Folha ===
  ...crud('folha_equipe', 'folha da equipe', [
    { acao: 'fechar', descricao: 'Fechar folha semanal' },
  ]),

  // === Relatorios ===
  {
    codigo: 'relatorio.read',
    modulo: 'relatorio',
    acao: 'read',
    descricao: 'Ver relatórios',
  },
  {
    codigo: 'relatorio.exportar',
    modulo: 'relatorio',
    acao: 'exportar',
    descricao: 'Exportar relatórios',
  },

  // === Configuracoes ===
  {
    codigo: 'configuracao.read',
    modulo: 'configuracao',
    acao: 'read',
    descricao: 'Ver configurações',
    escopo: 'organizacao',
  },
  {
    codigo: 'configuracao.editar',
    modulo: 'configuracao',
    acao: 'editar',
    descricao: 'Editar configurações',
    escopo: 'organizacao',
  },
  {
    codigo: 'configuracao.certificado',
    modulo: 'configuracao',
    acao: 'certificado',
    descricao: 'Gerenciar certificado A1',
    escopo: 'organizacao',
  },

  // === Usuarios/grupos (admin) ===
  ...crud('usuario', 'usuários', []).map((p) => ({ ...p, escopo: 'organizacao' as const })),
  ...crud('grupo_usuario', 'grupos de usuário', []).map((p) => ({
    ...p,
    escopo: 'organizacao' as const,
  })),
];

/** Grupos pre-prontos do sistema com lista de permissoes (codigos). */
export const GRUPOS_SISTEMA: Array<{
  nome: string;
  descricao: string;
  permissoes: (codigos: string[]) => string[];
}> = [
  {
    nome: 'Admin',
    descricao: 'Acesso total — todas as permissões',
    permissoes: (todas) => todas,
  },
  {
    nome: 'Gerente',
    descricao: 'Tudo exceto Configurações e gestão de usuários/grupos',
    permissoes: (todas) =>
      todas.filter(
        (c) =>
          !c.startsWith('configuracao.') &&
          !c.startsWith('usuario.') &&
          !c.startsWith('grupo_usuario.'),
      ),
  },
  {
    nome: 'Comprador',
    descricao: 'CRUD em Compras + read em Fornecedor/Produto/Marca',
    permissoes: (todas) =>
      todas.filter(
        (c) =>
          c.startsWith('cotacao.') ||
          c.startsWith('pedido_compra.') ||
          c.startsWith('produto.') ||
          c === 'fornecedor.read' ||
          c === 'marca.read' ||
          c === 'nota_compra.read' ||
          c === 'nota_compra.vincular_produto',
      ),
  },
  {
    nome: 'Financeiro',
    descricao: 'CRUD em Contas a pagar/receber + read Conciliação + Relatórios',
    permissoes: (todas) =>
      todas.filter(
        (c) =>
          c.startsWith('conta_pagar.') ||
          c.startsWith('conta_receber.') ||
          c === 'nota_compra.read' ||
          c === 'nota_compra.lancar_estoque' ||
          c.startsWith('conciliacao.') ||
          c.startsWith('relatorio.') ||
          c === 'fornecedor.read',
      ),
  },
  {
    nome: 'Conferente NF',
    descricao: 'CRUD em Entrada de NF + read em Fornecedor/Produto',
    permissoes: (todas) =>
      todas.filter(
        (c) =>
          c.startsWith('nota_compra.') ||
          c === 'fornecedor.read' ||
          c === 'produto.read' ||
          c === 'produto.vincular_fornecedor',
      ),
  },
  {
    nome: 'Cozinheiro',
    descricao: 'Ler e atualizar próprias ordens de produção',
    permissoes: (todas) =>
      todas.filter(
        (c) =>
          c === 'ordem_producao.read' ||
          c === 'ordem_producao.update' ||
          c === 'ordem_producao.concluir',
      ),
  },
];

/** Mapeia role antigo -> nome do grupo sistema pra migracao. */
export const ROLE_PARA_GRUPO: Record<string, string> = {
  DONO: 'Admin',
  GERENTE: 'Gerente',
  COMPRAS: 'Comprador',
  FINANCEIRO: 'Financeiro',
};
