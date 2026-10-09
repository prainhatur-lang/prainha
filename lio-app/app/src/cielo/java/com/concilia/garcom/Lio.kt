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
import org.json.JSONObject

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
    // contexto do app (nunca de tela): é com ele que a cobrança em andamento
    // é anotada — ver EmAndamento.
    private var appCtx: Context? = null

    /** true enquanto uma cobrança DESTE processo espera o aviso da Cielo. Se o
     *  app foi derrubado e reaberto, nasce false: não há aviso a caminho, e a
     *  Recuperacao não precisa esperar por ele. */
    @Volatile var emCobranca = false
        private set

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
        if (appCtx == null) appCtx = context.applicationContext
        if (bound) { onReady(); return }
        // applicationContext SEMPRE: o bind é GLOBAL do app. Amarrar na
        // Activity derrubava o serviço quando uma tela filha fechava (mesa →
        // comanda → voltar → "maquininha indisponível" na hora de receber).
        val app = context.applicationContext
        appCtx = app
        val om = OrderManager(
            Credentials(BuildConfig.CIELO_CLIENT_ID, BuildConfig.CIELO_ACCESS_TOKEN),
            app
        )
        orderManager = om
        om.bind(app, object : ServiceBindListener {
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
     * Lista as vendas pagas registradas NESTE terminal. A assinatura de
     * getOrders varia entre plataformas — qualquer falha devolve null e a
     * tela do fechamento segue só com o lado do servidor.
     */
    fun vendasDoTerminal(): List<VendaTerminal>? {
        val om = orderManager ?: return null
        if (!bound) return null
        val orders = try { om.getOrders(200, 0, null, null) } catch (_: Throwable) {
            try { om.getOrders(0, 200, null, null) } catch (_: Throwable) { null }
        } ?: return null
        val out = mutableListOf<VendaTerminal>()
        for (o in orders) {
            val pags = try { o.payments } catch (_: Throwable) { null } ?: continue
            for (p in pags) {
                val nsu = try { p.cieloCode } catch (_: Throwable) { null } ?: continue
                if (nsu.isBlank()) continue
                val valor = try { p.amount } catch (_: Throwable) { 0L }
                val dia = diaDe(try { p.requestDate } catch (_: Throwable) { null })
                out.add(VendaTerminal(nsu, valor, dia))
            }
        }
        return out
    }

    /** requestDate em formatos comuns → "yyyy-MM-dd"; null se ilegível. */
    private fun diaDe(s: String?): String? {
        if (s.isNullOrBlank()) return null
        Regex("(\\d{4})-(\\d{2})-(\\d{2})").find(s)?.let { return it.value }
        Regex("(\\d{2})/(\\d{2})/(\\d{4})").find(s)?.let { m ->
            val (d, mo, y) = m.destructured
            return "$y-$mo-$d"
        }
        return null
    }

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
        destino: JSONObject? = null, // pra qual conta é (EmAndamento); null = não anota
    ) {
        val om = orderManager
        if (om == null || !bound) { onErro("Serviço de pagamento da maquininha indisponível"); return }
        if (valorCentavos <= 0) { onErro("Valor inválido"); return }

        // número do pedido no terminal — é a chave da anotação da cobrança
        var pedidoId = ""
        fun riscar() { val c = appCtx; if (c != null && pedidoId.isNotBlank()) EmAndamento.fechar(c, pedidoId) }
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

            // ANOTA a cobrança ANTES da tela da Cielo abrir. Se o aviso do
            // pagamento se perder (app derrubado com a tela da Cielo na frente,
            // SDK que não monta o pedido pago), a Recuperacao pergunta ao
            // terminal por este pedido e registra o que foi aprovado.
            pedidoId = order.id ?: ""
            val ctx = appCtx
            if (destino != null && ctx != null) EmAndamento.abrir(ctx, pedidoId, ref, valorCentavos, destino)

            emCobranca = true
            om.checkoutOrder(order.id ?: "", valorCentavos, object : PaymentListener {
                override fun onStart() { onInicio() }

                override fun onPayment(paidOrder: Order) {
                    // Fecha o pedido no catálogo da maquininha e devolve as
                    // transações (NSU/authCode/bandeira) pra baixa no backend.
                    emCobranca = false
                    try { paidOrder.markAsPaid(); om.updateOrder(paidOrder) } catch (_: Exception) { }
                    var pagos = try {
                        paidOrder.payments.map { toPagamento(it) }
                    } catch (_: Exception) { emptyList() }
                    // O SDK avisou "pago" mas não entregou as transações: lê o
                    // pedido direto do terminal antes de desistir.
                    if (pagos.isEmpty()) {
                        val t = try { consultarPedido(pedidoId.ifBlank { paidOrder.id ?: "" }) } catch (_: Throwable) { null }
                        // mesma régua da recuperação: aprovada, de pé e no valor exato
                        if (t != null && !t.duvidoso && t.pagamentos.sumOf { it.valorCentavos } == valorCentavos) pagos = t.pagamentos
                    }
                    // A anotação NÃO sai aqui: quem risca é a tela, depois de
                    // pôr o pagamento na fila de pendentes (gravada no aparelho).
                    // Sem transação nenhuma ela fica, e a Recuperacao confere.
                    onPago(pedidoId.ifBlank { paidOrder.id ?: "" }, pagos)
                }

                // "Cancelado"/"erro" vindo do SDK nem sempre é verdade: quando
                // ele não consegue montar o pedido pago, avisa CANCELAMENTO com
                // o dinheiro já aprovado. Então, antes de aceitar, pergunta ao
                // terminal. Só vira pagamento com transação aprovada, de pé e
                // no valor exato pedido; no resto, segue igual a sempre.
                override fun onCancel() {
                    emCobranca = false
                    val pagos = aprovadoNoTerminal()
                    if (pagos.isNotEmpty()) { onPago(pedidoId, pagos); return }
                    riscar(); onCancelado()
                }

                override fun onError(error: PaymentError) {
                    emCobranca = false
                    val pagos = aprovadoNoTerminal()
                    if (pagos.isNotEmpty()) { onPago(pedidoId, pagos); return }
                    riscar()
                    onErro(error.description ?: "Pagamento não concluído")
                }

                private fun aprovadoNoTerminal(): List<PagamentoLio> {
                    val t = try { consultarPedido(pedidoId) } catch (_: Throwable) { null } ?: return emptyList()
                    if (t.duvidoso || t.pagamentos.isEmpty()) return emptyList()
                    return if (t.pagamentos.sumOf { it.valorCentavos } == valorCentavos) t.pagamentos else emptyList()
                }
            })
        } catch (e: Exception) {
            // a anotação (se já foi feita) FICA: a Recuperacao pergunta ao
            // terminal — pedido sem transação some sozinho, sem lançar nada.
            emCobranca = false
            onErro(e.message ?: "Erro ao iniciar a cobrança na maquininha")
        }
    }

    /**
     * O que o TERMINAL tem gravado do pedido `pedidoId` — pergunta direta ao
     * serviço de pedidos da maquininha, sem passar pelo aviso de pagamento.
     * null = não deu pra saber agora (serviço fora, pedido não achado).
     *
     * Lê primeiro o pedido CRU (retrieveOrderById): o conversor do SDK estoura
     * com campo nulo, e é justamente esse tropeço que some com o aviso. Cada
     * campo é lido com guarda. Só entra transação aprovada e de pé; havendo
     * cancelamento/estorno no pedido, devolve `duvidoso` e ninguém registra.
     * Vale transação com NSU OU com autorização: o Pix às vezes vem sem NSU
     * (o servidor casa pela autorização).
     */
    fun consultarPedido(pedidoId: String): PedidoTerminal? {
        if (orderManager == null || !bound || pedidoId.isBlank()) return null
        // Duas leituras do MESMO pedido. Vale a primeira que trouxer transação
        // (ou cancelamento); as duas vazias = o terminal não tem nada aprovado.
        val a = pedidoCru(pedidoId)
        if (a != null && (a.pagamentos.isNotEmpty() || a.duvidoso)) return a
        val b = pedidoDoSdk(pedidoId)
        if (b != null && (b.pagamentos.isNotEmpty() || b.duvidoso)) return b
        return a ?: b
    }

    private fun pedidoCru(pedidoId: String): PedidoTerminal? {
        val om = orderManager ?: return null
        try {
            val po = om.retrieveOrderById(pedidoId)
            if (po != null) {
                val status = try { po.status?.name } catch (_: Throwable) { null } ?: ""
                val trans = try { po.transactions } catch (_: Throwable) { null } ?: emptyList()
                val pagoTerminal = try { po.paidAmount } catch (_: Throwable) { -1L }
                var duvidoso = status == "CANCELED"
                val lidas = mutableListOf<Pair<PagamentoLio, String>>()
                for (t in trans) {
                    val campos = try { JSONObject(t.paymentFields ?: "{}") } catch (_: Throwable) { JSONObject() }
                    val l = try {
                        cru(
                            id = t.id, descricao = t.description, nsu = t.cieloCode, autorizacao = t.authCode,
                            bandeira = t.brand, mask = t.mask, terminal = t.terminal, centavos = t.amount, campos = campos,
                        )
                    } catch (_: Throwable) { null }
                    if (l == null) duvidoso = true else lidas.add(l)
                }
                return montar(lidas, duvidoso, status, pagoTerminal, "cru")
            }
        } catch (_: Throwable) { }
        return null
    }

    // O pedido já convertido pelo SDK (terminal novo responde por outra
    // chamada; o cru pode vir sem as transações).
    private fun pedidoDoSdk(pedidoId: String): PedidoTerminal? {
        val om = orderManager ?: return null
        try {
            val o = om.findOrderById(pedidoId) ?: return null
            val status = try { o.status?.name } catch (_: Throwable) { null } ?: ""
            val lista = try { o.payments } catch (_: Throwable) { null } ?: return null
            val pagoTerminal = try { o.paidAmount } catch (_: Throwable) { -1L }
            var duvidoso = status == "CANCELED"
            val lidas = mutableListOf<Pair<PagamentoLio, String>>()
            for (pay in lista) {
                val campos = JSONObject()
                try { for ((k, v) in pay.paymentFields) campos.put(k, v) } catch (_: Throwable) { }
                val l = try {
                    cru(
                        id = pay.id, descricao = pay.description, nsu = pay.cieloCode, autorizacao = pay.authCode,
                        bandeira = pay.brand, mask = pay.mask, terminal = pay.terminal, centavos = pay.amount, campos = campos,
                    )
                } catch (_: Throwable) { null }
                if (l == null) duvidoso = true else lidas.add(l)
            }
            return montar(lidas, duvidoso, status, pagoTerminal, "sdk")
        } catch (_: Throwable) { }
        return null
    }

    // Decide o que do pedido lido conta como DINHEIRO APROVADO. A situação de
    // cada transação é a que o próprio terminal carimba (statusCode):
    //   "1"  autorizada  → conta;
    //   "2"  cancelada   → pedido duvidoso, ninguém registra;
    //   outro valor      → ainda não autorizada (Pix esperando o cliente): não conta;
    //   sem carimbo      → só conta se o terminal dá o PEDIDO como pago nesse
    //                      valor (paidAmount); senão é como se não houvesse.
    // O `status` devolvido é um resumo pra diagnóstico (vai no rastro da loja).
    private fun montar(
        lidas: List<Pair<PagamentoLio, String>>, duvidosoIni: Boolean, status: String, pagoTerminal: Long, via: String,
    ): PedidoTerminal {
        var duvidoso = duvidosoIni
        var semCarimbo = false
        val pags = mutableListOf<PagamentoLio>()
        for ((p, sc) in lidas) {
            when {
                p.forma == "cancelada" -> duvidoso = true
                sc == "1" -> pags.add(p)
                sc.isEmpty() -> { pags.add(p); semCarimbo = true }
                else -> { /* declarada e não autorizada: ainda não é dinheiro */ }
            }
        }
        val validas = pags.filter { it.valorCentavos > 0 && (it.nsu.isNotBlank() || it.autorizacao.isNotBlank()) }
        val aceitas = if (semCarimbo && pagoTerminal < validas.sumOf { it.valorCentavos }) emptyList() else validas
        val resumo = "$status · $via · pago $pagoTerminal · " +
            lidas.joinToString(",") { (p, sc) -> "${p.forma}:${p.valorCentavos}:sc${sc.ifEmpty { "?" }}" }.ifEmpty { "sem transação" }
        return PedidoTerminal(aceitas, duvidoso, resumo.take(300))
    }

    /**
     * Transação crua do terminal → PagamentoLio, com a MESMA regra de forma do
     * toPagamento (descrição manda; débito por código/bandeira; Pix pelo código
     * 25) — mais dois sinais de Pix que o campo de produto às vezes não traz:
     * a autorização no formato do Banco Central (E + 31) e "PIX" no nome do
     * produto. Transação cancelada (statusCode 2 / v40Code 28 / "CANCEL" no
     * nome) volta com forma "cancelada" pra quem chama marcar como duvidoso.
     */
    private fun cru(
        id: String?, descricao: String?, nsu: String?, autorizacao: String?, bandeira: String?,
        mask: String?, terminal: String?, centavos: Long, campos: JSONObject,
    ): Pair<PagamentoLio, String> {
        fun campo(k: String): String = try { if (campos.isNull(k)) "" else campos.optString(k, "") } catch (_: Throwable) { "" }
        val primary = campo("primaryProductCode")
        val secondary = campo("secondaryProductCode")
        val code = PaymentCode.values().firstOrNull { it.codePrimary == primary && it.codeSecondary == secondary }
            ?: PaymentCode.values().firstOrNull { it.codePrimary == primary }
        val desc = (descricao ?: "").uppercase()
        val brand = (bandeira ?: "").uppercase()
        val nomes = (desc + " " + campo("productName") + " " + campo("primaryProductName") + " " +
            campo("secondaryProductName") + " " + campo("cardLabelApplication")).uppercase()
        val aut = autorizacao ?: ""
        val cancelada = campo("statusCode") == "2" || campo("v40Code") == "28" || nomes.contains("CANCEL")
        val ehPix = code == PaymentCode.PIX || primary == "25" ||
            Regex("^E\\d{8}\\d{12}[A-Za-z0-9]{11}$").matches(aut.trim()) ||
            Regex("\\bPIX\\b").containsMatchIn(nomes) || brand == "PIX"
        val ehDebito =
            code?.name?.startsWith("DEBITO") == true ||
            Regex("D[EÉ]BITO").containsMatchIn(nomes) ||
            brand.contains("MAESTRO") || brand.contains("ELECTRON") ||
            Regex("D[EÉ]BITO").containsMatchIn(brand)
        val forma = when {
            cancelada -> "cancelada"
            ehPix -> "pix"
            Regex("CR[EÉ]DITO").containsMatchIn(desc) -> "credito"
            ehDebito -> "debito"
            else -> "credito"
        }
        val quando = campo("requestDate").trim().toLongOrNull()?.takeIf { it > 1_000_000_000_000L } ?: 0L
        return Pair(PagamentoLio(
            forma = forma,
            nsu = nsu ?: "",
            autorizacao = aut,
            bandeira = bandeira ?: "",
            mask = mask ?: "",
            terminal = terminal ?: "",
            valorCentavos = centavos,
            parcelas = (campo("numberOfQuotas").toIntOrNull() ?: 1).coerceAtLeast(1),
            pagamentoId = id ?: "",
            descricao = descricao ?: "",
            aprovadoEm = quando,
        ), campo("statusCode").trim())
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
        // A DESCRIÇÃO do produto (o que a Cielo imprime: "... DEBITO A VISTA" /
        // "... CREDITO A VISTA") é a fonte da verdade. Pré-pago Maestro roda como
        // DÉBITO mas o código de produto não casa com um DEBITO_* do enum → antes
        // caía no else->credito (errado no caixa e quebra a conciliação, que a
        // Cielo liquida como débito). Prioridade: crédito explícito venceria só se
        // a Cielo dissesse crédito; senão débito por descrição/enum/bandeira.
        val desc = (try { p.description } catch (_: Exception) { null } ?: "").uppercase()
        val brand = (p.brand ?: "").uppercase()
        val ehDebito =
            code?.name?.startsWith("DEBITO") == true ||
            Regex("D[EÉ]BITO").containsMatchIn(desc) ||
            brand.contains("MAESTRO") || brand.contains("ELECTRON") ||
            Regex("D[EÉ]BITO").containsMatchIn(brand)
        val forma = when {
            code == PaymentCode.PIX -> "pix"
            Regex("CR[EÉ]DITO").containsMatchIn(desc) -> "credito"
            ehDebito -> "debito"
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
            descricao = try { p.description ?: "" } catch (_: Exception) { "" },
        )
    }

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
                val ouvinte = object : PrinterListener {
                    override fun onPrintSuccess() { passo(i + 1) }
                    override fun onError(e: Throwable?) { onErro(e?.message ?: "Falha na impressão") }
                    override fun onWithoutPaper() { onErro("Maquininha sem papel") }
                }
                val b = blocos[i]
                if (b.qr != null) {
                    // QR desenhado por nós (zxing) e impresso como IMAGEM — o
                    // printQrCode do SDK não imprime em campo (saiu o DANFE sem
                    // QR na loja; o CupomPro tem a mesma cicatriz). E o QR não
                    // pode DERRUBAR o cupom: qualquer falha imprime aviso e
                    // SEGUE — o resto do documento sai inteiro.
                    val aviso = {
                        pm.printText("[QR indisponivel nesta via]\n",
                            estilo(Bloco(tamanho = 16)), ouvinte)
                    }
                    val bmp = Qr.bitmap(b.qr, 360)
                    if (bmp == null) aviso() else {
                        val centro = mapOf(PrinterAttributes.KEY_ALIGN to PrinterAttributes.VAL_ALIGN_CENTER)
                        pm.printImage(bmp, centro, object : PrinterListener {
                            override fun onPrintSuccess() { passo(i + 1) }
                            override fun onWithoutPaper() { onErro("Maquininha sem papel") }
                            override fun onError(e: Throwable?) { aviso() }
                        })
                    }
                } else pm.printText(b.texto, estilo(b), ouvinte)
            }
            passo(0)
        } catch (e: Exception) {
            onErro("Impressora indisponível (fora da maquininha?)")
        }
    }
}
