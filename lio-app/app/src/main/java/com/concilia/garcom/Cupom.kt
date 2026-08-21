package com.concilia.garcom

import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

// Monta o cupom (conta / conferência / recibo) em BLOCOS estilizados pra
// térmica da LIO/DX8000, a partir do JSON do GET /api/conta/texto:
//   • tudo centralizado no papel; mesa + nome em negrito no topo
//   • separador grosso (====) entre o cabeçalho e os produtos e antes dos totais
//   • SEM observações de item (cupom é do cliente; observação é da cozinha)
//   • FALTA em negrito + divisão por pessoas (o garçom escolhe por quantas)
//   • avanço curto no fim (3 linhas, não 10)
object Cupom {
    private const val W = 32
    private const val NB = ' '   // espaço que a impressora não corta no fim da linha
    private val FINA = "-".repeat(W)
    private val GROSSA = "=".repeat(W)

    fun brl(v: Double): String = "R$ " + String.format(Locale("pt", "BR"), "%,.2f", v)

    /** Quantidade de estoque: 12 (não "12,000") e 1,5 quando é fracionado (kg). */
    fun qtd(v: Double): String =
        if (kotlin.math.abs(v - Math.round(v)) < 0.001) Math.round(v).toString()
        else String.format(Locale("pt", "BR"), "%,.3f", v).trimEnd('0').trimEnd(',')

    /** "Nome comprido....... 1.234,56" — colunas numa linha de largura fixa. */
    private fun linha(esq: String, dir: String): String {
        val e = if (esq.length > W - dir.length - 1) esq.take(W - dir.length - 1) else esq
        return e + NB.toString().repeat(W - e.length - dir.length) + dir
    }

    /** Linha de texto corrido, completada até W (mantém o bloco alinhado no centro). */
    private fun cheia(l: String): String {
        val t = if (l.length > W) l.take(W) else l
        return t + NB.toString().repeat(W - t.length)
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

    /** Item SEM observações: "2x Caipirinha  44,00" (+ "(2 x 22,00)").
     *  Filho do wizard só entra quando tem preço (aí é cobrança, não obs). */
    private fun itemLinhas(sb: StringBuilder, it: JSONObject) {
        val tipo = it.optInt("tipo", 1)
        val valor = it.optDouble("valor_total", 0.0)
        if (tipo == 2) {
            if (valor > 0) sb.appendLine(linha("  + " + it.optString("nome"), num(valor)))
            return
        }
        val qtd = it.optDouble("quantidade", 1.0)
        val qtdTxt = if (qtd == Math.floor(qtd)) qtd.toInt().toString() else qtd.toString()
        sb.appendLine(linha("${qtdTxt}x " + it.optString("nome"), num(valor)))
        if (qtd > 1) sb.appendLine(cheia("   ($qtdTxt x ${num(valor / qtd)})"))
    }

    /**
     * Blocos do cupom. `pessoas` = por quantas dividir (o garçom escolhe na
     * hora de imprimir; null usa o nº de pessoas da conta). `extras` entra
     * antes do rodapé (ex.: NSU do recibo).
     */
    fun montarBlocos(
        j: JSONObject,
        ehComanda: Boolean,
        loja: String,
        rotulo: String,
        pessoas: Int? = null,
        extras: List<String> = emptyList(),
    ): List<Lio.Bloco> {
        val blocos = mutableListOf<Lio.Bloco>()
        val numero = j.optInt("numero")
        val nome = j.optStringOrNull("nome")

        // Cabeçalho: loja + tipo do cupom, e MESA · NOME em destaque.
        blocos.add(Lio.Bloco("\n$loja\n$rotulo", negrito = true, tamanho = 22))
        blocos.add(Lio.Bloco(
            (if (ehComanda) "COMANDA $numero" else "MESA $numero") + (nome?.let { "\n$it" } ?: ""),
            negrito = true, tamanho = 26,
        ))
        val subCab = listOfNotNull(
            dataBr(j.optStringOrNull("abertura")).ifBlank { null }?.let { "aberta $it" },
        ).joinToString(" · ")
        if (subCab.isNotBlank()) blocos.add(Lio.Bloco(subCab, tamanho = 16))

        // Linha grossa separando o cabeçalho dos produtos.
        blocos.add(Lio.Bloco(GROSSA, negrito = true, tamanho = 20))

        // Produtos (sem observações).
        val corpo = StringBuilder()
        val itens = j.optJSONArray("itens")
        if (itens != null) for (i in 0 until itens.length()) {
            itemLinhas(corpo, itens.optJSONObject(i) ?: continue)
        }
        if (corpo.isNotEmpty()) blocos.add(Lio.Bloco(corpo.toString().trimEnd('\n'), tamanho = 20))

        // Linha grossa antes dos totais.
        blocos.add(Lio.Bloco(GROSSA, negrito = true, tamanho = 20))

        val totais = StringBuilder()
        totais.appendLine(linha("Consumo", num(j.optDouble("total", 0.0))))
        totais.appendLine(linha("Serviço (${j.optInt("taxa_servico", 10)}%)", num(j.optDouble("servico", 0.0))))
        // desconto/acréscimo do pedido — o cupom saía sem eles e o TOTAL ficava cheio
        j.optDouble("desconto", 0.0).takeIf { it > 0 }?.let { totais.appendLine(linha("Desconto", "-" + num(it))) }
        j.optDouble("acrescimo", 0.0).takeIf { it > 0 }?.let { totais.appendLine(linha("Acréscimo", "+" + num(it))) }
        totais.appendLine(linha("TOTAL", num(j.optDouble("com_servico", 0.0))))

        // Comandas penduradas: bloco próprio com itens e subtotais.
        val comandas = j.optJSONArray("comandas")
        if (comandas != null && comandas.length() > 0) {
            for (i in 0 until comandas.length()) {
                val c = comandas.optJSONObject(i) ?: continue
                totais.appendLine(FINA)
                totais.appendLine(cheia("COMANDA ${c.optInt("numero")}" + (c.optStringOrNull("nome")?.let { " · $it" } ?: "")))
                val cit = c.optJSONArray("itens")
                if (cit != null) for (k in 0 until cit.length()) {
                    itemLinhas(totais, cit.optJSONObject(k) ?: continue)
                }
                totais.appendLine(linha("  Consumo", num(c.optDouble("subtotal", 0.0))))
                totais.appendLine(linha("  Serviço", num(c.optDouble("servico", 0.0))))
                c.optDouble("desconto", 0.0).takeIf { it > 0 }?.let { totais.appendLine(linha("  Desconto", "-" + num(it))) }
                c.optDouble("acrescimo", 0.0).takeIf { it > 0 }?.let { totais.appendLine(linha("  Acréscimo", "+" + num(it))) }
                totais.appendLine(linha("  Total", num(c.optDouble("com_servico", 0.0))))
                val cPago = c.optDouble("pago", 0.0)
                if (cPago > 0) totais.appendLine(linha("  Pago", num(cPago)))
                if (c.optBoolean("quitada")) totais.appendLine(cheia("  QUITADA"))
                else if (cPago > 0) totais.appendLine(linha("  Falta", num(c.optDouble("resta", 0.0))))
            }
            totais.appendLine(FINA)
            totais.appendLine(linha("GERAL mesa+comandas", num(j.optDouble("geral", 0.0))))
        }

        // Pagamentos já feitos, com hora, alinhados como os itens.
        val pags = j.optJSONArray("pagamentos")
        if (pags != null && pags.length() > 0) {
            totais.appendLine(FINA)
            totais.appendLine(cheia("Pagamentos:"))
            for (i in 0 until pags.length()) {
                val p = pags.optJSONObject(i) ?: continue
                val hora = horaBr(p.optStringOrNull("quando"))
                totais.appendLine(linha("  " + ("$hora " + p.optString("forma")).trim(), num(p.optDouble("valor", 0.0))))
            }
        }
        val pagoGeral = j.optDouble("pago_geral", j.optDouble("pago", 0.0))
        if (pagoGeral > 0) totais.appendLine(linha("Pago", num(pagoGeral)))
        blocos.add(Lio.Bloco(totais.toString().trimEnd('\n'), tamanho = 20))

        // FALTA em destaque + divisão por pessoas.
        val faltaGeral = j.optDouble("falta_geral", j.optDouble("resta", 0.0))
        blocos.add(Lio.Bloco("FALTA ${brl(faltaGeral)}", negrito = true, tamanho = 26))
        val nPessoas = pessoas ?: j.optInt("pessoas", 0)
        if (nPessoas > 1 && faltaGeral > 0.009) {
            blocos.add(Lio.Bloco("Por pessoa ($nPessoas): ${brl(faltaGeral / nPessoas)}", tamanho = 20))
        }

        if (extras.isNotEmpty()) {
            blocos.add(Lio.Bloco(extras.joinToString("\n"), negrito = true, tamanho = 20))
        }
        // 6 pulinhos: o papel sai inteiro da boca da impressora sem puxar.
        blocos.add(Lio.Bloco("Emitido ${agoraBr()}\n\n\n\n\n\n", tamanho = 16))
        return blocos
    }
}
