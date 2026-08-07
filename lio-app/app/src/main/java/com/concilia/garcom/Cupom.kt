package com.concilia.garcom

import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

// Monta o TEXTO do cupom (conta / conferência / recibo) a partir do JSON do
// GET /api/conta/texto. A térmica da LIO/DX8000 imprime ~32 colunas no
// tamanho 20 — o layout segue o cupom 80mm da tela /conta/ver, com TODOS os
// detalhes: itens com preço unitário, cada comanda com os próprios itens e
// subtotais, pagamentos com hora, total geral e rateio por pessoa.
object Cupom {
    private const val W = 32
    private val SEP = "-".repeat(W)

    fun brl(v: Double): String = "R$ " + String.format(Locale("pt", "BR"), "%,.2f", v)

    /** "Nome comprido....... 1.234,56" — esquerda truncada, direita alinhada. */
    private fun linha(esq: String, dir: String): String {
        val e = if (esq.length > W - dir.length - 1) esq.take(W - dir.length - 1) else esq
        return e + " ".repeat(W - e.length - dir.length) + dir
    }

    private fun num(v: Double): String = String.format(Locale("pt", "BR"), "%,.2f", v)

    /** ISO (UTC do servidor) → "06/08 21:14" em BRT. */
    private fun dataBr(iso: String?): String {
        if (iso.isNullOrBlank()) return ""
        return try {
            val f = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US)
            f.timeZone = TimeZone.getTimeZone("UTC")
            val d = f.parse(iso.take(19)) ?: return iso.take(16).replace("T", " ")
            val o = SimpleDateFormat("dd/MM HH:mm", Locale.US)
            o.timeZone = TimeZone.getTimeZone("America/Sao_Paulo")
            o.format(d)
        } catch (_: Exception) { iso.take(16).replace("T", " ") }
    }

    /** ISO (UTC) → "21:14" em BRT — hora dos lançamentos de pagamento. */
    fun horaBr(iso: String?): String {
        if (iso.isNullOrBlank()) return ""
        return try {
            val f = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US)
            f.timeZone = TimeZone.getTimeZone("UTC")
            val d = f.parse(iso.take(19)) ?: return ""
            val o = SimpleDateFormat("HH:mm", Locale.US)
            o.timeZone = TimeZone.getTimeZone("America/Sao_Paulo")
            o.format(d)
        } catch (_: Exception) { "" }
    }

    fun agoraBr(): String {
        val o = SimpleDateFormat("dd/MM/yyyy HH:mm", Locale.US)
        o.timeZone = TimeZone.getTimeZone("America/Sao_Paulo")
        return o.format(java.util.Date())
    }

    /** Item: "2x Caipirinha  44,00" + "(2 x 22,00)" + observação + filhos. */
    private fun itemLinhas(sb: StringBuilder, it: JSONObject) {
        val tipo = it.optInt("tipo", 1)
        val nomeIt = it.optString("nome")
        val valor = it.optDouble("valor_total", 0.0)
        if (tipo == 2) {
            // Filho do wizard (ponto da carne etc.) — indentado sob o pai.
            sb.appendLine(("  + $nomeIt").take(W))
            if (valor > 0) sb.appendLine(linha("", num(valor)))
            return
        }
        val qtd = it.optDouble("quantidade", 1.0)
        val qtdTxt = if (qtd == Math.floor(qtd)) qtd.toInt().toString() else qtd.toString()
        sb.appendLine(linha("${qtdTxt}x $nomeIt", num(valor)))
        if (qtd > 1) sb.appendLine(("   ($qtdTxt x ${num(valor / qtd)})").take(W))
        val det = it.optString("detalhes", "")
        if (det.isNotBlank() && det != "NENHUM") sb.appendLine(("  · $det").take(W))
    }

    /**
     * Corpo do cupom. `extras` entra no fim (ex.: o pagamento que acabou de
     * acontecer, com NSU — o recibo do cliente). Usa os totais GERAIS (mesa +
     * comandas penduradas) — cupom só da mesa já fez cliente somar errado.
     */
    fun montar(j: JSONObject, ehComanda: Boolean, extras: List<String> = emptyList()): String {
        val sb = StringBuilder()
        val numero = j.optInt("numero")
        val nome = j.optStringOrNull("nome")
        val pessoas = j.optInt("pessoas", 0)
        sb.appendLine(SEP)
        sb.appendLine((if (ehComanda) "COMANDA $numero" else "MESA $numero") + (nome?.let { " · $it" } ?: ""))
        val cab = listOfNotNull(
            dataBr(j.optStringOrNull("abertura")).ifBlank { null }?.let { "aberta $it" },
            if (pessoas > 1) "$pessoas pessoas" else null,
        ).joinToString(" · ")
        if (cab.isNotBlank()) sb.appendLine(cab.take(W))
        sb.appendLine(SEP)

        // Itens da mesa (ou da comanda, quando o cupom é dela).
        val itens = j.optJSONArray("itens")
        if (itens != null) for (i in 0 until itens.length()) {
            itemLinhas(sb, itens.optJSONObject(i) ?: continue)
        }

        sb.appendLine(SEP)
        sb.appendLine(linha("Consumo", num(j.optDouble("total", 0.0))))
        sb.appendLine(linha("Serviço (${j.optInt("taxa_servico", 10)}%)", num(j.optDouble("servico", 0.0))))
        sb.appendLine(linha("TOTAL", num(j.optDouble("com_servico", 0.0))))

        // Cada comanda pendurada na mesa: bloco próprio com itens e subtotais.
        val comandas = j.optJSONArray("comandas")
        val temComandas = comandas != null && comandas.length() > 0
        if (temComandas) {
            for (i in 0 until comandas!!.length()) {
                val c = comandas.optJSONObject(i) ?: continue
                sb.appendLine(SEP)
                sb.appendLine("COMANDA ${c.optInt("numero")}" + (c.optStringOrNull("nome")?.let { " · $it" } ?: ""))
                val cit = c.optJSONArray("itens")
                if (cit != null) for (k in 0 until cit.length()) {
                    itemLinhas(sb, cit.optJSONObject(k) ?: continue)
                }
                sb.appendLine(linha("  Consumo", num(c.optDouble("subtotal", 0.0))))
                sb.appendLine(linha("  Serviço", num(c.optDouble("servico", 0.0))))
                sb.appendLine(linha("  Total", num(c.optDouble("com_servico", 0.0))))
                val cPago = c.optDouble("pago", 0.0)
                if (cPago > 0) sb.appendLine(linha("  Pago", num(cPago)))
                if (c.optBoolean("quitada")) sb.appendLine("  QUITADA")
                else if (cPago > 0) sb.appendLine(linha("  Falta", num(c.optDouble("resta", 0.0))))
            }
            sb.appendLine(SEP)
            sb.appendLine(linha("GERAL mesa+comandas", num(j.optDouble("geral", 0.0))))
        }

        // Pagamentos já feitos, com hora — e o que ainda falta.
        val pags = j.optJSONArray("pagamentos")
        if (pags != null && pags.length() > 0) {
            sb.appendLine(SEP)
            sb.appendLine("Pagamentos:")
            for (i in 0 until pags.length()) {
                val p = pags.optJSONObject(i) ?: continue
                val hora = horaBr(p.optStringOrNull("quando"))
                sb.appendLine(linha(("  $hora " + p.optString("forma")).trim().let { "  $it" }, num(p.optDouble("valor", 0.0))))
            }
        }
        val pagoGeral = j.optDouble("pago_geral", j.optDouble("pago", 0.0))
        val faltaGeral = j.optDouble("falta_geral", j.optDouble("resta", 0.0))
        if (pagoGeral > 0) sb.appendLine(linha("Pago", num(pagoGeral)))
        sb.appendLine(linha("FALTA", num(faltaGeral)))
        if (pessoas > 1 && faltaGeral > 0.009) {
            sb.appendLine(linha("Por pessoa ($pessoas)", num(faltaGeral / pessoas)))
        }

        if (extras.isNotEmpty()) {
            sb.appendLine(SEP)
            extras.forEach { sb.appendLine(it.take(W)) }
        }
        sb.appendLine(SEP)
        sb.appendLine("Emitido ${agoraBr()}")
        return sb.toString()
    }
}
