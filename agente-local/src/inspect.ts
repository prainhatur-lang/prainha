// Inspector do Firebird: conecta usando as mesmas credenciais do agente,
// extrai lista de tabelas + colunas + amostras, grava JSON em disco.
//
// Uso: `node inspect.cjs` no diretório onde tem o config.json do agente.
// Gera: firebird-inspect.json
//
// Envia o arquivo pro chat e pronto.

import Firebird from 'node-firebird';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, type Config } from './config';

interface TabelaDump {
  nome: string;
  colunas: Array<{ nome: string; tipo: string; nullable: boolean }>;
  totalLinhas: number | null;
  amostra: Record<string, unknown>[];
  erro?: string;
}

interface Dump {
  geradoEm: string;
  host: string;
  database: string;
  totalTabelas: number;
  tabelas: TabelaDump[];
}

function queryOne<T = Record<string, unknown>>(
  cfg: Config,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const opts: Firebird.Options = {
    host: cfg.firebird.host,
    port: cfg.firebird.port,
    database: cfg.firebird.database,
    user: cfg.firebird.user,
    password: cfg.firebird.password,
    lowercase_keys: false,
    pageSize: 4096,
  };
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      fn();
    };
    Firebird.attach(opts, (err, db) => {
      if (err) return finish(() => reject(err));
      db.query(sql, params, (e, rows) => {
        finish(() => (e ? reject(e) : resolve((rows as T[]) ?? [])));
        try {
          db.detach(() => {});
        } catch {}
      });
    });
    setTimeout(() => finish(() => reject(new Error('timeout 30s'))), 30_000);
  });
}

// Converte Buffer/Date/Number retornado pelo node-firebird em algo
// serializável em JSON. Strings em Buffer (latin1) viram string.
function normalizar(v: unknown): unknown {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) {
    // heurística: se for imprimível como utf8, entrega como string
    const s = v.toString('utf8');
    return /^[\x20-\x7E\s]+$/.test(s) ? s : `<binary ${v.length}b>`;
  }
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k.trim()] = normalizar(val);
    }
    return out;
  }
  if (typeof v === 'string') return v.trim() || null;
  return v;
}

async function main() {
  console.log('carregando config...');
  const cfg = loadConfig();
  console.log(`  host=${cfg.firebird.host} db=${cfg.firebird.database}`);

  console.log('\nlistando tabelas de usuário...');
  const tabelasRaw = await queryOne<{ RDB$RELATION_NAME: string }>(
    cfg,
    `SELECT TRIM(RDB$RELATION_NAME) AS "RDB$RELATION_NAME"
     FROM RDB$RELATIONS
     WHERE RDB$SYSTEM_FLAG = 0
       AND RDB$VIEW_BLR IS NULL
     ORDER BY RDB$RELATION_NAME`,
  );
  const nomes = tabelasRaw.map((t) => String(t['RDB$RELATION_NAME']).trim());
  console.log(`  encontradas ${nomes.length} tabelas`);

  const tabelas: TabelaDump[] = [];

  for (let i = 0; i < nomes.length; i++) {
    const nome = nomes[i]!;
    process.stdout.write(`[${i + 1}/${nomes.length}] ${nome}... `);
    const dump: TabelaDump = {
      nome,
      colunas: [],
      totalLinhas: null,
      amostra: [],
    };

    try {
      // Colunas + tipos (via RDB$FIELDS)
      const cols = await queryOne<{
        NOME: string;
        TIPO: number;
        SUBTIPO: number | null;
        TAMANHO: number | null;
        ESCALA: number | null;
        PRECISAO: number | null;
        NULLABLE: string | number | null;
      }>(
        cfg,
        `SELECT
           TRIM(rf.RDB$FIELD_NAME) AS NOME,
           f.RDB$FIELD_TYPE AS TIPO,
           f.RDB$FIELD_SUB_TYPE AS SUBTIPO,
           f.RDB$FIELD_LENGTH AS TAMANHO,
           f.RDB$FIELD_SCALE AS ESCALA,
           f.RDB$FIELD_PRECISION AS PRECISAO,
           rf.RDB$NULL_FLAG AS NULLABLE
         FROM RDB$RELATION_FIELDS rf
         JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = rf.RDB$FIELD_SOURCE
         WHERE rf.RDB$RELATION_NAME = ?
         ORDER BY rf.RDB$FIELD_POSITION`,
        [nome],
      );
      dump.colunas = cols.map((c) => ({
        nome: String(c.NOME).trim(),
        tipo: tipoFirebird(c.TIPO, c.SUBTIPO, c.TAMANHO, c.ESCALA, c.PRECISAO),
        nullable: c.NULLABLE !== '1' && c.NULLABLE !== 1,
      }));

      // Total + amostra (só se tiver colunas)
      if (dump.colunas.length > 0) {
        const [cnt] = await queryOne<{ N: number }>(
          cfg,
          `SELECT COUNT(*) AS N FROM "${nome}"`,
        );
        dump.totalLinhas = Number(cnt?.N ?? 0);

        if (dump.totalLinhas > 0) {
          const sample = await queryOne(
            cfg,
            `SELECT FIRST 3 * FROM "${nome}"`,
          );
          dump.amostra = sample.map((r) => normalizar(r) as Record<string, unknown>);
        }
      }

      console.log(`${dump.colunas.length} cols, ${dump.totalLinhas ?? 0} linhas`);
    } catch (e) {
      dump.erro = (e as Error).message;
      console.log(`ERRO: ${dump.erro}`);
    }

    tabelas.push(dump);
  }

  const out: Dump = {
    geradoEm: new Date().toISOString(),
    host: cfg.firebird.host,
    database: cfg.firebird.database,
    totalTabelas: tabelas.length,
    tabelas,
  };

  const path = resolve(process.cwd(), 'firebird-inspect.json');
  writeFileSync(path, JSON.stringify(out, null, 2), 'utf8');

  console.log(`\n✓ ${tabelas.length} tabelas dumpadas em ${path}`);
  console.log(`  tamanho: ${Math.round(Buffer.byteLength(JSON.stringify(out)) / 1024)}KB`);
  console.log('\nEnvie o arquivo firebird-inspect.json no chat.');
}

// Mapeia tipos numéricos do Firebird pra string legível
function tipoFirebird(
  tipo: number,
  subtipo: number | null,
  tamanho: number | null,
  escala: number | null,
  precisao: number | null,
): string {
  const s = subtipo ?? 0;
  switch (tipo) {
    case 7:
      return 'SMALLINT';
    case 8:
      return escala && escala < 0 && precisao ? `NUMERIC(${precisao},${-escala})` : 'INTEGER';
    case 9:
      return 'QUAD';
    case 10:
      return 'FLOAT';
    case 11:
      return 'D_FLOAT';
    case 12:
      return 'DATE';
    case 13:
      return 'TIME';
    case 14:
      return `CHAR(${tamanho ?? 0})`;
    case 16:
      return escala && escala < 0 && precisao
        ? `NUMERIC(${precisao},${-escala})`
        : 'BIGINT';
    case 23:
      return 'BOOLEAN';
    case 27:
      return 'DOUBLE PRECISION';
    case 35:
      return 'TIMESTAMP';
    case 37:
      return `VARCHAR(${tamanho ?? 0})`;
    case 261:
      return s === 1 ? 'BLOB (text)' : 'BLOB';
    default:
      return `TIPO_${tipo}${s ? ':' + s : ''}`;
  }
}

main().catch((e) => {
  console.error('\nERRO FATAL:', e);
  process.exit(1);
});
