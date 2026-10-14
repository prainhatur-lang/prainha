package com.concilia.garcom

import android.app.Activity
import android.content.Context
import android.text.InputType
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import org.json.JSONArray
import org.json.JSONObject

// VENDA DIRETA (ticket): depois do comprovante do cartão/Pix, sai UM ticket
// por unidade vendida — o cliente leva cada papel ao balcão certo (bar,
// petiscos…) e troca pelo que comprou. 3 cervejas = 3 tickets.
object Ticket {
    /** Blocos de impressão, UM GRUPO POR TICKET (unidade) — a impressão anda
     *  ticket a ticket e sabe em qual parou (sem papel / erro da impressora).
     *  `t`: {ticket_id|id, itens[{nome, tamanho, qtd, obs, opcoes[], area_nome}]}. */
    fun porUnidade(t: JSONObject, loja: String, garcom: String?): List<List<Bloco>> {
        val id = t.optInt("ticket_id", t.optInt("id", 0))
        val itens = t.optJSONArray("itens") ?: JSONArray()
        val unidades = mutableListOf<JSONObject>()
        for (i in 0 until itens.length()) {
            val o = itens.optJSONObject(i) ?: continue
            repeat(maxOf(1, o.optInt("qtd", 1))) { unidades.add(o) }
        }
        val quando = Cupom.agoraBr()
        val via = t.optInt("_via", 1)
        return unidades.mapIndexed { idx, o ->
            val out = mutableListOf<Bloco>()
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
            // reimpressão liberada pelo supervisor sai marcada — o balcão vê que é 2ª via
            if (via > 1) out.add(Bloco("REIMPRESSÃO · ${via}ª VIA", negrito = true, tamanho = 22))
            out.add(Bloco("================================", tamanho = 20))
            out.add(Bloco("1x $nome", negrito = true, tamanho = 30))
            if (det.isNotEmpty()) out.add(Bloco(det.joinToString("\n"), tamanho = 22))
            out.add(Bloco("================================", tamanho = 20))
            out.add(Bloco("RETIRAR NO: " + o.optString("area_nome").ifBlank { "BAR" }.uppercase(), negrito = true, tamanho = 24))
            out.add(Bloco(quando + (garcom?.let { " · $it" } ?: "") + "\n\n- - - - - - - - - - - - - - - -\n\n\n", tamanho = 16))
            out
        }
    }

    /** Todos os blocos de uma venda, em sequência. */
    fun blocos(t: JSONObject, loja: String, garcom: String?): List<Bloco> = porUnidade(t, loja, garcom).flatten()

    fun imprimir(ctx: Context, t: JSONObject, onOk: () -> Unit, onErro: (String) -> Unit) =
        imprimirDesde(ctx, t, 0, onOk) { _, _, m -> onErro(m) }

    /** Imprime do ticket `desde` (0 = primeiro) em diante, um por vez. Se a
     *  impressora parar, `onFalha(impressos, total, msg)` diz quantos saíram
     *  inteiros — o que parou no meio conta como NÃO impresso. */
    fun imprimirDesde(ctx: Context, t: JSONObject, desde: Int, onOk: () -> Unit,
                      onFalha: (impressos: Int, total: Int, msg: String) -> Unit) {
        val us = porUnidade(t, Session.loja(ctx), Session.nome(ctx) ?: Session.login(ctx))
        if (us.isEmpty()) { onFalha(0, 0, "Ticket sem itens"); return }
        fun passo(i: Int) {
            if (i >= us.size) { onOk(); return }
            Pagamento.imprimirBlocos(ctx, us[i], onOk = { passo(i + 1) }, onErro = { m -> onFalha(i, us.size, m) })
        }
        passo(desde.coerceIn(0, us.size))
    }

    /** Imprime e, se parar (papel acabou), oferece CONTINUAR de onde parou —
     *  sem senha: a maquininha sabe que aqueles não saíram. */
    fun imprimirComRetomada(act: Activity, t: JSONObject, desde: Int = 0, onFim: () -> Unit = {}) {
        imprimirDesde(act, t, desde, onOk = { act.runOnUiThread(onFim) }) { feitos, total, msg ->
            act.runOnUiThread {
                if (act.isFinishing || act.isDestroyed) return@runOnUiThread
                AlertDialog.Builder(act)
                    .setTitle("⚠️ Impressão parou")
                    .setMessage("$msg\n\nSaíram $feitos de $total ticket(s). Faltam ${total - feitos}.\n\n" +
                        "Arrume o papel e toque CONTINUAR — sai só o que faltou.")
                    .setPositiveButton("Continuar") { _, _ -> imprimirComRetomada(act, t, feitos, onFim) }
                    .setNegativeButton("Deixar") { _, _ -> onFim() }
                    .setCancelable(false)
                    .show()
            }
        }
    }

    /** Reimprimir o que JÁ saiu: só com login + PIN do supervisor (dono, 14/10).
     *  O servidor confere e registra quem liberou. */
    fun reimprimirComSupervisor(act: Activity, ticketId: Int) {
        val pad = (16 * act.resources.displayMetrics.density).toInt()
        val box = LinearLayout(act).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad / 2, pad, 0) }
        val loginIn = EditText(act).apply { hint = "Login do supervisor"; inputType = InputType.TYPE_CLASS_TEXT; isSingleLine = true }
        val pinIn = EditText(act).apply { hint = "PIN do supervisor"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD }
        box.addView(loginIn); box.addView(pinIn)
        AlertDialog.Builder(act)
            .setTitle("🔒 Reimprimir ticket $ticketId")
            .setMessage("Reimpressão só com a senha do supervisor.")
            .setView(box)
            .setPositiveButton("Reimprimir") { _, _ ->
                val tk = Session.token(act) ?: return@setPositiveButton
                val base = Session.servidor(act)
                val login = loginIn.text.toString().trim()
                val pin = pinIn.text.toString().trim()
                Thread {
                    try {
                        val j = Api.ticketReimprimir(base, tk, ticketId, login, pin)
                        act.runOnUiThread {
                            if (act.isFinishing || act.isDestroyed) return@runOnUiThread
                            val t = j.optJSONObject("ticket")
                            if (!j.optBoolean("ok") || t == null) {
                                Toast.makeText(act, j.optString("erro", "Não liberou"), Toast.LENGTH_LONG).show()
                                if (j.optBoolean("precisa")) reimprimirComSupervisor(act, ticketId)
                                return@runOnUiThread
                            }
                            if (t.optString("status") != "pago")
                                Toast.makeText(act, "Atenção: ticket ainda sem registro de pagamento no sistema", Toast.LENGTH_LONG).show()
                            t.put("_via", j.optInt("reimpressao", 1) + 1)
                            imprimirComRetomada(act, t)
                        }
                    } catch (e: Exception) {
                        act.runOnUiThread { Toast.makeText(act, e.message ?: "Falha", Toast.LENGTH_LONG).show() }
                    }
                }.start()
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }
}
