package com.concilia.garcom

import android.content.Context

/**
 * Camada de ADQUIRENTE da maquininha. O app não fala com o SDK direto: fala
 * com `Pagamento`, que delega pra Cielo (`Lio`, o que existe e está homologado)
 * ou pra Rede (`Rede`, Laranjinha Smart — encaixe pronto pro SDK deles), conforme
 * a filial escolheu no Concilia (Configurações → Filiais → "Adquirente da
 * maquininha", que chega pelo /api/config e fica em Session.adquirente).
 *
 * Os TIPOS (Lio.Bloco/Linha/PagamentoLio/VendaTerminal) são compartilhados —
 * são só dados; o que muda por adquirente é o comportamento.
 */
object Pagamento {
    private fun rede(ctx: Context) = Session.adquirente(ctx) == "rede"
    /** Sem Context (chamadas antigas): usa a última escolha vista. */
    @Volatile private var ultimaEhRede: Boolean = false
    fun lembrar(ctx: Context) { ultimaEhRede = rede(ctx) }

    fun configured(): Boolean = if (ultimaEhRede) Rede.configured() else Lio.configured()
    val pronto: Boolean get() = if (ultimaEhRede) Rede.pronto else Lio.pronto

    fun bind(context: Context, onReady: () -> Unit, onError: (Throwable) -> Unit) {
        lembrar(context)
        if (rede(context)) Rede.bind(context, onReady, onError) else Lio.bind(context, onReady, onError)
    }
    fun unbind() { if (ultimaEhRede) Rede.unbind() else Lio.unbind() }

    fun vendasDoTerminal(): List<Lio.VendaTerminal>? =
        if (ultimaEhRede) Rede.vendasDoTerminal() else Lio.vendasDoTerminal()

    fun cobrar(
        ref: String, linhas: List<Lio.Linha>, valorCentavos: Long,
        onInicio: () -> Unit,
        onPago: (lioOrderId: String, pagamentos: List<Lio.PagamentoLio>) -> Unit,
        onCancelado: () -> Unit,
        onErro: (mensagem: String) -> Unit,
    ) {
        if (ultimaEhRede) Rede.cobrar(ref, linhas, valorCentavos, onInicio, onPago, onCancelado, onErro)
        else Lio.cobrar(ref, linhas, valorCentavos, onInicio, onPago, onCancelado, onErro)
    }

    fun imprimirBlocos(context: Context, blocos: List<Lio.Bloco>, onOk: () -> Unit, onErro: (mensagem: String) -> Unit) {
        if (rede(context)) Rede.imprimirBlocos(context, blocos, onOk, onErro)
        else Lio.imprimirBlocos(context, blocos, onOk, onErro)
    }
}
