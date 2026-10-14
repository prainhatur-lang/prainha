package com.concilia.garcom

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

// VENDA DIRETA (ticket): depois do comprovante do cartão/Pix, sai UM ticket
// por unidade vendida — o cliente leva cada papel ao balcão certo (bar,
// petiscos…) e troca pelo que comprou. 3 cervejas = 3 tickets.
object Ticket {
    /** Blocos de impressão de todos os tickets de uma venda.
     *  `t`: {ticket_id|id, itens[{nome, tamanho, qtd, obs, opcoes[], area_nome}]}. */
    fun blocos(t: JSONObject, loja: String, garcom: String?): List<Bloco> {
        val id = t.optInt("ticket_id", t.optInt("id", 0))
        val itens = t.optJSONArray("itens") ?: JSONArray()
        val unidades = mutableListOf<JSONObject>()
        for (i in 0 until itens.length()) {
            val o = itens.optJSONObject(i) ?: continue
            repeat(maxOf(1, o.optInt("qtd", 1))) { unidades.add(o) }
        }
        val quando = Cupom.agoraBr()
        val out = mutableListOf<Bloco>()
        unidades.forEachIndexed { idx, o ->
            val tam = o.optStringOrNull("tamanho")
            val nome = o.optString("nome") + (if (tam != null && !o.optString("nome").contains(tam, true)) " ($tam)" else "")
            val opcoes = o.optJSONArray("opcoes")
            val det = mutableListOf<String>()
            val nomesOpc = mutableListOf<String>()
            if (opcoes != null) for (k in 0 until opcoes.length()) opcoes.optString(k).takeIf { it.isNotBlank() }?.let { nomesOpc.add(it) }
            nomesOpc.forEach { det.add("• $it") }
            // sem observação o servidor guarda as opções como obs — não repete
            o.optStringOrNull("obs")?.let { ob -> if (ob != nomesOpc.joinToString(" | ")) det.add("✎ $ob") }
            out.add(Bloco("\n$loja", negrito = true, tamanho = 20))
            out.add(Bloco("TICKET $id", negrito = true, tamanho = 30))
            out.add(Bloco("${idx + 1} de ${unidades.size}", tamanho = 20))
            out.add(Bloco("================================", tamanho = 20))
            out.add(Bloco("1x $nome", negrito = true, tamanho = 30))
            if (det.isNotEmpty()) out.add(Bloco(det.joinToString("\n"), tamanho = 22))
            out.add(Bloco("================================", tamanho = 20))
            out.add(Bloco("RETIRAR NO: " + o.optString("area_nome").ifBlank { "BAR" }.uppercase(), negrito = true, tamanho = 24))
            out.add(Bloco(quando + (garcom?.let { " · $it" } ?: "") + "\n\n- - - - - - - - - - - - - - - -\n\n\n", tamanho = 16))
        }
        return out
    }

    fun imprimir(ctx: Context, t: JSONObject, onOk: () -> Unit, onErro: (String) -> Unit) {
        val b = blocos(t, Session.loja(ctx), Session.nome(ctx) ?: Session.login(ctx))
        if (b.isEmpty()) { onErro("Ticket sem itens"); return }
        Pagamento.imprimirBlocos(ctx, b, onOk, onErro)
    }
}
