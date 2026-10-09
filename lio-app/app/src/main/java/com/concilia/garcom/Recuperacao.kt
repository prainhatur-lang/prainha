package com.concilia.garcom

import android.app.Activity
import android.content.Context
import androidx.appcompat.app.AlertDialog
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

// RECUPERAÇÃO — o que fazer com a cobrança que ficou sem desfecho.
//
// A `EmAndamento` guarda cada cobrança desde antes da tela da Cielo abrir. O
// que sobra lá é cobrança cujo aviso não chegou (app derrubado com a tela da
// Cielo na frente, SDK que tropeçou). Aqui o app pergunta ao TERMINAL o que
// houve com cada pedido e:
//   • transação aprovada, de pé, no valor exato pedido → monta o MESMO corpo
//     que a tela montaria, põe na fila de pendentes e manda pro servidor;
//   • cancelamento/estorno no pedido, ou valor diferente → não lança nada,
//     só avisa pra conferir no caixa;
//   • nenhuma transação → espera (o cliente pode ter desistido) e esquece
//     depois de um tempo;
//   • terminal não respondeu → tenta de novo na próxima vez.
//
// Lançar duas vezes não acontece: o servidor reconhece o NSU (e a mesma
// transação digitada à mão no caixa) e responde "já registrado".
object Recuperacao {

    data class Resultado(
        val recuperados: Int = 0,        // baixas que entraram no sistema agora
        val valorCentavos: Long = 0,
        val naFila: Int = 0,             // aprovadas, ainda na fila de pendentes
        val duvidosos: Int = 0,          // pedem conferência no caixa
        val linhas: List<String> = emptyList(),
    ) {
        val temAviso: Boolean get() = recuperados > 0 || naFila > 0 || duvidosos > 0
    }

    private val rodando = AtomicBoolean(false)

    // Pedido sem transação: o Pix fica minutos na tela; duas horas cobre com
    // folga e ainda limpa a cobrança de que o cliente desistiu.
    private const val ESPERA_SEM_TRANSACAO = 2 * 60 * 60 * 1000L
    private const val ESPERA_MAXIMA = 24 * 60 * 60 * 1000L

    /**
     * Confere as cobranças anotadas ANTES de `ate` (as de depois ainda estão na
     * tela da Cielo). Roda fora da tela; `onFim` só é chamado quando há o que
     * mostrar, e fora da thread de tela.
     */
    fun rodar(ctx: Context, ate: Long, onFim: (Resultado) -> Unit) {
        val app = ctx.applicationContext
        if (EmAndamento.quantidade(app) == 0) return
        if (!rodando.compareAndSet(false, true)) return
        Thread {
            val r = try { conferir(app, ate) } catch (_: Throwable) { Resultado() } finally { rodando.set(false) }
            if (r.temAviso) try { onFim(r) } catch (_: Throwable) { }
        }.start()
    }

    private fun conferir(ctx: Context, ate: Long): Resultado {
        var recuperados = 0
        var valor = 0L
        var naFila = 0
        var duvidosos = 0
        val linhas = mutableListOf<String>()
        val agora = System.currentTimeMillis()

        for (reg in EmAndamento.listar(ctx)) {
            val pedido = reg.optString("pedido")
            val inicio = reg.optLong("inicio", 0L)
            if (pedido.isBlank() || inicio >= ate) continue
            val idade = agora - inicio
            val esperado = reg.optLong("valor", 0L)
            val destino = reg.optJSONObject("destino") ?: JSONObject()
            val nome = nomeDe(destino, reg.optString("ref"))
            val rastro = JSONObject().put("pedido_lio", pedido).put("ref", reg.optString("ref"))
                .put("valor", esperado / 100.0).put("inicio", inicio)

            val t = if (Pagamento.pronto) try { Pagamento.consultarPedido(pedido) } catch (_: Throwable) { null } else null
            if (t == null) {
                if (idade > ESPERA_MAXIMA) { EmAndamento.fechar(ctx, pedido); evento(ctx, "sem_resposta", rastro) }
                continue
            }
            if (t.duvidoso) {
                EmAndamento.fechar(ctx, pedido)
                duvidosos++
                linhas.add("⚠️ $nome · ${Cupom.brl(esperado / 100.0)}: a maquininha mostra CANCELAMENTO nesse pedido. Não lancei nada — confira no caixa antes de cobrar de novo.")
                evento(ctx, "duvidoso", rastro.put("status", t.status))
                continue
            }
            if (t.pagamentos.isEmpty()) {
                val disseQuePagou = reg.optBoolean("pago")
                if (idade > (if (disseQuePagou) ESPERA_MAXIMA else ESPERA_SEM_TRANSACAO)) {
                    EmAndamento.fechar(ctx, pedido)
                    evento(ctx, if (disseQuePagou) "pago_sem_dados" else "abandonada", rastro.put("status", t.status))
                }
                continue
            }
            val soma = t.pagamentos.sumOf { it.valorCentavos }
            if (esperado > 0 && soma != esperado) {
                EmAndamento.fechar(ctx, pedido)
                duvidosos++
                linhas.add("⚠️ $nome: pedi ${Cupom.brl(esperado / 100.0)} e a maquininha tem ${Cupom.brl(soma / 100.0)} aprovado nesse pedido. Não lancei nada — confira no caixa.")
                evento(ctx, "valor_diferente", rastro.put("aprovado", soma / 100.0))
                continue
            }
            val corpos = corposDe(destino, t.pagamentos, inicio, pedido)
            if (corpos.isEmpty()) {
                EmAndamento.fechar(ctx, pedido)
                duvidosos++
                linhas.add("⚠️ ${Cupom.brl(soma / 100.0)} aprovado na maquininha (${reg.optString("ref")}) sem conta de destino. Não lancei nada — confira no caixa.")
                evento(ctx, "sem_destino", rastro)
                continue
            }

            // Fila de pendentes ANTES (gravada no aparelho), anotação riscada
            // DEPOIS — daqui pra frente o pagamento é da fila, igual ao normal.
            val ids = corpos.map { c ->
                val id = Pendentes.adicionar(ctx, c)
                try { Thread.sleep(3) } catch (_: InterruptedException) { }   // _id é o relógio: um por milissegundo
                id
            }
            EmAndamento.fechar(ctx, pedido)

            val tk = Session.token(ctx)
            val base = Session.servidor(ctx)
            val forma = t.pagamentos.first().forma.uppercase()
            var entrou = 0
            var jaTinha = 0
            var ficou = 0
            var quitou = false
            var obs: String? = null
            for ((i, corpo) in corpos.withIndex()) {
                try {
                    if (tk == null) throw Api.SemSessao()
                    val r = Api.lioPagar(base, tk, corpo)
                    if (r.ok && !r.jaRegistrado) { Pendentes.remover(ctx, ids[i]); entrou++; quitou = quitou || r.quitada }
                    else if (r.ok || r.jaRegistrado) { Pendentes.remover(ctx, ids[i]); jaTinha++; if (!r.ok) obs = r.erro }
                    else { ficou++; obs = r.erro }
                } catch (e: Exception) {
                    ficou++
                    obs = e.message
                }
            }
            val quanto = Cupom.brl(soma / 100.0)
            if (entrou > 0) {
                recuperados += entrou
                valor += soma
                linhas.add("✅ $nome · $quanto ($forma) — lançado" + (if (quitou) " e a conta fechou." else "."))
            }
            if (ficou > 0) {
                naFila += ficou
                linhas.add("⚠️ $nome · $quanto ($forma) aprovado na maquininha e ainda NÃO registrado" +
                    (obs?.let { " ($it)" } ?: "") + ". Ficou na fila — reenvie na tela de mesas.")
            } else if (entrou == 0 && jaTinha > 0 && obs != null) {
                // o servidor já tinha esse pagamento e explicou (ex.: retido no caixa)
                duvidosos++
                linhas.add("⚠️ $nome · $quanto ($forma): $obs")
            }
        }
        return Resultado(recuperados, valor, naFila, duvidosos, linhas)
    }

    private fun nomeDe(destino: JSONObject, ref: String): String = when (destino.optString("tipo")) {
        "conta" -> (if (ref.startsWith("COMANDA")) "Comanda " else "Mesa ") + destino.optInt("numero")
        "rateio" -> "Mesa + comandas ($ref)"
        "entrega" -> "Entrega " + destino.optString("display_id").ifBlank { destino.optInt("ped").toString() }
        else -> ref
    }

    // Os MESMOS corpos que ContaActivity / EntregasActivity mandam quando o
    // aviso chega — mais a hora em que a cobrança começou (é ela que diz ao
    // servidor de qual conta é o dinheiro) e a marca de recuperado.
    private fun corposDe(destino: JSONObject, pagos: List<PagamentoLio>, inicio: Long, pedido: String): List<JSONObject> {
        val out = mutableListOf<JSONObject>()
        fun carimbar(b: JSONObject): JSONObject =
            b.put("aprovado_em", inicio).put("recuperado", true).put("pedido_lio", pedido)
        when (destino.optString("tipo")) {
            "conta" -> {
                val numero = destino.optInt("numero", 0)
                if (numero <= 0) return out
                val fid = destino.optStringOrNull("fid_uso")
                for (p in pagos) {
                    val b = Api.bodyPagamento(numero, p)
                        .put("descricao", p.descricao)
                        .put("adquirente", Pagamento.ADQUIRENTE)
                    if (fid != null) b.put("fid_uso", fid)
                    out.add(carimbar(b))
                }
            }
            "rateio" -> {
                val p = pagos.firstOrNull() ?: return out
                val parcelas = destino.optJSONArray("parcelas") ?: return out
                for (i in 0 until parcelas.length()) {
                    val o = parcelas.optJSONObject(i) ?: continue
                    val cents = o.optLong("centavos", 0L)
                    val numero = o.optInt("numero", 0)
                    if (cents <= 0 || numero <= 0) continue
                    out.add(carimbar(JSONObject()
                        .put("numero", numero)
                        .put("forma", p.forma)
                        .put("valor", cents / 100.0)
                        .put("nsu", p.nsu)
                        .put("autorizacao", p.autorizacao)
                        .put("bandeira", p.bandeira)
                        .put("descricao", p.descricao)
                        .put("adquirente", Pagamento.ADQUIRENTE)))
                }
            }
            "entrega" -> {
                val ped = destino.optInt("ped", 0)
                if (ped <= 0) return out
                for (p in pagos) {
                    out.add(carimbar(Api.bodyPagamento(0, p)
                        .put("ped", ped)
                        .put("descricao", p.descricao)
                        .put("adquirente", Pagamento.ADQUIRENTE)))
                }
            }
        }
        return out
    }

    /** O aviso do que a recuperação fez. Chamar na thread de tela. */
    fun avisar(tela: Activity, r: Resultado) {
        if (!r.temAviso || tela.isFinishing || tela.isDestroyed) return
        val limpo = r.naFila == 0 && r.duvidosos == 0
        val abre = if (r.recuperados > 0)
            "A maquininha tinha aprovado e o aviso não chegou no sistema. Conferi direto no terminal:\n\n"
        else ""
        try {
            AlertDialog.Builder(tela)
                .setTitle(if (limpo) "✅ Pagamento recuperado" else "⚠️ Confira no caixa")
                .setMessage(abre + r.linhas.joinToString("\n\n"))
                .setPositiveButton("OK", null)
                .setCancelable(false)
                .show()
        } catch (_: Throwable) { }
    }

    /**
     * Rastro pro servidor da loja (cobrança cancelada, erro da maquininha,
     * pedido abandonado…). É só diagnóstico: calado, sem sessão não manda, e
     * servidor antigo (sem a rota) é ignorado.
     */
    fun evento(ctx: Context, tipo: String, dados: JSONObject? = null) {
        try {
            val app = ctx.applicationContext
            val tk = Session.token(app) ?: return
            val base = Session.servidor(app)
            val corpo = JSONObject()
            if (dados != null) for (k in dados.keys()) corpo.put(k, dados.opt(k))
            corpo.put("tipo", tipo).put("agora", System.currentTimeMillis())
            Thread { Api.lioEvento(base, tk, corpo) }.start()
        } catch (_: Throwable) { }
    }
}
