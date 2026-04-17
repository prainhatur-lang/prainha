// Cliente Firebird: abre uma conexao por operacao para evitar
// bug do node-firebird que crasha apos reusar conexao com FB 4.

import Firebird from 'node-firebird';
import type { PagamentoIngest } from '@concilia/shared';

import type { Config } from './config';

const SQL = `
  SELECT FIRST ? p.CODIGO,
         p.CODIGOPEDIDO,
         p.VALOR,
         p.PERCENTUALTAXA,
         p.DATAPAGAMENTO,
         p.DATACREDITO,
         p.NSUTRANSACAO,
         p.NUMEROAUTORIZACAOCARTAO,
         p.BANDEIRAMFE,
         p.ADQUIRENTEMFE,
         p.NROPARCELA,
         p.CODIGOCREDENCIADORACARTAO,
         p.CODIGOCONTACORRENTE,
         TRIM(fp.DESCRICAO) AS FORMA
  FROM PAGAMENTOS p
  LEFT JOIN FORMASPAGAMENTO fp ON fp.CODIGO = p.CODIGOFORMAPAGAMENTO
  WHERE p.DATADELETE IS NULL
    AND p.CODIGO > ?
  ORDER BY p.CODIGO
`;

interface PagamentoRow {
  CODIGO: number;
  CODIGOPEDIDO: number | null;
  VALOR: number | null;
  PERCENTUALTAXA: number | null;
  DATAPAGAMENTO: Date | null;
  DATACREDITO: Date | null;
  NSUTRANSACAO: number | string | null;
  NUMEROAUTORIZACAOCARTAO: string | null;
  BANDEIRAMFE: string | null;
  ADQUIRENTEMFE: string | null;
  NROPARCELA: number | null;
  CODIGOCREDENCIADORACARTAO: number | null;
  CODIGOCONTACORRENTE: number | null;
  FORMA: string | null;
}

export function buscarPagamentos(
  cfg: Config,
  desdeCodigo: number,
  limite: number,
): Promise<PagamentoIngest[]> {
  const opts: Firebird.Options = {
    host: cfg.firebird.host,
    port: cfg.firebird.port,
    database: cfg.firebird.database,
    user: cfg.firebird.user,
    password: cfg.firebird.password,
    lowercase_keys: false,
    pageSize: 4096,
  };

  return new Promise<PagamentoIngest[]>((resolve, reject) => {
    Firebird.attach(opts, (err: Error | null, db: Firebird.Database) => {
      if (err) return reject(err);
      db.query(SQL, [limite, desdeCodigo], (e: Error | null, rows: PagamentoRow[]) => {
        if (e) {
          db.detach(() => {
            // ignora erro de detach apos query falhar
          });
          return reject(e);
        }
        const out: PagamentoIngest[] = rows.map((r) => ({
          codigoExterno: r.CODIGO,
          codigoPedidoExterno: r.CODIGOPEDIDO,
          formaPagamento: r.FORMA,
          valor: r.VALOR ?? 0,
          percentualTaxa: r.PERCENTUALTAXA,
          dataPagamento: r.DATAPAGAMENTO ? r.DATAPAGAMENTO.toISOString() : null,
          dataCredito: r.DATACREDITO ? r.DATACREDITO.toISOString() : null,
          nsuTransacao: r.NSUTRANSACAO !== null ? String(r.NSUTRANSACAO) : null,
          numeroAutorizacaoCartao: r.NUMEROAUTORIZACAOCARTAO,
          bandeiraMfe: r.BANDEIRAMFE,
          adquirenteMfe: r.ADQUIRENTEMFE,
          nroParcela: r.NROPARCELA,
          codigoCredenciadoraCartao: r.CODIGOCREDENCIADORACARTAO,
          codigoContaCorrente: r.CODIGOCONTACORRENTE,
        }));
        // Resolve PRIMEIRO: o detach do node-firebird tem bug com FB 4
        // (uncaughtException com pluginName undefined) que pode deixar
        // este Promise preso pra sempre. Resolvendo antes garantimos
        // que o caller continua, mesmo que o detach exploda depois.
        resolve(out);
        try {
          db.detach(() => {
            // ignora qualquer erro - conexao sera GC-coletada
          });
        } catch {
          // ignora erros sincronos no detach tambem
        }
      });
    });
  });
}
