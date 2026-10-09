package com.concilia.garcom

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

// COBRANÇA EM ANDAMENTO — a anotação que faltava entre "abri a tela da Cielo" e
// "a Cielo me avisou que pagou".
//
// O aviso do pagamento chega por um receptor que mora NA MEMÓRIA do nosso app.
// Se o Android derruba o app enquanto a tela da Cielo está na frente (o Pix
// fica MINUTOS esperando o cliente; o débito pede senha), ou se o SDK tropeça
// ao montar o pedido pago, o aviso se perde: o cartão/Pix foi aprovado, a
// conta continua aberta e o caixa fecha na mão (Bar, Mar e Tabuará, 06–09/10/2026
// — sempre Pix e débito; o crédito por aproximação volta em segundos).
//
// Então cada cobrança é anotada AQUI antes da tela da Cielo abrir (número do
// pedido no terminal + pra qual conta é) e só é riscada quando o desfecho é
// conhecido. O que sobrar é conferido direto no terminal pela `Recuperacao`.
object EmAndamento {
    private const val PREFS = "concilia_garcom_em_andamento"
    private const val K_LISTA = "lista"

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun lista(ctx: Context): JSONArray =
        try { JSONArray(prefs(ctx).getString(K_LISTA, "[]")) } catch (_: Exception) { JSONArray() }

    // commit() e não apply(): logo depois a tela da Cielo cobre o app — se o
    // processo morrer com a gravação ainda na fila, a anotação some junto.
    private fun salvar(ctx: Context, arr: JSONArray) {
        try { prefs(ctx).edit().putString(K_LISTA, arr.toString()).commit() } catch (_: Exception) { }
    }

    /** Anota a cobrança. `destino` diz onde o dinheiro entra (ver Recuperacao). */
    @Synchronized
    fun abrir(ctx: Context, pedidoId: String, ref: String, valorCentavos: Long, destino: JSONObject) {
        if (pedidoId.isBlank()) return
        val arr = lista(ctx)
        val novo = JSONArray()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.optString("pedido") != pedidoId) novo.put(o)
        }
        novo.put(JSONObject()
            .put("pedido", pedidoId)
            .put("ref", ref)
            .put("valor", valorCentavos)
            .put("inicio", System.currentTimeMillis())
            .put("destino", destino))
        salvar(ctx, novo)
    }

    /** Risca a anotação: o desfecho é conhecido (pago e na fila, cancelado, erro). */
    @Synchronized
    fun fechar(ctx: Context, pedidoId: String) {
        if (pedidoId.isBlank()) return
        val arr = lista(ctx)
        val novo = JSONArray()
        var mudou = false
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.optString("pedido") == pedidoId) mudou = true else novo.put(o)
        }
        if (mudou) salvar(ctx, novo)
    }

    /** A Cielo disse "pago" mas não entregou a transação: a anotação fica e
     *  passa a esperar mais tempo pela resposta do terminal (ver Recuperacao). */
    @Synchronized
    fun marcarPago(ctx: Context, pedidoId: String) {
        if (pedidoId.isBlank()) return
        val arr = lista(ctx)
        var mudou = false
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.optString("pedido") == pedidoId && !o.optBoolean("pago")) { o.put("pago", true); mudou = true }
        }
        if (mudou) salvar(ctx, arr)
    }

    @Synchronized
    fun listar(ctx: Context): List<JSONObject> {
        val arr = lista(ctx)
        return (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
    }

    fun quantidade(ctx: Context): Int = lista(ctx).length()
}
