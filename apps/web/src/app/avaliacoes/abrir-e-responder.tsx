'use client';

// Botão do card do TripAdvisor: abre a avaliação numa aba nova (pra copiar o
// texto do cliente) e prepara o quadro "Responder com IA" com a casa e o link,
// que depois vira o "Copiar e abrir a avaliação". O texto quem copia é a pessoa,
// da página pública — o contrato da API do TripAdvisor não deixa ir pra IA.

export function AbrirEResponder({ filialId, url }: { filialId: string; url: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        window.open(url, '_blank', 'noopener');
        window.location.hash = `responder-ia:${filialId}:${encodeURIComponent(url)}`;
      }}
      className="ml-3 mt-1 inline-block text-xs font-semibold text-sky-700 hover:underline"
      title="Abre a avaliação no TripAdvisor: copie o texto do cliente, volte aqui e clique em 📋 Colar e escrever"
    >
      ⚡ abrir e responder
    </button>
  );
}
