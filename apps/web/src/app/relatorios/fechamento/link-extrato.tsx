// Link de baixar um extrato do Fechamento (mês e grade do ano).
// Planilha (.xls/.xlsx/.ods) ganha também a versão CSV ao lado — a rota
// converte na hora (?formato=csv). Pro contador de fora (grupo só "Contador")
// a planilha sai SÓ em CSV: dono, 19/10/2026, "retirar ... a opção para baixar
// os dados em excel" / "os extratos ele quer baixar em CSV". PDF/OFX seguem iguais.

import { ehPlanilhaExtrato, nomeCsvExtrato } from '@/lib/extrato-planilha';

const CLASSE = 'break-all font-medium text-sky-700 underline decoration-sky-300 hover:text-sky-900';

export function LinkExtrato({ id, nome, soContador }: { id: string; nome: string; soContador: boolean }) {
  const href = `/api/extratos-fechamento/arquivos/${id}`;
  if (!ehPlanilhaExtrato(nome)) {
    return (
      <a href={href} className={CLASSE}>
        ⬇ {nome}
      </a>
    );
  }
  if (soContador) {
    return (
      <a href={`${href}?formato=csv`} className={CLASSE}>
        ⬇ {nomeCsvExtrato(nome)}
      </a>
    );
  }
  return (
    <>
      <a href={href} className={CLASSE}>
        ⬇ {nome}
      </a>
      <a href={`${href}?formato=csv`} className="font-medium text-sky-700 underline decoration-sky-300 hover:text-sky-900">
        CSV
      </a>
    </>
  );
}
