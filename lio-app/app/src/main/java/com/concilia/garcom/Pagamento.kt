package com.concilia.garcom

import android.content.Context

/**
 * Camada de pagamento do app. ESTE BUILD É A VERSÃO CIELO — roda na maquininha
 * DA CIELO (LIO/DX8000) e usa o SDK da Cielo (`Lio`). Sempre.
 *
 * A Rede tem a MÁQUINA DELA (Laranjinha Smart) e o SDK dela: a versão Rede será
 * OUTRO BUILD deste app (product flavor `rede`, publicado na Rede Store) rodando
 * na máquina deles — NÃO é uma troca em tempo de execução. A máquina define o
 * SDK; nenhuma configuração muda isso.
 *
 * Quem diz "com quem esta filial trabalha" (Cielo ou Rede) é o CONCILIA
 * (Configurações → Filiais → Adquirente da maquininha). Isso orienta o sistema
 * (qual maquininha a loja usa, conciliação, relatórios) — não este código.
 *
 * `Pagamento` existe pra que as telas não dependam do SDK diretamente: no build
 * Rede, este mesmo objeto delega pra `Rede` em vez de `Lio`, e as telas não
 * mudam. (Lição de 03/09: uma versão anterior trocava pela config da filial e
 * derrubaria a LIO de uma loja marcada como Rede.)
 */
object Pagamento {
    fun configured(): Boolean = Lio.configured()
    val pronto: Boolean get() = Lio.pronto

    fun bind(context: Context, onReady: () -> Unit, onError: (Throwable) -> Unit) =
        Lio.bind(context, onReady, onError)
    fun unbind() = Lio.unbind()

    fun vendasDoTerminal(): List<Lio.VendaTerminal>? = Lio.vendasDoTerminal()

    fun cobrar(
        ref: String, linhas: List<Lio.Linha>, valorCentavos: Long,
        onInicio: () -> Unit,
        onPago: (lioOrderId: String, pagamentos: List<Lio.PagamentoLio>) -> Unit,
        onCancelado: () -> Unit,
        onErro: (mensagem: String) -> Unit,
    ) = Lio.cobrar(ref, linhas, valorCentavos, onInicio, onPago, onCancelado, onErro)

    fun imprimirBlocos(context: Context, blocos: List<Lio.Bloco>, onOk: () -> Unit, onErro: (mensagem: String) -> Unit) =
        Lio.imprimirBlocos(context, blocos, onOk, onErro)
}
