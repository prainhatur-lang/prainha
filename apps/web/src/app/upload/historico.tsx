import type { schema } from '@concilia/db';
import { brl, formatDateTime, int } from '@/lib/format';

type Arquivo = typeof schema.arquivoImportacao.$inferSelect;
type Filial = { id: string; nome: string };

const TIPO_LABELS: Record<string, string> = {
  CIELO_VENDAS: 'Cielo Vendas',
  CIELO_RECEBIVEIS: 'Cielo Recebíveis',
  CNAB240_INTER: 'CNAB Inter',
};

const STATUS_STYLES: Record<string, string> = {
  OK: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ERRO: 'bg-rose-50 text-rose-700 border-rose-200',
  PROCESSANDO: 'bg-amber-50 text-amber-700 border-amber-200',
  PENDENTE: 'bg-slate-100 text-slate-700 border-slate-200',
};

export function Historico({ arquivos, filiais }: { arquivos: Arquivo[]; filiais: Filial[] }) {
  const filMap = new Map(filiais.map((f) => [f.id, f.nome]));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Últimos arquivos</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        20 mais recentes de todas suas filiais
      </p>

      {arquivos.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">
          Nenhum arquivo enviado ainda.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {arquivos.map((a) => {
            const r = (a.resumo as Record<string, unknown> | null) ?? null;
            const periodo = r?.periodo as { de: string; ate: string } | undefined;
            const totalBruto = r?.totalBruto as number | undefined;
            const totalLiquido = r?.totalLiquido as number | undefined;
            const totalCreditos = r?.totalCreditos as number | undefined;

            return (
              <div
                key={a.id}
                className="rounded-lg border border-slate-200 p-3 text-sm hover:bg-slate-50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900" title={a.nomeOriginal}>
                      {a.nomeOriginal}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {filMap.get(a.filialId) ?? a.filialId} · {TIPO_LABELS[a.tipo] ?? a.tipo}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[a.status] ?? STATUS_STYLES.PENDENTE}`}
                  >
                    {a.status}
                  </span>
                </div>

                {a.status === 'OK' && (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                    <span>{int(a.registrosProcessados)} novos / lidos</span>
                    {periodo && (
                      <span>
                        {periodo.de} a {periodo.ate}
                      </span>
                    )}
                    {totalBruto !== undefined && <span>bruto {brl(totalBruto)}</span>}
                    {totalLiquido !== undefined && <span>líquido {brl(totalLiquido)}</span>}
                    {totalCreditos !== undefined && <span>créditos {brl(totalCreditos)}</span>}
                  </div>
                )}

                {a.status === 'ERRO' && a.erro && (
                  <p className="mt-2 text-xs text-rose-700">{a.erro}</p>
                )}

                <p className="mt-1.5 text-[11px] text-slate-400">
                  {formatDateTime(a.enviadoEm)}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
