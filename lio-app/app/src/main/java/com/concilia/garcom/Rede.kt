package com.concilia.garcom

import android.content.Context

/**
 * REDE (Itaú) — Laranjinha Smart (Positivo L400). Implementação do pagamento
 * para o BUILD REDE (product flavor `rede`) — NÃO é usada no build Cielo.
 *
 * O SDK de pagamento do terminal da Rede não é público: vem pelo onboarding de
 * parceiro (equipe de integrações da Rede), junto com a Rede Store e a
 * homologação obrigatória. Quando chegar: dependência no flavor `rede` do
 * build.gradle, implementar aqui bind/cobrar/imprimir/vendasDoTerminal com a
 * MESMA superfície da `Lio`, e apontar `Pagamento` pra este objeto nesse flavor.
 *
 * Enquanto isso, é só o esqueleto documentado — não entra em nenhum fluxo.
 */
@Suppress("unused")
object Rede {
    private const val AVISO = "Build Rede sem SDK — implementar quando a Rede liberar o SDK do terminal"

    fun configured(): Boolean = false
    val pronto: Boolean get() = false
    fun bind(context: Context, onReady: () -> Unit, onError: (Throwable) -> Unit) { onError(IllegalStateException(AVISO)) }
    fun unbind() {}
    fun vendasDoTerminal(): List<Lio.VendaTerminal>? = null
    fun cobrar(
        ref: String, linhas: List<Lio.Linha>, valorCentavos: Long,
        onInicio: () -> Unit,
        onPago: (lioOrderId: String, pagamentos: List<Lio.PagamentoLio>) -> Unit,
        onCancelado: () -> Unit,
        onErro: (mensagem: String) -> Unit,
    ) { onErro(AVISO) }
    fun imprimirBlocos(context: Context, blocos: List<Lio.Bloco>, onOk: () -> Unit, onErro: (mensagem: String) -> Unit) { onErro(AVISO) }
}
