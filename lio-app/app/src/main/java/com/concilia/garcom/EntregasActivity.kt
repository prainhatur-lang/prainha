package com.concilia.garcom

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

// ENTREGAS (quem tem "Pedidos Delivery" no Consumer): a fila de entregas do
// site e do iFood que o caixa já aceitou. Pra cada uma, três toques na rota:
//   🛵 Saí     → o cliente recebe no WhatsApp que o pedido saiu (site) /
//                dispatch no iFood
//   🔔 Cheguei → WhatsApp "o entregador está na porta" (site)
//   ✅ Entregue
// e, quando o pedido é "pagar na entrega", o recebimento NA PORTA: cartão/Pix
// na maquininha (mesmo SDK da mesa) ou dinheiro. Quitou = o pedido fecha no
// Consumer no caixa do entregador e a NFC-e é oferecida na hora, impressa
// aqui mesmo. Pré-pago (site/app) não tem o que receber — a nota sai no caixa.
class EntregasActivity : AppCompatActivity() {

    private lateinit var lista: ListView
    private lateinit var vazio: TextView
    private lateinit var status: TextView
    private val adapter = EntregaAdapter()
    private val handler = Handler(Looper.getMainLooper())
    private var lioReady = false
    private var cobrando = false
    private val refresh = object : Runnable {
        override fun run() { carregar(); handler.postDelayed(this, 20_000) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_entregas)
        lista = findViewById(R.id.lista)
        vazio = findViewById(R.id.listaVazia)
        status = findViewById(R.id.lioStatus)
        findViewById<TextView>(R.id.lojaNome).text = Session.loja(this)
        findViewById<TextView>(R.id.garcomNome).text = "Entregador: " + (Session.nome(this) ?: Session.login(this) ?: "")
        findViewById<Button>(R.id.voltar).setOnClickListener { finish() }
        findViewById<Button>(R.id.atualizar).setOnClickListener { carregar() }
        lista.adapter = adapter
        bindMaquininha()
    }

    override fun onResume() {
        super.onResume()
        handler.removeCallbacks(refresh)
        handler.post(refresh)
    }

    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(refresh)
    }

    override fun onDestroy() {
        super.onDestroy()
        if (Pagamento.configured()) Pagamento.unbind()
    }

    // Fora da maquininha (celular) a tela serve pra rota — sem receber.
    private fun bindMaquininha() {
        if (!Pagamento.configured()) {
            status.visibility = View.VISIBLE
            status.text = "📱 Sem maquininha neste aparelho — dá pra avisar o cliente, receber só em dinheiro"
            return
        }
        status.visibility = View.VISIBLE
        status.text = "💳 Conectando à maquininha…"
        Pagamento.bind(
            this,
            onReady = { runOnUiThread { lioReady = true; status.visibility = View.GONE; adapter.notifyDataSetChanged() } },
            onError = { e ->
                runOnUiThread {
                    lioReady = false
                    status.visibility = View.VISIBLE
                    status.text = "⚠️ Maquininha indisponível: ${e.message ?: "erro"} — receba em dinheiro ou tente de novo"
                }
            },
        )
    }

    private fun carregar() {
        val tk = Session.token(this) ?: return semSessao()
        val base = Session.servidor(this)
        Thread {
            try {
                val itens = Api.entregas(base, tk)
                runOnUiThread {
                    adapter.itens = itens
                    adapter.notifyDataSetChanged()
                    vazio.visibility = if (itens.isEmpty()) View.VISIBLE else View.GONE
                }
            } catch (_: Api.SemSessao) {
                runOnUiThread { semSessao() }
            } catch (e: Exception) {
                runOnUiThread { Toast.makeText(this, "Sem resposta da loja: ${e.message}", Toast.LENGTH_SHORT).show() }
            }
        }.start()
    }

    private fun semSessao() {
        Session.clear(this)
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }

    // ---- ações simples da rota ----
    private fun acao(e: Api.Entrega, acao: String, confirmar: String? = null, depois: (() -> Unit)? = null) {
        val vai = {
            val tk = Session.token(this)
            val base = Session.servidor(this)
            Thread {
                try {
                    if (tk == null) throw Api.SemSessao()
                    val r = Api.entregaAcao(base, tk, acao, e.id)
                    runOnUiThread {
                        if (r.optBoolean("ok")) { depois?.invoke(); carregar() }
                        else Toast.makeText(this, r.optString("erro", "não deu"), Toast.LENGTH_LONG).show()
                    }
                } catch (_: Api.SemSessao) {
                    runOnUiThread { semSessao() }
                } catch (ex: Exception) {
                    runOnUiThread { Toast.makeText(this, "Falha de rede: ${ex.message}", Toast.LENGTH_LONG).show() }
                }
            }.start()
        }
        if (confirmar == null) vai()
        else AlertDialog.Builder(this)
            .setMessage(confirmar)
            .setPositiveButton("Sim") { _, _ -> vai() }
            .setNegativeButton("Não", null)
            .show()
    }

    // ---- receber na porta: maquininha ----
    private fun receber(e: Api.Entrega) {
        if (cobrando) return
        if (!lioReady) { Toast.makeText(this, "Maquininha ainda não conectou", Toast.LENGTH_SHORT).show(); return }
        val tk = Session.token(this) ?: return semSessao()
        val base = Session.servidor(this)
        cobrando = true
        Thread {
            try {
                // garante o pedido no Consumer e pega o saldo REAL (não o da lista)
                val c = Api.entregaAcao(base, tk, "conta", e.id)
                runOnUiThread {
                    if (!c.optBoolean("ok")) {
                        cobrando = false
                        Toast.makeText(this, c.optString("erro", "não deu pra preparar a cobrança"), Toast.LENGTH_LONG).show()
                        return@runOnUiThread
                    }
                    val ped = c.optInt("ped", 0)
                    val saldo = Math.round(c.optDouble("saldo", 0.0) * 100)
                    if (ped <= 0 || saldo <= 0) {
                        cobrando = false
                        Toast.makeText(this, "Nada a receber neste pedido", Toast.LENGTH_SHORT).show()
                        carregar()
                        return@runOnUiThread
                    }
                    cobrarNoTerminal(e, ped, saldo)
                }
            } catch (_: Api.SemSessao) {
                runOnUiThread { cobrando = false; semSessao() }
            } catch (ex: Exception) {
                runOnUiThread { cobrando = false; Toast.makeText(this, "Falha de rede: ${ex.message}", Toast.LENGTH_LONG).show() }
            }
        }.start()
    }

    private fun cobrarNoTerminal(e: Api.Entrega, ped: Int, valorCentavos: Long) {
        val linhas = e.itens.map { Linha("${it.qtd}x ${it.nome}", it.valorCentavos) }.toMutableList()
        if (e.taxaCentavos > 0) linhas.add(Linha("Taxa de entrega", e.taxaCentavos))
        Pagamento.cobrar(
            ref = "ENTREGA-" + e.displayId.ifBlank { ped.toString() },
            linhas = linhas,
            valorCentavos = valorCentavos,
            onInicio = { /* a UI de pagamento da maquininha assume a tela */ },
            onPago = { _, pagamentos -> registrarPagamentos(e, ped, pagamentos) },
            onCancelado = {
                runOnUiThread { cobrando = false; Toast.makeText(this, "Pagamento cancelado", Toast.LENGTH_SHORT).show() }
            },
            onErro = { msg ->
                runOnUiThread { cobrando = false; Toast.makeText(this, msg, Toast.LENGTH_LONG).show() }
            },
        )
    }

    // Aprovado no terminal → fila de pendentes ANTES, registro com retry, e só
    // então sai da fila (mesmo desenho da mesa: dinheiro capturado não se perde).
    private fun registrarPagamentos(e: Api.Entrega, ped: Int, pagamentos: List<PagamentoLio>) {
        val tk = Session.token(this)
        val base = Session.servidor(this)
        Thread {
            var quitada = false
            var registrouTudo = true
            var ultimoErro: String? = null
            for (p in pagamentos) {
                val body = Api.bodyPagamento(0, p)
                    .put("ped", ped)                          // entrega: número 0 serve pra várias
                    .put("descricao", p.descricao)
                    .put("adquirente", Pagamento.ADQUIRENTE)
                val id = Pendentes.adicionar(this, body)
                var okEste = false
                for (tentativa in 1..3) {
                    try {
                        if (tk == null) throw Api.SemSessao()
                        val r = Api.lioPagar(base, tk, body)
                        if (r.ok || r.jaRegistrado) {
                            okEste = true
                            quitada = quitada || r.quitada
                            Pendentes.remover(this, id)
                        } else {
                            ultimoErro = r.erro
                        }
                        break
                    } catch (ex: Api.SemSessao) {
                        ultimoErro = ex.message
                        break
                    } catch (ex: Exception) {
                        ultimoErro = ex.message
                        try { Thread.sleep(2000L * tentativa) } catch (_: InterruptedException) { }
                    }
                }
                if (!okEste) registrouTudo = false
            }
            val total = pagamentos.sumOf { it.valorCentavos }
            runOnUiThread {
                cobrando = false
                val p = pagamentos.firstOrNull()
                val detalhe = p?.let {
                    "${it.forma.uppercase()} ${it.bandeira}" +
                        (if (it.mask.takeLast(4).isNotBlank()) " **** ${it.mask.takeLast(4)}" else "") +
                        (if (it.nsu.isNotBlank()) "\nNSU ${it.nsu} · AUT ${it.autorizacao}" else "")
                } ?: ""
                val msg = StringBuilder("Recebido ${Cupom.brl(total / 100.0)} — entrega ${e.displayId}\n$detalhe")
                if (quitada) msg.append("\n\n🎉 Pedido quitado!")
                if (!registrouTudo) msg.append(
                    "\n\n⚠️ O pagamento foi APROVADO na maquininha mas ainda não foi registrado no sistema" +
                        (ultimoErro?.let { " ($it)" } ?: "") +
                        ". Ficou na fila — reenvie na tela de mesas assim que a rede voltar."
                )
                AlertDialog.Builder(this)
                    .setTitle(if (registrouTudo) "✅ Pago!" else "⚠️ Pago — registro pendente")
                    .setMessage(msg.toString())
                    .setPositiveButton("OK") { _, _ ->
                        // NFC-e na porta: quem quer nota está na frente do entregador agora
                        if (registrouTudo && quitada) nfcePerguntar(ped) { carregar() } else carregar()
                    }
                    .setCancelable(false)
                    .show()
            }
        }.start()
    }

    // ---- receber na porta: dinheiro ----
    private fun dinheiro(e: Api.Entrega) {
        val saldoIni = if (e.pedidoFb == null) e.totalCentavos else e.saldoCentavos
        val valorIn = EditText(this)
        valorIn.hint = "valor recebido"
        valorIn.inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL
        valorIn.setText(String.format(java.util.Locale.US, "%.2f", saldoIni / 100.0))
        AlertDialog.Builder(this)
            .setTitle("💵 Dinheiro — entrega ${e.displayId}")
            .setMessage("A receber: ${Cupom.brl(saldoIni / 100.0)}. Confirme o valor que o cliente entregou (entra no SEU caixa).")
            .setView(caixa(valorIn))
            .setPositiveButton("✓ Recebi") { _, _ ->
                val v = valorIn.text.toString().replace(',', '.').toDoubleOrNull() ?: 0.0
                if (v <= 0) { Toast.makeText(this, "Valor inválido", Toast.LENGTH_SHORT).show(); return@setPositiveButton }
                val tk = Session.token(this) ?: return@setPositiveButton semSessao()
                val base = Session.servidor(this)
                Thread {
                    try {
                        val r = Api.entregaAcao(base, tk, "dinheiro", e.id, org.json.JSONObject().put("valor", v))
                        runOnUiThread {
                            if (!r.optBoolean("ok")) { Toast.makeText(this, r.optString("erro", "não deu"), Toast.LENGTH_LONG).show(); return@runOnUiThread }
                            val quitada = r.optBoolean("quitada")
                            val ped = e.pedidoFb ?: 0
                            Toast.makeText(this, if (quitada) "🎉 Recebido e quitado" else "Recebido — falta ${Cupom.brl(r.optDouble("saldo", 0.0))}", Toast.LENGTH_LONG).show()
                            if (quitada && ped > 0) nfcePerguntar(ped) { carregar() } else if (quitada) nfcePorConta(e) else carregar()
                        }
                    } catch (_: Api.SemSessao) {
                        runOnUiThread { semSessao() }
                    } catch (ex: Exception) {
                        runOnUiThread { Toast.makeText(this, "Falha de rede: ${ex.message}", Toast.LENGTH_LONG).show() }
                    }
                }.start()
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    /** Dinheiro num pedido que ainda não tinha código: pergunta o código à loja e segue pra nota. */
    private fun nfcePorConta(e: Api.Entrega) {
        val tk = Session.token(this) ?: return carregar()
        val base = Session.servidor(this)
        Thread {
            val ped = try { Api.entregaAcao(base, tk, "conta", e.id).optInt("ped", 0) } catch (_: Exception) { 0 }
            runOnUiThread { if (ped > 0) nfcePerguntar(ped) { carregar() } else carregar() }
        }.start()
    }

    // ---- NFC-e na porta (mesmo fluxo da mesa, com o pedido explícito) ----
    private fun nfcePerguntar(ped: Int, depois: () -> Unit) {
        val tk = Session.token(this) ?: return depois()
        Thread {
            val info = Api.nfceInfo(Session.servidor(this), tk, 0, ped)
            runOnUiThread {
                if (info == null || isFinishing) { depois(); return@runOnUiThread }
                nfceDialog(ped, info, info.documentoSugerido, depois)
            }
        }.start()
    }

    private fun nfceDialog(ped: Int, info: Api.NfceInfo, docInicial: String?, depois: () -> Unit) {
        if (info.emitida) {
            AlertDialog.Builder(this)
                .setTitle("🧾 Nota já emitida")
                .setMessage("A NFC-e nº ${info.notaNumero ?: "?"} deste pedido já foi autorizada.")
                .setPositiveButton("🖨 Reimprimir DANFE") { _, _ -> nfceEmitirNota(ped, null, depois) }
                .setNegativeButton("OK") { _, _ -> depois() }
                .setOnCancelListener { depois() }
                .show()
            return
        }
        val docIn = EditText(this)
        docIn.hint = "CPF/CNPJ (vazio = sem CPF)"
        docIn.inputType = android.text.InputType.TYPE_CLASS_NUMBER
        if (!docInicial.isNullOrBlank()) docIn.setText(docInicial)
        val msg = StringBuilder("Cliente quer nota? Informe o CPF/CNPJ ou deixe vazio.")
        if (!info.documentoSugerido.isNullOrBlank()) msg.append("\nCPF do pedido já preenchido — confirme ou apague.")
        if (info.homologacao) msg.append("\n(ambiente de HOMOLOGAÇÃO — sem valor fiscal)")
        AlertDialog.Builder(this)
            .setTitle("🧾 Emitir nota fiscal (NFC-e)?")
            .setMessage(msg.toString())
            .setView(caixa(docIn))
            .setPositiveButton("✓ Emitir nota") { _, _ ->
                val doc = docIn.text.toString().filter { it.isDigit() }
                if (doc.isNotEmpty() && !nfceDocValido(doc)) {
                    Toast.makeText(this, "CPF/CNPJ inválido — confira os dígitos", Toast.LENGTH_LONG).show()
                    nfceDialog(ped, info, doc, depois)
                    return@setPositiveButton
                }
                nfceEmitirNota(ped, doc.ifEmpty { null }, depois)
            }
            .setNegativeButton("Sem nota") { _, _ -> depois() }
            .setOnCancelListener { depois() }
            .show()
    }

    private fun nfceEmitirNota(ped: Int, documento: String?, depois: () -> Unit) {
        val tk = Session.token(this) ?: return depois()
        val espera = AlertDialog.Builder(this)
            .setMessage("🧾 Emitindo NFC-e — falando com a SEFAZ…")
            .setCancelable(false)
            .create()
        espera.show()
        Thread {
            try {
                val r = Api.nfceEmitir(Session.servidor(this), tk, 0, documento, ped)
                runOnUiThread {
                    espera.dismiss()
                    if (!r.ok && r.pendente) {
                        AlertDialog.Builder(this)
                            .setTitle("🕐 Nota na fila")
                            .setMessage("SEFAZ/central sem resposta agora. A nota ficou na fila da loja e sai sozinha (o DANFE imprime no caixa).")
                            .setPositiveButton("OK") { _, _ -> depois() }
                            .setOnCancelListener { depois() }
                            .show()
                        return@runOnUiThread
                    }
                    if (!r.ok) {
                        AlertDialog.Builder(this)
                            .setTitle("✗ Nota não saiu")
                            .setMessage((r.erro ?: "falhou") + "\n\nO recebimento está registrado; a nota pode sair depois pelo caixa.")
                            .setPositiveButton("OK") { _, _ -> depois() }
                            .setOnCancelListener { depois() }
                            .show()
                        return@runOnUiThread
                    }
                    if (r.blocos.isEmpty() || !Pagamento.configured()) {
                        Toast.makeText(this, "NFC-e nº ${r.notaNumero ?: "?"} autorizada", Toast.LENGTH_LONG).show()
                        depois()
                        return@runOnUiThread
                    }
                    Pagamento.imprimirBlocos(
                        this, r.blocos,
                        onOk = { runOnUiThread { Toast.makeText(this, "NFC-e nº ${r.notaNumero ?: "?"} impressa", Toast.LENGTH_SHORT).show(); depois() } },
                        onErro = { m ->
                            runOnUiThread {
                                Toast.makeText(this, "Nota autorizada, mas a impressão falhou: $m", Toast.LENGTH_LONG).show()
                                depois()
                            }
                        },
                    )
                }
            } catch (ex: Exception) {
                runOnUiThread {
                    espera.dismiss()
                    Toast.makeText(this, "Falha de rede na nota: ${ex.message} — sai depois pelo caixa", Toast.LENGTH_LONG).show()
                    depois()
                }
            }
        }.start()
    }

    private fun nfceDocValido(d: String): Boolean {
        if (d.all { it == d[0] }) return false
        if (d.length == 11) {
            fun dv(p: Int): Int {
                var s = 0
                for (i in 0 until p) s += (d[i] - '0') * (p + 1 - i)
                return ((s * 10) % 11) % 10
            }
            return dv(9) == d[9] - '0' && dv(10) == d[10] - '0'
        }
        if (d.length == 14) {
            fun dv(base: String): Int {
                var s = 0; var p = 2
                for (i in base.length - 1 downTo 0) { s += (base[i] - '0') * p; p = if (p == 9) 2 else p + 1 }
                val r = s % 11
                return if (r < 2) 0 else 11 - r
            }
            return dv(d.substring(0, 12)) == d[12] - '0' && dv(d.substring(0, 13)) == d[13] - '0'
        }
        return false
    }

    private fun caixa(vararg views: View): LinearLayout {
        val box = LinearLayout(this)
        box.orientation = LinearLayout.VERTICAL
        val d = resources.displayMetrics.density
        box.setPadding((20 * d).toInt(), (8 * d).toInt(), (20 * d).toInt(), 0)
        views.forEach {
            box.addView(it, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        return box
    }

    private fun ligar(fone: String) {
        try { startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + fone.filter { it.isDigit() || it == '+' }))) }
        catch (_: Exception) { Toast.makeText(this, fone, Toast.LENGTH_LONG).show() }
    }

    // ---- lista ----
    inner class EntregaAdapter : BaseAdapter() {
        var itens: List<Api.Entrega> = emptyList()
        override fun getCount() = itens.size
        override fun getItem(i: Int) = itens[i]
        override fun getItemId(i: Int) = i.toLong()
        override fun getView(i: Int, conv: View?, parent: ViewGroup?): View {
            val v = conv ?: layoutInflater.inflate(R.layout.item_entrega, parent, false)
            val e = itens[i]
            val aReceber = !e.pagoOnline && !e.pagoEntrega
            val saldo = if (e.pedidoFb == null) e.totalCentavos else e.saldoCentavos
            v.findViewById<TextView>(R.id.titulo).text =
                (if (e.canal == "site") "SITE " else "iFood #") + e.displayId + (e.cliente?.let { " · $it" } ?: "")
            v.findViewById<TextView>(R.id.endereco).apply {
                text = e.endereco ?: "sem endereço"
                visibility = View.VISIBLE
            }
            v.findViewById<TextView>(R.id.fone).apply {
                if (e.fone.isNullOrBlank()) visibility = View.GONE
                else { visibility = View.VISIBLE; text = "📞 " + e.fone; setOnClickListener { ligar(e.fone) } }
            }
            v.findViewById<TextView>(R.id.valor).text = Cupom.brl(e.totalCentavos / 100.0) + " · " + when {
                e.pagoOnline -> "JÁ PAGO no ${if (e.canal == "site") "site" else "app"}"
                e.pagoEntrega || (e.pedidoFb != null && saldo <= 0) -> "RECEBIDO na entrega"
                e.pedidoFb != null && e.pagoCentavos > 0 -> "falta ${Cupom.brl(saldo / 100.0)}"
                else -> "RECEBER NA ENTREGA"
            }
            v.findViewById<TextView>(R.id.itens).text =
                e.itens.joinToString("\n") { "${it.qtd}x ${it.nome}" + (it.detalhes?.let { d -> "  ($d)" } ?: "") }
            v.findViewById<TextView>(R.id.rota).apply {
                val quem = e.entregador?.let { " · $it" } ?: ""
                text = when {
                    e.chegou -> "🔔 na porta$quem"
                    e.saiu -> "🛵 em rota$quem"
                    else -> "⏳ aguardando saída"
                }
            }
            val saiu = v.findViewById<Button>(R.id.saiu)
            val cheguei = v.findViewById<Button>(R.id.cheguei)
            val entregue = v.findViewById<Button>(R.id.entregue)
            val receber = v.findViewById<Button>(R.id.receber)
            val dinheiro = v.findViewById<Button>(R.id.dinheiro)
            saiu.visibility = if (!e.saiu) View.VISIBLE else View.GONE
            cheguei.visibility = if (e.saiu && !e.chegou) View.VISIBLE else View.GONE
            entregue.visibility = if (e.saiu && !aReceber) View.VISIBLE else View.GONE
            receber.visibility = if (aReceber && saldo > 0) View.VISIBLE else View.GONE
            receber.isEnabled = lioReady && !cobrando
            receber.text = if (lioReady) "💳 Receber ${Cupom.brl(saldo / 100.0)}" else "💳 maquininha…"
            dinheiro.visibility = if (aReceber && saldo > 0) View.VISIBLE else View.GONE
            saiu.setOnClickListener { acao(e, "saiu", "Saiu com o pedido ${e.displayId}? O cliente é avisado.") }
            cheguei.setOnClickListener { acao(e, "cheguei") }
            entregue.setOnClickListener { acao(e, "concluir", "Marcar ${e.displayId} como ENTREGUE?") }
            receber.setOnClickListener { receber(e) }
            dinheiro.setOnClickListener { dinheiro(e) }
            return v
        }
    }
}
