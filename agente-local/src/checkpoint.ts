// Checkpoint local: ultimo CODIGO de PAGAMENTOS sincronizado.
// Salva em arquivo JSON para nao perder ao reiniciar o servico.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface CheckpointData {
  ultimoCodigo: number;
  ultimaSincronizacao: string | null;
  totalSincronizados: number;
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
      return { ultimoCodigo: 0, ultimaSincronizacao: null, totalSincronizados: 0 };
    }
    try {
      const raw = readFileSync(this.path, 'utf8');
      return JSON.parse(raw) as CheckpointData;
    } catch {
      return { ultimoCodigo: 0, ultimaSincronizacao: null, totalSincronizados: 0 };
    }
  }

  get(): CheckpointData {
    return { ...this.data };
  }

  update(novoUltimo: number, qtdNova: number): void {
    if (novoUltimo > this.data.ultimoCodigo) this.data.ultimoCodigo = novoUltimo;
    this.data.ultimaSincronizacao = new Date().toISOString();
    this.data.totalSincronizados += qtdNova;
    writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf8');
  }
}
