package com.concilia.garcom

import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONArray
import org.json.JSONObject

/**
 * MODO TOTEM — a LIO fica do lado do totem da recepção. O cliente monta o
 * pedido no totem e escolhe "Cartão"; esta tela pergunta ao servidor da loja
 * de 3 em 3 s (/api/lio/totem/fila), pega o pedido e abre a cobrança na
 * maquininha. O comprovante da Cielo sai aqui; os tickets saem na impressora
 * fixa da recepção (o servidor imprime quando o pagamento registra). Só se a
 * impressora da recepção falhar a LIO imprime os tickets ela mesma.
 *
 * Nunca cobra duas vezes: pedido com pagamento na fila de pendentes ou com
 * cobrança sem desfecho (EmAndamento) não é cobrado de novo.
 */
class TotemActivity : AppCompatActivity() {

    private val handler = Handler(Looper.getMainLooper())
    private lateinit var titulo: TextView
    private lateinit var detalhe: TextView
    private var cobrando = false
    private var consultando = false
    private var parado = false
    /** pedidos que esta tela já mandou pra maquininha (não pega de novo) */
    private val jaCobrados = mutableSetOf<Int>()

    private val tick = object : Runnable {
        override fun run() {
            consultar()
            handler.postDelayed(this, 3000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        title = "🍹 Modo totem"
        val raiz = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(48, 48, 48, 48)
            setBackgroundColor(Color.parseColor("#0E3B43"))
        }
        titulo = TextView(this).apply {
            textSize = 30f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }
        detalhe = TextView(this).apply {
            textSize = 18f
            setTextColor(Color.parseColor("#CFE8EC"))
            gravity = Gravity.CENTER
            setPadding(0, 32, 0, 48)
        }
        val sair = Button(this).apply {
            text = "Sair do modo totem"
            setOnClickListener { confirmarSair() }
        }
        raiz.addView(titulo)
        raiz.addView(detalhe)
        raiz.addView(sair)
        setContentView(raiz)
        mostrar("Esperando pedido", "Quando o cliente escolher 💳 Cartão no totem, a cobrança abre aqui sozinha.")
    }

    override fun onResume() {
        super.onResume()
        parado = false
        if (!Pagamento.pronto && Pagamento.configured()) Pagamento.bind(this, onReady = { }, onError = { })
        handler.removeCallbacks(tick)
        handler.post(tick)
    }

    override fun onPause() {
        super.onPause()
        parado = true
        handler.removeCallbacks(tick)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { confirmarSair() }

    private fun confirmarSair() {
        if (cobrando) return
        AlertDialog.Builder(this)
            .setTitle("Sair do modo totem?")
            .setMessage("Os pedidos no cartão do totem ficam esperando até outra maquininha entrar no modo totem.")
            .setPositiveButton("Sair") { _, _ -> finish() }
            .setNegativeButton("Ficar", null)
            .show()
    }

    private fun mostrar(t: String, d: String) {
        titulo.text = t
        detalhe.text = d
    }

    // ---- fila do servidor ----

    private fun consultar() {
        if (cobrando || consultando || parado) return
        val tk = Session.token(this) ?: return relogar()
        val base = Session.servidor(this)
        consultando = true
        Thread {
            try {
                reenviarPendentes(base, tk)
                val j = Api.totemFila(base, tk)
                val ped = j.optJSONObject("pedido")
                runOnUiThread {
                    consultando = false
                    if (isFinishing || isDestroyed) return@runOnUiThread
                    if (ped == null) {
                        if (!cobrando) mostrar("Esperando pedido",
                            "Quando o cliente escolher 💳 Cartão no totem, a cobrança abre aqui sozinha." +
                                (if (!j.optBoolean("impressora")) "\n\n⚠️ Impressora da recepção não cadastrada — os tickets vão sair nesta maquininha." else ""))
                    } else iniciar(ped)
                }
            } catch (e: Api.SemSessao) {
                runOnUiThread { consultando = false; relogar() }
            } catch (e: Exception) {
                runOnUiThread {
                    consultando = false
                    if (!cobrando) mostrar("Sem conexão com o servidor", (e.message ?: "falha de rede") + "\nTentando de novo…")
                }
            }
        }.start()
    }

    /** Pagamento aprovado que não registrou fica na fila — tenta de novo aqui
     *  (esta tela fica aberta o dia todo, a tela de mesas não roda). */
    private fun reenviarPendentes(base: String, tk: String) {
        for (p in Pendentes.listar(this)) {
            try {
                val r = Api.lioPagar(base, tk, p)
                if (r.ok || r.jaRegistrado) Pendentes.remover(this, p.optString("_id"))
            } catch (e: Api.SemSessao) {
                throw e
            } catch (_: Exception) { return }
        }
    }

    private fun iniciar(ped: JSONObject) {
        val id = ped.optInt("ticket_id", 0)
        val totalCents = Math.round(ped.optDouble("total", 0.0) * 100)
        if (id <= 0 || totalCents <= 0) return
        val ref = "TICKET-$id"
        // já cobrado e sem desfecho: NÃO cobra de novo — confere no terminal
        val pendente = Pendentes.listar(this).any { it.optInt("ticket_id", 0) == id }
        val emAndamento = EmAndamento.listar(this).any { it.optString("ref") == ref }
        if (pendente || emAndamento || id in jaCobrados) {
            mostrar("Pedido $id em conferência",
                "Esse pedido já passou na maquininha. Conferindo o pagamento — não cobre de novo.")
            if (emAndamento && !Pagamento.emCobranca) Recuperacao.rodar(this, System.currentTimeMillis()) { r ->
                runOnUiThread { if (!isFinishing && !isDestroyed) Recuperacao.avisar(this, r) }
            }
            return
        }
        if (!Pagamento.pronto) {
            mostrar("Maquininha não conectada", "Conectando ao terminal… o pedido $id continua esperando.")
            if (Pagamento.configured()) Pagamento.bind(this, onReady = { }, onError = { })
            liberar(id, desistiu = false)
            return
        }
        val itens = ped.optJSONArray("itens") ?: JSONArray()
        val linhas = mutableListOf<Linha>()
        for (i in 0 until itens.length()) {
            val o = itens.optJSONObject(i) ?: continue
            val v = Math.round(o.optDouble("valor", 0.0) * 100)
            linhas.add(Linha("${o.optInt("qtd", 1)}x " + o.optString("nome"), v))
        }
        val linhasOk = if (linhas.isNotEmpty() && linhas.sumOf { it.valorCentavos } == totalCents) linhas else emptyList()
        cobrando = true
        jaCobrados.add(id)
        mostrar("Pedido $id · ${Cupom.brl(totalCents / 100.0)}", "Cliente pagando na maquininha…")
        val destino = JSONObject().put("tipo", "ticket").put("ticket_id", id)
        Pagamento.cobrar(
            ref = ref,
            linhas = linhasOk,
            valorCentavos = totalCents,
            onInicio = { },
            onPago = { pedidoLio, pagamentos -> registrar(ped, pagamentos, pedidoLio) },
            onCancelado = {
                Recuperacao.evento(this, "cancelado", JSONObject().put("ref", ref).put("valor", totalCents / 100.0))
                jaCobrados.remove(id)
                liberar(id, desistiu = true)
                runOnUiThread { cobrando = false; mostrar("Pagamento cancelado", "Pedido $id cancelado. Esperando o próximo.") }
            },
            onErro = { m ->
                Recuperacao.evento(this, "erro", JSONObject().put("ref", ref).put("valor", totalCents / 100.0).put("erro", m))
                // erro antes de cobrar: o cliente desiste no totem ou tenta de novo
                jaCobrados.remove(id)
                liberar(id, desistiu = true)
                runOnUiThread { cobrando = false; mostrar("Falha na maquininha", "$m\n\nPeça pro cliente refazer no totem.") }
            },
            destino = destino,
            // o cliente escolheu no totem: crédito à vista ou débito, já no valor
            // (sem menu de Pix/parcelado). Servidor antigo sem o campo = menu de sempre.
            cartao = ped.optString("cartao", "").takeIf { it == "credito" || it == "debito" },
        )
    }

    private fun liberar(id: Int, desistiu: Boolean) {
        val tk = Session.token(this) ?: return
        val base = Session.servidor(this)
        Thread { try { Api.totemLiberar(base, tk, id, desistiu) } catch (_: Exception) { } }.start()
    }

    // Aprovado → fila de pendentes ANTES, registro com retry (igual ao ticket
    // da venda direta). O servidor imprime os tickets na recepção ao registrar.
    private fun registrar(ped: JSONObject, pagamentos: List<PagamentoLio>, pedidoLio: String) {
        val id = ped.optInt("ticket_id", 0)
        if (pagamentos.isEmpty()) {
            EmAndamento.marcarPago(this, pedidoLio)
            Recuperacao.evento(this, "vazio", JSONObject().put("pedido_lio", pedidoLio).put("ticket_id", id))
            runOnUiThread {
                cobrando = false
                mostrar("⚠️ Pedido $id: conferindo", "A maquininha aprovou mas não devolveu os dados. NÃO cobre de novo — " +
                    "o sistema confere no terminal e o ticket sai sozinho.")
            }
            return
        }
        val tk = Session.token(this)
        val base = Session.servidor(this)
        runOnUiThread { mostrar("Pedido $id aprovado", "Registrando…") }
        Thread {
            var registrou = true
            var impresso = false
            for (p in pagamentos) {
                val body = Api.bodyPagamento(0, p)
                    .put("ticket_id", id)
                    .put("descricao", p.descricao)
                    .put("adquirente", Pagamento.ADQUIRENTE)
                val fid = Pendentes.adicionar(this, body)
                if (p === pagamentos.last()) EmAndamento.fechar(this, pedidoLio)
                var okEste = false
                for (tentativa in 1..3) {
                    try {
                        if (tk == null) throw Api.SemSessao()
                        val r = Api.lioPagar(base, tk, body)
                        if (r.ok || r.jaRegistrado) {
                            okEste = true
                            Pendentes.remover(this, fid)
                            if (r.impressoTotem) impresso = true
                        }
                        break
                    } catch (e: Api.SemSessao) {
                        break
                    } catch (e: Exception) {
                        try { Thread.sleep(2000L * tentativa) } catch (_: InterruptedException) { }
                    }
                }
                if (!okEste) registrou = false
            }
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                val fim = {
                    cobrando = false
                    handler.postDelayed({ if (!cobrando) mostrar("Esperando pedido", "Quando o cliente escolher 💳 Cartão no totem, a cobrança abre aqui sozinha.") }, 6000)
                }
                when {
                    registrou && impresso -> {
                        mostrar("✅ Pedido $id pago", "Tickets saindo na impressora da recepção.")
                        fim()
                    }
                    registrou -> {
                        // impressora da recepção falhou ou não existe: imprime aqui
                        mostrar("✅ Pedido $id pago", "Imprimindo os tickets nesta maquininha…")
                        cobrando = true
                        Ticket.imprimirComRetomada(this, ped) { imprimirNota(id) { fim() } }
                    }
                    else -> {
                        // não imprime aqui: quando o registro passar o servidor
                        // imprime na recepção (sem ticket em dobro)
                        mostrar("✅ Pedido $id pago — registro pendente",
                            "Aprovado na maquininha, mas sem conexão com o sistema. Fica na fila e os tickets saem " +
                                "na recepção quando passar. NÃO cobre de novo.")
                        fim()
                    }
                }
            }
        }.start()
    }

    /** Recepção sem impressora: a NFC-e (que o servidor emite sozinho ao
     *  pagar) sai aqui, depois dos tickets. Espera a SEFAZ até ~45 s; se não
     *  vier, segue — a nota fica na fila da loja e não se perde. */
    private fun imprimirNota(id: Int, fim: () -> Unit) {
        val tk = Session.token(this) ?: return fim()
        val base = Session.servidor(this)
        mostrar("✅ Pedido $id pago", "🧾 Emitindo a nota fiscal…")
        Thread {
            var nota: Api.TotemNfce? = null
            for (tentativa in 1..15) {
                try {
                    val r = Api.totemNfce(base, tk, id)
                    if (r.pronta || r.fim) { nota = r; break }
                } catch (_: Exception) { }
                try { Thread.sleep(3000) } catch (_: InterruptedException) { }
            }
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                val n = nota
                if (n == null || !n.pronta || n.blocos.isEmpty()) {
                    mostrar("✅ Pedido $id pago", "Nota fiscal: " + (n?.aviso ?: "ainda sem resposta da SEFAZ — fica na fila da loja") + ".")
                    fim(); return@runOnUiThread
                }
                mostrar("✅ Pedido $id pago", "🧾 Imprimindo a nota fiscal nº ${n.numero ?: ""}…")
                Pagamento.imprimirBlocos(this, n.blocos,
                    onOk = { runOnUiThread { mostrar("✅ Pedido $id pago", "Tickets e nota fiscal impressos."); fim() } },
                    onErro = { m -> runOnUiThread { mostrar("✅ Pedido $id pago", "Nota autorizada, mas a impressão falhou: $m"); fim() } })
            }
        }.start()
    }

    // ---- sessão vencida: PIN do mesmo login (igual à venda direta) ----

    private var relogando = false

    private fun relogar() {
        if (relogando || isFinishing || isDestroyed) return
        val login = Session.login(this)
        if (login.isNullOrBlank()) {
            Session.clear(this)
            startActivity(android.content.Intent(this, LoginActivity::class.java))
            finishAffinity()
            return
        }
        relogando = true
        mostrar("Sessão expirou", "Digite o PIN de $login pra continuar no modo totem.")
        val pin = EditText(this).apply {
            hint = "PIN"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD
        }
        val caixa = LinearLayout(this).apply { setPadding(48, 16, 48, 0); addView(pin) }
        val d = AlertDialog.Builder(this)
            .setTitle("Sessão expirou")
            .setMessage("PIN de $login")
            .setView(caixa)
            .setNegativeButton("Sair") { _, _ -> relogando = false; finish() }
            .setPositiveButton("Entrar", null)
            .setCancelable(false)
            .create()
        d.setOnShowListener {
            val ok = d.getButton(AlertDialog.BUTTON_POSITIVE)
            ok.setOnClickListener {
                val p = pin.text.toString().trim()
                if (p.isEmpty()) { pin.error = "Digite o PIN"; return@setOnClickListener }
                ok.isEnabled = false
                val base = Session.servidor(this)
                Thread {
                    try {
                        val r = Api.entrar(base, login, p, null)
                        val token = r.optString("token", "")
                        runOnUiThread {
                            if (r.optBoolean("ok") && token.isNotBlank()) {
                                Session.save(this, token, login, r.optString("nome", "").ifBlank { Session.nome(this) },
                                    Session.podeDesconto(this), r.optBoolean("entregas", Session.entregas(this)))
                                relogando = false
                                d.dismiss()
                                mostrar("Esperando pedido", "Quando o cliente escolher 💳 Cartão no totem, a cobrança abre aqui sozinha.")
                            } else {
                                ok.isEnabled = true
                                pin.error = r.optString("erro", "").ifBlank { "PIN não confere" }
                            }
                        }
                    } catch (e: Exception) {
                        runOnUiThread { ok.isEnabled = true; pin.error = e.message ?: "Falha ao entrar" }
                    }
                }.start()
            }
        }
        d.show()
    }
}
