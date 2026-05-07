'use client';

export function BotaoBaixar() {
  return (
    <a
      href="/api/agente-release/atualizar.ps1"
      download
      className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
    >
      📥 Baixar atualizador (.ps1)
    </a>
  );
}
