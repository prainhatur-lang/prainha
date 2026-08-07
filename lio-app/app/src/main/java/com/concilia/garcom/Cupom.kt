package com.concilia.garcom

import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

// Monta o TEXTO do cupom (conferência da conta / recibo de pagamento) a partir
// do JSON do GET /api/conta/texto. A térmica da LIO/DX8000 imprime ~32 colunas
// no tamanho 20 — o layout é o mesmo do cupom 80mm da tela /conta/ver.
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

    fun agoraBr(): String {
        val o = SimpleDateFormat("dd/MM/yyyy HH:mm", Locale.US)
        o.timeZone = TimeZone.getTimeZone("America/Sao_Paulo")
        return o.format(java.util.Date())
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
        val rotulo = (if (ehComanda) "COMANDA $numero" else "MESA $numero") + (nome?.let { " · $it" } ?: "")
        sb.appendLine(SEP)
        sb.appendLine(rotulo)
        val abertura = dataBr(j.optStringOrNull("abertura"))
        val pessoas = j.optInt("pessoas", 0)
        sb.appendLine(listOfNotNull(
            abertura.ifBlank { null },
            if (pessoas > 1) "$pessoas pessoas" else null,
        ).joinToString(" · "))
        sb.appendLine(SEP)

        // Itens: pai ("2x Nome  44,00") e filho do wizard/observação indentado.
        val itens = j.optJSONArray("itens")
        if (itens != null) for (i in 0 until itens.length()) {
            val it = itens.optJSONObject(i) ?: continue
            val tipo = it.optInt("tipo", 1)
            val nomeIt = it.optString("nome")
            val valor = it.optDouble("valor_total", 0.0)
            if (tipo == 2) {
                sb.appendLine(("  + $nomeIt").take(W))
                if (valor > 0) sb.appendLine(linha("", num(valor)))
            } else {
                val qtd = it.optDouble("quantidade", 1.0)
                val qtdTxt = if (qtd == Math.floor(qtd)) qtd.toInt().toString() else qtd.toString()
                sb.appendLine(linha("${qtdTxt}x $nomeIt", num(valor)))
                val det = it.optString("detalhes", "")
                if (det.isNotBlank() && det != "NENHUM") sb.appendLine(("  · $det").take(W))
            }
        }

        sb.appendLine(SEP)
        sb.appendLine(linha("Consumo", num(j.optDouble("total", 0.0))))
        sb.appendLine(linha("Serviço (${j.optInt("taxa_servico", 10)}%)", num(j.optDouble("servico", 0.0))))
        sb.appendLine(linha("TOTAL", num(j.optDouble("com_servico", 0.0))))

        // Comandas penduradas na mesa — cada uma é conta própria.
        val comandas = j.optJSONArray("comandas")
        if (comandas != null && comandas.length() > 0) {
            sb.appendLine("Comandas na mesa:")
            for (i in 0 until comandas.length()) {
                val c = comandas.optJSONObject(i) ?: continue
                val cn = "C${c.optInt("numero")}" + (c.optStringOrNull("nome")?.let { " $it" } ?: "")
                sb.appendLine(linha("  $cn", num(c.optDouble("com_servico", 0.0))))
            }
            sb.appendLine(linha("GERAL", num(j.optDouble("geral", 0.0))))
        }

        val pagoGeral = j.optDouble("pago_geral", j.optDouble("pago", 0.0))
        val faltaGeral = j.optDouble("falta_geral", j.optDouble("resta", 0.0))
        if (pagoGeral > 0) sb.appendLine(linha("Pago", num(pagoGeral)))
        sb.appendLine(linha("FALTA", num(faltaGeral)))

        val pags = j.optJSONArray("pagamentos")
        if (pags != null && pags.length() > 0) {
            sb.appendLine(SEP)
            sb.appendLine("Pagamentos:")
            for (i in 0 until pags.length()) {
                val p = pags.optJSONObject(i) ?: continue
                sb.appendLine(linha("  " + p.optString("forma"), num(p.optDouble("valor", 0.0))))
            }
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
