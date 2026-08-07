package com.concilia.garcom

import android.content.Context
import cielo.orders.domain.Credentials
import cielo.orders.domain.Order
import cielo.orders.domain.PrinterAttributes
import cielo.sdk.order.OrderManager
import cielo.sdk.order.PrinterListener
import cielo.sdk.order.ServiceBindListener
import cielo.sdk.order.payment.Payment
import cielo.sdk.order.payment.PaymentCode
import cielo.sdk.order.payment.PaymentError
import cielo.sdk.order.payment.PaymentListener
import cielo.sdk.printer.PrinterManager

// Wrapper do Order Manager SDK da Cielo — pagamento NO TERMINAL (pinpad/NFC
// da própria maquininha). É o caminho exigido pela certificação da Cielo
// Store pra apps transacionais (QR pro cliente pagar no celular REPROVA).
//
// Fluxo: bind() -> (onReady) -> cobrar(conta) -> UI nativa de pagamento da
// Cielo (cliente escolhe crédito/débito/PIX) -> onPago(pagamentos) com
// NSU/authCode/bandeira -> Api.pagar() registra no vendas-local, que grava
// no Firebird do Consumer e alimenta a conciliação com o EDI da Cielo.
//
// Credenciais: CIELO_CLIENT_ID / CIELO_ACCESS_TOKEN (Dev Console Cielo),
// injetadas via BuildConfig (secrets.properties — não commitar valores).
object Lio {

    private var orderManager: OrderManager? = null
    private var bound = false

    /** Linha da conta que vira item do pedido na LIO (visível no checkout). */
    data class Linha(val nome: String, val valorCentavos: Long)

    /** Uma transação aprovada no terminal — o que o backend precisa pra conciliar. */
    data class PagamentoLio(
        val forma: String,          // dinheiro nunca sai daqui: credito | debito | pix
        val nsu: String,
        val autorizacao: String,
        val bandeira: String,
        val mask: String,
        val terminal: String,
        val valorCentavos: Long,
        val parcelas: Int,
        val pagamentoId: String,
    )

    /** true quando as credenciais do Dev Console foram configuradas no build. */
    fun configured(): Boolean =
        BuildConfig.CIELO_CLIENT_ID.isNotBlank() && BuildConfig.CIELO_ACCESS_TOKEN.isNotBlank()

    /**
     * Conecta ao serviço de pagamento da maquininha. Chamar no onCreate da
     * Activity e aguardar onReady antes de habilitar o botão de receber.
     * onError é chamado se o serviço não existir (ex.: rodando num celular) —
     * o app segue como consulta/lançamento, sem cobrança.
     */
    fun bind(context: Context, onReady: () -> Unit, onError: (Throwable) -> Unit) {
        if (!configured()) { onError(IllegalStateException("Credenciais Cielo não configuradas")); return }
        if (bound) { onReady(); return }
        val om = OrderManager(
            Credentials(BuildConfig.CIELO_CLIENT_ID, BuildConfig.CIELO_ACCESS_TOKEN),
            context
        )
        orderManager = om
        om.bind(context, object : ServiceBindListener {
            override fun onServiceBound() { bound = true; onReady() }
            override fun onServiceBoundError(throwable: Throwable) { bound = false; onError(throwable) }
            override fun onServiceUnbound() { bound = false }
        })
    }

    /** Desconecta do serviço (chamar no onDestroy). */
    fun unbind() {
        try { if (bound) orderManager?.unbind() } catch (_: Exception) { }
        bound = false
        orderManager = null
    }

    val pronto: Boolean get() = bound

    /**
     * Dispara a cobrança NA MAQUININHA: cria o pedido com os itens REAIS da
     * conta (o certificador confere), e abre a UI nativa de pagamento da
     * Cielo — o cliente escolhe crédito/débito/PIX ali. Valor pode ser
     * PARCIAL (rachar conta): cobra-se `valorCentavos` independente do total
     * dos itens; repete-se até quitar.
     */
    fun cobrar(
        ref: String,                 // "MESA-12" / "COMANDA-301" — referência do pedido
        linhas: List<Linha>,         // itens da conta (+ serviço) pra constar no pedido
        valorCentavos: Long,         // quanto cobrar AGORA (integral ou parcial)
        onInicio: () -> Unit,
        onPago: (lioOrderId: String, pagamentos: List<PagamentoLio>) -> Unit,
        onCancelado: () -> Unit,
        onErro: (mensagem: String) -> Unit,
    ) {
        val om = orderManager
        if (om == null || !bound) { onErro("Serviço de pagamento da maquininha indisponível"); return }
        if (valorCentavos <= 0) { onErro("Valor inválido"); return }

        try {
            val order: Order? = om.createDraftOrder(ref)
            if (order == null) { onErro("Não foi possível criar o pedido na maquininha"); return }
            // addItem(sku, nome, precoUnitCentavos, quantidade, unidade) — uma
            // linha por item da conta (quantidade já consolidada no valor).
            val itens = linhas.filter { it.valorCentavos > 0 }
            if (itens.isEmpty()) {
                order.addItem("CONTA", "Conta $ref", valorCentavos, 1, "UN")
            } else {
                itens.forEachIndexed { i, l ->
                    order.addItem("ITEM-${i + 1}", l.nome.take(60), l.valorCentavos, 1, "UN")
                }
            }
            om.placeOrder(order)

            om.checkoutOrder(order.id ?: "", valorCentavos, object : PaymentListener {
                override fun onStart() { onInicio() }

                override fun onPayment(paidOrder: Order) {
                    // Fecha o pedido no catálogo da maquininha e devolve as
                    // transações (NSU/authCode/bandeira) pra baixa no backend.
                    try { paidOrder.markAsPaid(); om.updateOrder(paidOrder) } catch (_: Exception) { }
                    val pagos = try {
                        paidOrder.payments.map { toPagamento(it) }
                    } catch (_: Exception) { emptyList() }
                    onPago(paidOrder.id ?: "", pagos)
                }

                override fun onCancel() { onCancelado() }

                override fun onError(error: PaymentError) {
                    onErro(error.description ?: "Pagamento não concluído")
                }
            })
        } catch (e: Exception) {
            onErro(e.message ?: "Erro ao iniciar a cobrança na maquininha")
        }
    }

    /**
     * credito/debito/pix a partir dos códigos de produto da transação
     * (PaymentCode do SDK). O cliente escolhe na UI nativa; aqui a escolha é
     * traduzida pra forma de pagamento do Consumer. Voucher vira "credito"
     * (Prainha não usa; se aparecer, concilia pelo NSU do mesmo jeito).
     */
    private fun toPagamento(p: Payment): PagamentoLio {
        val primary = try { p.primaryCode } catch (_: Exception) { null }
        val secondary = try { p.secondaryCode } catch (_: Exception) { null }
        val code = PaymentCode.values().firstOrNull {
            it.codePrimary == primary && it.codeSecondary == secondary
        } ?: PaymentCode.values().firstOrNull { it.codePrimary == primary }
        val forma = when {
            code == PaymentCode.PIX -> "pix"
            code?.name?.startsWith("DEBITO") == true -> "debito"
            else -> "credito"
        }
        return PagamentoLio(
            forma = forma,
            nsu = p.cieloCode ?: "",
            autorizacao = p.authCode ?: "",
            bandeira = p.brand ?: "",
            mask = p.mask ?: "",
            terminal = p.terminal ?: "",
            valorCentavos = p.amount,
            parcelas = p.installments.toInt().coerceAtLeast(1),
            pagamentoId = p.id ?: "",
        )
    }

    /** Um trecho do cupom com estilo próprio (tudo centralizado no papel). */
    data class Bloco(val texto: String, val negrito: Boolean = false, val tamanho: Int = 20)

    /**
     * Imprime o cupom em blocos estilizados na térmica da maquininha —
     * títulos em negrito, corpo centralizado, avanço curto no fim. Fora da
     * maquininha o serviço não existe — onErro é chamado e a UI avisa.
     */
    fun imprimirBlocos(
        context: Context,
        blocos: List<Bloco>,
        onOk: () -> Unit,
        onErro: (mensagem: String) -> Unit,
    ) {
        try {
            val pm = PrinterManager(context)
            fun estilo(b: Bloco) = mapOf(
                PrinterAttributes.KEY_ALIGN to PrinterAttributes.VAL_ALIGN_CENTER,
                PrinterAttributes.KEY_TYPEFACE to (if (b.negrito) 1 else 0),
                PrinterAttributes.KEY_TEXT_SIZE to b.tamanho,
            )
            // PrinterListener.onError recebe Throwable? (anulável) — com
            // Throwable não compila ("overrides nothing").
            fun passo(i: Int) {
                if (i >= blocos.size) { onOk(); return }
                pm.printText(blocos[i].texto, estilo(blocos[i]), object : PrinterListener {
                    override fun onPrintSuccess() { passo(i + 1) }
                    override fun onError(e: Throwable?) { onErro(e?.message ?: "Falha na impressão") }
                    override fun onWithoutPaper() { onErro("Maquininha sem papel") }
                })
            }
            passo(0)
        } catch (e: Exception) {
            onErro("Impressora indisponível (fora da maquininha?)")
        }
    }
}
