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
    /** há cobrança deste processo esperando o aviso da maquininha? (ver Recuperacao) */
    val emCobranca: Boolean get() = Lio.emCobranca
    fun bind(context: Context, onReady: () -> Unit, onError: (Throwable) -> Unit) = Lio.bind(context, onReady, onError)
    fun unbind() = Lio.unbind()
    fun vendasDoTerminal(): List<VendaTerminal>? = Lio.vendasDoTerminal()
    fun cobrar(
        ref: String, linhas: List<Linha>, valorCentavos: Long,
        onInicio: () -> Unit,
        onPago: (lioOrderId: String, pagamentos: List<PagamentoLio>) -> Unit,
        onCancelado: () -> Unit,
        onErro: (mensagem: String) -> Unit,
        destino: org.json.JSONObject? = null,
        /** "credito" | "debito" = abre a Cielo já no cartão (casa com Pix pelo
         *  banco: o Pix não passa pela Cielo). null = menu completo, como sempre. */
        cartao: String? = null,
    ) = Lio.cobrar(ref, linhas, valorCentavos, onInicio, onPago, onCancelado, onErro, destino, cartao)
    /** O que o terminal tem gravado desse pedido (null = não deu pra saber). */
    fun consultarPedido(pedidoId: String): PedidoTerminal? = Lio.consultarPedido(pedidoId)
    /** Na demo (/api/config demo), tudo sai carimbado DEMONSTRAÇÃO (ver Demo). */
    fun imprimirBlocos(context: Context, blocos: List<Bloco>, onOk: () -> Unit, onErro: (mensagem: String) -> Unit) =
        Lio.imprimirBlocos(context, if (Session.demo(context)) Demo.marcar(blocos) else blocos, onOk, onErro)
}
