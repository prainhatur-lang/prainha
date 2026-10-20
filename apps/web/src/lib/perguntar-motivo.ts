// Lado cliente: pede o motivo antes de excluir (vai pro registro_exclusao).

/** Pergunta o motivo no navegador (lado cliente). null = desistiu. */
export function perguntarMotivo(oQue: string): string | null {
  for (;;) {
    const m = window.prompt(`Motivo da exclusão de ${oQue}:\n(fica registrado com seu usuário, data e hora)`);
    if (m == null) return null;
    if (m.trim().length >= 3) return m.trim();
    window.alert('Escreva o motivo (pelo menos 3 letras).');
  }
}
