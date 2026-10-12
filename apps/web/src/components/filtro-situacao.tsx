// Filtro de situação das listas de cadastro (Ativos / Inativos / Todos), com a
// contagem de cada um e a cor: verde ativo, vermelho inativo. Pedido do dono em
// 12/10/2026: toda lista que guarda inativo/excluído tem que ter filtro.
import Link from 'next/link';

export type SituacaoFiltro = 'ativos' | 'inativos' | 'todos';

/** Lê ?situacao= ; o endereço antigo ?incluirInativos=1 continua valendo como "todos". */
export function lerSituacao(sp: { situacao?: string; incluirInativos?: string }): SituacaoFiltro {
  if (sp.situacao === 'inativos' || sp.situacao === 'todos' || sp.situacao === 'ativos') return sp.situacao;
  return sp.incluirInativos === '1' ? 'todos' : 'ativos';
}

export function filtrarSituacao<T extends { ativo: boolean }>(lista: T[], s: SituacaoFiltro): T[] {
  if (s === 'ativos') return lista.filter((x) => x.ativo);
  if (s === 'inativos') return lista.filter((x) => !x.ativo);
  // todos: ativos primeiro, mantendo a ordem de cada grupo
  return [...lista.filter((x) => x.ativo), ...lista.filter((x) => !x.ativo)];
}

const OPCOES: { id: SituacaoFiltro; rotulo: string; bola?: string }[] = [
  { id: 'ativos', rotulo: 'Ativos', bola: 'bg-emerald-500' },
  { id: 'inativos', rotulo: 'Inativos', bola: 'bg-red-500' },
  { id: 'todos', rotulo: 'Todos' },
];

const classe = (sel: boolean) =>
  `flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
    sel ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
  }`;

/**
 * Botões do filtro. Com `hrefBase` (ex.: "/cadastros/x?filialId=1") vira link e
 * a página recarrega; com `onMudar` vira botão, pra tela que filtra no navegador.
 */
export function FiltroSituacao(p: {
  atual: SituacaoFiltro;
  ativos: number;
  inativos: number;
  hrefBase?: string;
  onMudar?: (s: SituacaoFiltro) => void;
}) {
  const n: Record<SituacaoFiltro, number> = {
    ativos: p.ativos,
    inativos: p.inativos,
    todos: p.ativos + p.inativos,
  };
  return (
    <div className="flex flex-wrap gap-2">
      {OPCOES.map((o) => {
        const dentro = (
          <>
            {o.bola && <span className={`h-2 w-2 rounded-full ${o.bola}`} />}
            {o.rotulo} ({n[o.id]})
          </>
        );
        if (p.hrefBase) {
          const sep = p.hrefBase.includes('?') ? '&' : '?';
          return (
            <Link key={o.id} href={`${p.hrefBase}${sep}situacao=${o.id}`} className={classe(p.atual === o.id)}>
              {dentro}
            </Link>
          );
        }
        return (
          <button key={o.id} type="button" onClick={() => p.onMudar?.(o.id)} className={classe(p.atual === o.id)}>
            {dentro}
          </button>
        );
      })}
    </div>
  );
}
