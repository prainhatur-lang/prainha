package com.concilia.garcom

import android.content.Context

/**
 * REDE (Itaú) — Laranjinha Smart (Positivo L400, Android). ENCAIXE pronto:
 * mesma superfície da Cielo (`Lio`), mas o SDK de pagamento da Rede NÃO é
 * público — vem pelo onboarding de parceiro (equipe de integrações da Rede),
 * junto com a Rede Store (distribuição) e a homologação obrigatória.
 *
 * Enquanto o SDK não está no projeto, tudo aqui responde com uma mensagem
 * clara em vez de travar: a filial pode estar marcada como Rede no Concilia
 * sem quebrar o app. Quando o SDK chegar: (1) dependência no build.gradle,
 * (2) implementar bind/cobrar/imprimir/vendasDoTerminal aqui, (3) homologar.
 */
object Rede {
    private const val AVISO = "Módulo Rede ainda não instalado neste app — aguardando SDK/homologação da Rede"

    fun configured(): Boolean = false
    val pronto: Boolean get() = false

    fun bind(context: Context, onReady: () -> Unit, onError: (Throwable) -> Unit) {
        // Sem SDK não há serviço pra amarrar; avisa e segue (o app abre, só não cobra).
        onError(IllegalStateException(AVISO))
    }
    fun unbind() {}

    fun vendasDoTerminal(): List<Lio.VendaTerminal>? = null

    fun cobrar(
        ref: String, linhas: List<Lio.Linha>, valorCentavos: Long,
        onInicio: () -> Unit,
        onPago: (lioOrderId: String, pagamentos: List<Lio.PagamentoLio>) -> Unit,
        onCancelado: () -> Unit,
        onErro: (mensagem: String) -> Unit,
    ) { onErro(AVISO) }

    fun imprimirBlocos(context: Context, blocos: List<Lio.Bloco>, onOk: () -> Unit, onErro: (mensagem: String) -> Unit) {
        onErro(AVISO)
    }
}
