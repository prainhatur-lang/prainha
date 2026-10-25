// Documentos de entrada e saída do funcionário (pedido do dono 25/10/2026):
// na entrada sobe contrato assinado, exame e documentos; na saída sobe
// rescisão assinada e exame e dá baixa no cadastro. Tabela
// funcionario_documento; arquivo no bucket privado, pasta rh-documentos/<filial>/.
// Lista de tipos é só uma ajuda (checklist) — o que é obrigatório depende de
// a pessoa ter carteira assinada ou não.

export const BUCKET_DOC_RH = 'extratos-fechamento';
export const DOC_RH_TAMANHO_MAX = 25 * 1024 * 1024;
export const DOC_RH_EXTENSOES = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'pdf'];

export type MomentoDoc = 'admissao' | 'desligamento';

export interface TipoDoc {
  tipo: string;
  rotulo: string;
  /** Obrigatório pra quem tem carteira assinada. */
  clt: boolean;
  /** Obrigatório pra quem trabalha sem carteira (diária/chamado). */
  semCarteira: boolean;
  dica?: string;
}

export const DOCS_ADMISSAO: TipoDoc[] = [
  { tipo: 'contrato_trabalho', rotulo: 'Contrato de trabalho assinado', clt: true, semCarteira: false, dica: 'inclui o de experiência' },
  { tipo: 'aso_admissional', rotulo: 'Exame admissional (ASO)', clt: true, semCarteira: false },
  { tipo: 'documentos_pessoais', rotulo: 'RG, CPF e comprovante de endereço', clt: true, semCarteira: true },
  { tipo: 'ctps', rotulo: 'Carteira de trabalho (digital ou foto)', clt: true, semCarteira: false },
  { tipo: 'ficha_registro', rotulo: 'Ficha de registro do contador', clt: false, semCarteira: false },
  { tipo: 'opcao_vt', rotulo: 'Opção de vale-transporte assinada', clt: false, semCarteira: false },
  { tipo: 'termo_diaria', rotulo: 'Termo de trabalho por diária/chamado', clt: false, semCarteira: true },
  { tipo: 'outro_admissao', rotulo: 'Outro documento de entrada', clt: false, semCarteira: false },
];

export const DOCS_DESLIGAMENTO: TipoDoc[] = [
  { tipo: 'pedido_demissao', rotulo: 'Pedido de demissão assinado', clt: false, semCarteira: false, dica: 'quando a pessoa pediu pra sair' },
  { tipo: 'aviso_previo', rotulo: 'Aviso prévio assinado', clt: false, semCarteira: false, dica: 'quando a casa dispensou' },
  { tipo: 'trct', rotulo: 'Termo de rescisão (TRCT) assinado', clt: true, semCarteira: false },
  { tipo: 'aso_demissional', rotulo: 'Exame demissional (ASO)', clt: true, semCarteira: false },
  { tipo: 'comprovante_rescisao', rotulo: 'Comprovante do pagamento da rescisão', clt: true, semCarteira: false },
  { tipo: 'guias_fgts', rotulo: 'Chave do FGTS / seguro-desemprego', clt: false, semCarteira: false },
  { tipo: 'faltas_abandono', rotulo: 'Registro das faltas / notificação de abandono', clt: false, semCarteira: false, dica: 'quem sumiu sem avisar' },
  { tipo: 'recibo_acerto', rotulo: 'Recibo do último acerto assinado', clt: false, semCarteira: true },
  { tipo: 'outro_desligamento', rotulo: 'Outro documento de saída', clt: false, semCarteira: false },
];

export const MOTIVOS_SAIDA = [
  'Pedido de demissão',
  'Dispensa sem justa causa',
  'Dispensa com justa causa',
  'Fim de contrato',
  'Acordo entre as partes',
  'Abandono de emprego',
  'Parou de ser chamado (sem carteira)',
];

export function tiposDoMomento(m: MomentoDoc): TipoDoc[] {
  return m === 'admissao' ? DOCS_ADMISSAO : DOCS_DESLIGAMENTO;
}

export function tipoValido(m: MomentoDoc, tipo: string): boolean {
  return tiposDoMomento(m).some((t) => t.tipo === tipo);
}

export function rotuloTipo(tipo: string): string {
  return [...DOCS_ADMISSAO, ...DOCS_DESLIGAMENTO].find((t) => t.tipo === tipo)?.rotulo ?? tipo;
}

/** Quem tem carteira: empresa de registro preenchida ou regime CLT. */
export function temCarteira(p: { empresaRegistro: string | null; regimeSalarial: string | null }): boolean {
  return !!p.empresaRegistro || p.regimeSalarial === 'clt_mensal';
}

/** Tipos obrigatórios que ainda não têm arquivo. */
export function faltando(m: MomentoDoc, carteira: boolean, tiposComArquivo: Set<string>): TipoDoc[] {
  return tiposDoMomento(m).filter((t) => (carteira ? t.clt : t.semCarteira) && !tiposComArquivo.has(t.tipo));
}

export function extensaoDoc(nome: string): string {
  return (nome.split('.').pop() ?? '').toLowerCase();
}

export function pastaDocRh(filialId: string): string {
  return `rh-documentos/${filialId}`;
}
