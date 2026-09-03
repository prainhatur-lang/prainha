package com.concilia.garcom

// TIPOS do pagamento na maquininha — compartilhados entre os builds (Cielo e
// Rede). São só dados; o COMPORTAMENTO (SDK) fica em Lio (flavor cielo) ou
// Rede (flavor rede), sempre atrás de `Pagamento`.

/** Linha da conta que vira item do pedido no terminal (visível no checkout). */
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
    val descricao: String = "",   // descrição do produto da adquirente (auditoria: "... DEBITO A VISTA")
)

/** Uma venda PAGA do catálogo deste terminal (pro fechamento do dia). */
data class VendaTerminal(val nsu: String, val valorCentavos: Long, val dia: String?)

/** Um trecho do cupom com estilo próprio (tudo centralizado no papel).
 *  Com `qr` preenchido, o bloco imprime um QR CODE (texto é ignorado). */
data class Bloco(val texto: String = "", val negrito: Boolean = false, val tamanho: Int = 20, val qr: String? = null)
