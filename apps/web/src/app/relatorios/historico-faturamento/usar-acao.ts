'use client';

// Um jeito só de chamar as rotas da aba a partir dos cartões de lançar e
// corrigir: trava o botão, guarda o erro e, se gravou, pede os números de novo.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { chamar, telaVelha, type Rota } from './cliente';

export function useAcao() {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /** true = gravou (e a tela já pediu os números novos ao servidor). */
  async function rodar(rota: Rota, corpo: Record<string, unknown>): Promise<boolean> {
    setOcupado(true);
    setErro(null);
    const r = await chamar(rota, corpo);
    // Aba trancada ou login vencido no meio do caminho: a tela inteira está velha.
    if (telaVelha(r)) {
      window.location.reload();
      return false;
    }
    setOcupado(false);
    if (!r.ok) {
      setErro(r.erro);
      return false;
    }
    router.refresh();
    return true;
  }

  return { ocupado, erro, setErro, rodar };
}
