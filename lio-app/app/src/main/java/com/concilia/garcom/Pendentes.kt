package com.concilia.garcom

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

// Fila durável de baixas pendentes: o cartão JÁ FOI COBRADO na maquininha,
// mas o registro no vendas-local falhou (rede/servidor). O dinheiro não pode
// se perder — cada pagamento aprovado entra aqui ANTES da primeira tentativa
// e só sai depois do backend confirmar. A MesasActivity reenvia ao abrir e
// mostra um aviso enquanto houver pendência.
object Pendentes {
    private const val PREFS = "concilia_garcom_pendentes"
    private const val K_FILA = "fila"

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun fila(ctx: Context): JSONArray =
        try { JSONArray(prefs(ctx).getString(K_FILA, "[]")) } catch (_: Exception) { JSONArray() }

    private fun salvar(ctx: Context, arr: JSONArray) {
        prefs(ctx).edit().putString(K_FILA, arr.toString()).apply()
    }

    /** Registra a baixa a fazer. `pagamento` é o body pronto do /api/lio/pagar. */
    fun adicionar(ctx: Context, pagamento: JSONObject): String {
        val id = "${System.currentTimeMillis()}-${pagamento.optString("nsu")}"
        pagamento.put("_id", id)
        val arr = fila(ctx)
        arr.put(pagamento)
        salvar(ctx, arr)
        return id
    }

    fun remover(ctx: Context, id: String) {
        val arr = fila(ctx)
        val novo = JSONArray()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.optString("_id") != id) novo.put(o)
        }
        salvar(ctx, novo)
    }

    fun listar(ctx: Context): List<JSONObject> {
        val arr = fila(ctx)
        return (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
    }

    fun quantidade(ctx: Context): Int = fila(ctx).length()

    /** Esvazia a fila — pra pendente de pedido CANCELADO (ex.: teste), que
     *  nunca vai registrar. O pagamento não entra no sistema. */
    fun limpar(ctx: Context) = salvar(ctx, JSONArray())
}
