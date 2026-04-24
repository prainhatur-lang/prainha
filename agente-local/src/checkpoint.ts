// Checkpoint local: ultimos CODIGO sincronizados por entidade.
// Salva em arquivo JSON para nao perder ao reiniciar o servico.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Entidades que o agente sincroniza do Consumer. */
export type EntidadeSync =
  | 'pagamentos'
  | 'fornecedores'
  | 'categorias'
  | 'contasBancarias'
  | 'contasPagar';

export interface CheckpointData {
  /** Compat com versao antiga — ultimoCodigo de pagamentos. */
  ultimoCodigo: number;
  ultimaSincronizacao: string | null;
  totalSincronizados: number;
  /** Checkpoints por entidade (novo formato). */
  porEntidade?: Partial<Record<EntidadeSync, { ultimoCodigo: number; total: number }>>;
}

export class Checkpoint {
  private path: string;
  private data: CheckpointData;

  constructor(file: string) {
    this.path = resolve(process.cwd(), file);
    this.data = this.load();
  }

  private load(): CheckpointData {
    if (!existsSync(this.path)) {
      return { ultimoCodigo: 0, ultimaSincronizacao: null, totalSincronizados: 0, porEntidade: {} };
    }
    try {
      const raw = readFileSync(this.path, 'utf8');
      const parsed = JSON.parse(raw) as CheckpointData;
      if (!parsed.porEntidade) parsed.porEntidade = {};
      return parsed;
    } catch {
      return { ultimoCodigo: 0, ultimaSincronizacao: null, totalSincronizados: 0, porEntidade: {} };
    }
  }

  private save() {
    writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf8');
  }

  get(): CheckpointData {
    return { ...this.data };
  }

  /** Ultimo codigo de uma entidade. Pagamentos usa ultimoCodigo antigo pra compat. */
  getUltimoCodigo(entidade: EntidadeSync): number {
    if (entidade === 'pagamentos') {
      return this.data.porEntidade?.pagamentos?.ultimoCodigo ?? this.data.ultimoCodigo ?? 0;
    }
    return this.data.porEntidade?.[entidade]?.ultimoCodigo ?? 0;
  }

  /** Atualiza pagamentos (mantem compat com campos antigos). */
  update(novoUltimo: number, qtdNova: number): void {
    if (novoUltimo > this.data.ultimoCodigo) this.data.ultimoCodigo = novoUltimo;
    this.data.ultimaSincronizacao = new Date().toISOString();
    this.data.totalSincronizados += qtdNova;
    this.data.porEntidade ??= {};
    const prev = this.data.porEntidade.pagamentos ?? { ultimoCodigo: 0, total: 0 };
    this.data.porEntidade.pagamentos = {
      ultimoCodigo: Math.max(prev.ultimoCodigo, novoUltimo),
      total: prev.total + qtdNova,
    };
    this.save();
  }

  /** Atualiza entidade financeira. */
  updateEntidade(entidade: EntidadeSync, novoUltimo: number, qtdNova: number): void {
    this.data.porEntidade ??= {};
    const prev = this.data.porEntidade[entidade] ?? { ultimoCodigo: 0, total: 0 };
    this.data.porEntidade[entidade] = {
      ultimoCodigo: Math.max(prev.ultimoCodigo, novoUltimo),
      total: prev.total + qtdNova,
    };
    this.data.ultimaSincronizacao = new Date().toISOString();
    this.save();
  }
}
