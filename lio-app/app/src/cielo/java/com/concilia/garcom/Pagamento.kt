package com.concilia.garcom

import android.content.Context

/**
 * BUILD CIELO (flavor `cielo`): roda na maquininha DA CIELO (LIO/DX8000) e usa
 * o SDK da Cielo (`Lio`). A máquina define o SDK — este build nunca "vira" Rede.
 * As telas só conhecem `Pagamento`; o flavor `rede` tem o seu próprio.
 */
object Pagamento {
    /** Carimbado em cada recebimento (/api/lio/pagar) pra o caixa/conciliação
     *  saberem de qual adquirente veio a transação. */
    const val ADQUIRENTE = "cielo"

    fun configured(): Boolean = Lio.configured()
    val pronto: Boolean get() = Lio.pronto
    fun bind(context: Context, onReady: () -> Unit, onError: (Throwable) -> Unit) = Lio.bind(context, onReady, onError)
    fun unbind() = Lio.unbind()
    fun vendasDoTerminal(): List<VendaTerminal>? = Lio.vendasDoTerminal()
    fun cobrar(
        ref: String, linhas: List<Linha>, valorCentavos: Long,
        onInicio: () -> Unit,
        onPago: (lioOrderId: String, pagamentos: List<PagamentoLio>) -> Unit,
        onCancelado: () -> Unit,
        onErro: (mensagem: String) -> Unit,
    ) = Lio.cobrar(ref, linhas, valorCentavos, onInicio, onPago, onCancelado, onErro)
    fun imprimirBlocos(context: Context, blocos: List<Bloco>, onOk: () -> Unit, onErro: (mensagem: String) -> Unit) =
        Lio.imprimirBlocos(context, blocos, onOk, onErro)
}
