package com.concilia.garcom

import android.content.Context

/**
 * BUILD REDE (flavor `rede`): roda na maquininha DA REDE (Laranjinha Smart /
 * Positivo L400) e usa o SDK da Rede (`Rede`). Mesmas telas do build Cielo —
 * só este objeto muda. Enquanto o SDK da Rede não chega, `Rede` avisa e não
 * cobra; o resto do app (mesas, itens, conta, cupom, caixa) já funciona.
 */
object Pagamento {
    const val ADQUIRENTE = "rede"

    fun configured(): Boolean = Rede.configured()
    val pronto: Boolean get() = Rede.pronto
    fun bind(context: Context, onReady: () -> Unit, onError: (Throwable) -> Unit) = Rede.bind(context, onReady, onError)
    fun unbind() = Rede.unbind()
    fun vendasDoTerminal(): List<VendaTerminal>? = Rede.vendasDoTerminal()
    fun cobrar(
        ref: String, linhas: List<Linha>, valorCentavos: Long,
        onInicio: () -> Unit,
        onPago: (lioOrderId: String, pagamentos: List<PagamentoLio>) -> Unit,
        onCancelado: () -> Unit,
        onErro: (mensagem: String) -> Unit,
    ) = Rede.cobrar(ref, linhas, valorCentavos, onInicio, onPago, onCancelado, onErro)
    fun imprimirBlocos(context: Context, blocos: List<Bloco>, onOk: () -> Unit, onErro: (mensagem: String) -> Unit) =
        Rede.imprimirBlocos(context, blocos, onOk, onErro)
}
