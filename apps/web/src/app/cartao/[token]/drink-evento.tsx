// Drink de boas-vindas de EVENTO (@/lib/eventos). Não tem baixa aqui: o drink
// sai pelo "Avalie e ganhe um drink" do QR da mesa — a pessoa avalia a casa,
// escolhe o drink e ele entra na conta a R$ 0. O cartão só avisa.
// A avaliação roda no servidor da loja: o celular precisa estar no Wi-Fi do bar.

export function DrinkEvento({ evento, daCasa }: { evento: string; daCasa: string }) {
  return (
    <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 shadow-sm">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-amber-700">{evento}</div>
      <div className="mt-0.5 text-lg font-bold text-slate-900">Drink de boas-vindas</div>
      <p className="mt-1 text-sm text-slate-600">
        Ao chegar, conecte-se ao Wi-Fi {daCasa}, aponte a câmera para o QR Code da sua mesa, avalie a casa e
        escolha o seu drink. Ele vai direto para a mesa, por nossa conta.
      </p>
    </div>
  );
}
