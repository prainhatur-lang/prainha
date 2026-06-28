// Armazenamento LOCAL das sessões do pátio (local-first).
// Roda no servidor interno (PC do Firebird). Guarda as sessões num JSON e as
// fotos em arquivo. A operação (entrar/validar/sair) NUNCA depende de internet;
// o sync pra nuvem (concilia) é uma camada de cima, best-effort.
//
// Volume: só sessões ABERTAS + recentes ficam aqui (as fechadas+sincronizadas
// são podadas), então o arquivo fica pequeno.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export type StatusSessao = 'aberta' | 'validada' | 'saiu' | 'cancelada';

export interface Sessao {
  id: string;
  placa: string | null;
  confianca: number | null;
  nomeCadastro: string | null;
  status: StatusSessao;
  entradaEm: string; // ISO
  entradaCameraId?: string;
  entradaFotoG6?: string; // nome do arquivo em fotos/
  entradaFotoFacial?: string;
  // validação
  validadaEm?: string;
  validacaoTipo?: 'cortesia' | 'pago';
  valorCobradoCentavos?: number;
  toleranciaSaidaAte?: string;
  // saída
  saidaEm?: string;
  saidaFotoG6?: string;
  saidaFotoFacial?: string;
  observacao?: string;
  // controle de sync
  sincronizado: boolean;
  atualizadoEm: string;
}

export class Store {
  private dir: string;
  private fotosDir: string;
  private arquivo: string;
  private sessoes: Map<string, Sessao> = new Map();

  constructor(dataDir: string) {
    this.dir = resolve(dataDir);
    this.fotosDir = resolve(this.dir, 'fotos');
    this.arquivo = resolve(this.dir, 'sessoes.json');
    mkdirSync(this.fotosDir, { recursive: true });
    this.carregar();
  }

  private carregar() {
    if (!existsSync(this.arquivo)) return;
    try {
      const raw = readFileSync(this.arquivo, 'utf8');
      const arr = JSON.parse(raw) as Sessao[];
      for (const s of arr) this.sessoes.set(s.id, s);
    } catch {
      // arquivo corrompido — começa vazio (não trava a operação)
    }
  }

  private persistir() {
    const arr = [...this.sessoes.values()];
    const tmp = this.arquivo + '.tmp';
    writeFileSync(tmp, JSON.stringify(arr, null, 0));
    writeFileSync(this.arquivo, JSON.stringify(arr, null, 0));
  }

  get fotosPath() {
    return this.fotosDir;
  }

  /** Salva um JPEG em fotos/ e devolve o nome do arquivo. */
  salvarFoto(buf: Buffer, prefixo: string): string {
    const nome = `${prefixo}-${randomUUID()}.jpg`;
    writeFileSync(resolve(this.fotosDir, nome), buf);
    return nome;
  }

  criarEntrada(dados: Partial<Sessao>): Sessao {
    const agora = new Date().toISOString();
    const s: Sessao = {
      id: randomUUID(),
      placa: dados.placa ?? null,
      confianca: dados.confianca ?? null,
      nomeCadastro: dados.nomeCadastro ?? null,
      status: 'aberta',
      entradaEm: agora,
      entradaCameraId: dados.entradaCameraId,
      entradaFotoG6: dados.entradaFotoG6,
      entradaFotoFacial: dados.entradaFotoFacial,
      sincronizado: false,
      atualizadoEm: agora,
    };
    this.sessoes.set(s.id, s);
    this.persistir();
    return s;
  }

  atualizar(id: string, patch: Partial<Sessao>): Sessao | null {
    const s = this.sessoes.get(id);
    if (!s) return null;
    Object.assign(s, patch, { sincronizado: false, atualizadoEm: new Date().toISOString() });
    this.persistir();
    return s;
  }

  get(id: string): Sessao | undefined {
    return this.sessoes.get(id);
  }

  /** Sessão ABERTA mais recente de uma placa (pra casar a saída / evitar duplicar). */
  abertaPorPlaca(placa: string): Sessao | undefined {
    let achada: Sessao | undefined;
    for (const s of this.sessoes.values()) {
      if (s.placa === placa && (s.status === 'aberta' || s.status === 'validada')) {
        if (!achada || s.entradaEm > achada.entradaEm) achada = s;
      }
    }
    return achada;
  }

  /** Sessões "dentro do pátio" (aberta/validada), mais recente primeiro. */
  noPatio(): Sessao[] {
    return [...this.sessoes.values()]
      .filter((s) => s.status === 'aberta' || s.status === 'validada')
      .sort((a, b) => (a.entradaEm < b.entradaEm ? 1 : -1));
  }

  /** Não-sincronizadas (pro sync pra nuvem). */
  pendentesSync(): Sessao[] {
    return [...this.sessoes.values()].filter((s) => !s.sincronizado);
  }
}
