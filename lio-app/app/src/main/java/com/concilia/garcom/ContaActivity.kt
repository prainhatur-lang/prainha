package com.concilia.garcom

import android.content.Intent
import android.os.Bundle
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
import org.json.JSONObject

// Conta da mesa/comanda — números AO VIVO do Firebird (GET /api/conta).
// Daqui o garçom: lança itens (ProdutosActivity), pede a conta (trava novos
// lançamentos), imprime a conferência na térmica da maquininha, e RECEBE no
// terminal (Order Manager SDK) — integral ou parcial. Pagamento aprovado:
// entra na fila de pendentes ANTES do registro, registra no vendas-local
// (retry 3x) e sai da fila — dinheiro capturado não se perde nem duplica.
class ContaActivity : AppCompatActivity() {

    private var numero = 0
    private var ehComanda = false
    private var conta: Api.Conta? = null
    private var lioReady = false
    private var cobrando = false

    private lateinit var titulo: TextView
    private lateinit var badge: TextView
    private lateinit var comandasBox: LinearLayout
    private lateinit var lista: ListView
    private lateinit var vazio: TextView
    private lateinit var resumo: TextView
    private lateinit var lancarBtn: Button
    private lateinit var conferenciaBtn: Button
    private lateinit var contaPedidaBtn: Button
    private lateinit var receberBtn: Button
    private lateinit var lioStatus: TextView

    private val adapter = ItemAdapter()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_conta)
        numero = intent.getIntExtra("numero", 0)
        ehComanda = Session.ehComanda(this, numero)

        titulo = findViewById(R.id.titulo)
        badge = findViewById(R.id.badge)
        comandasBox = findViewById(R.id.comandas)
        lista = findViewById(R.id.itens)
        vazio = findViewById(R.id.contaVazia)
        resumo = findViewById(R.id.resumo)
        lancarBtn = findViewById(R.id.lancar)
        conferenciaBtn = findViewById(R.id.conferencia)
        contaPedidaBtn = findViewById(R.id.contaPedida)
        receberBtn = findViewById(R.id.receber)
        lioStatus = findViewById(R.id.lioStatus)

        titulo.text = if (ehComanda) "Comanda $numero" else "Mesa $numero"
        findViewById<Button>(R.id.voltar).setOnClickListener { finish() }
        lancarBtn.setOnClickListener { lancar() }
        conferenciaBtn.setOnClickListener { imprimirConferencia() }
        contaPedidaBtn.setOnClickListener { alternarContaPedida() }
        receberBtn.setOnClickListener { receber() }

        lista.adapter = adapter
        bindLio()
    }

    override fun onResume() {
        super.onResume()
        carregar()
    }

    override fun onDestroy() {
        Lio.unbind()
        super.onDestroy()
    }

    // Conecta ao serviço de pagamento. Fora da maquininha (celular) o app segue
    // como consulta/lançamento — o botão de receber some e o aviso explica.
    private fun bindLio() {
        receberBtn.isEnabled = false
        lioStatus.visibility = View.VISIBLE
        lioStatus.text = "💳 Conectando à maquininha…"
        Lio.bind(
            this,
            onReady = {
                runOnUiThread {
                    lioReady = true
                    lioStatus.visibility = View.GONE
                    atualizarBotoes()
                }
            },
            onError = {
                runOnUiThread {
                    lioReady = false
                    lioStatus.text = "Fora da maquininha — só consulta e lançamento"
                    atualizarBotoes()
                }
            }
        )
    }

    private fun carregar() {
        val base = Session.servidor(this)
        Thread {
            try {
                val c = Api.conta(base, numero)
                val info = if (!ehComanda) try { Api.mesaInfo(base, numero) } catch (_: Exception) { null } else null
                runOnUiThread {
                    conta = c
                    mostrarConta(c)
                    mostrarComandas(info)
                }
            } catch (e: Exception) {
                runOnUiThread {
                    vazio.visibility = View.VISIBLE
                    vazio.text = e.message ?: "Erro ao carregar a conta"
                }
            }
        }.start()
    }

    private fun mostrarConta(c: Api.Conta?) {
        if (c == null) {
            // Mesa vazia: sem conta no Consumer ainda — o primeiro envio abre.
            adapter.itens = emptyList()
            adapter.notifyDataSetChanged()
            vazio.visibility = View.VISIBLE
            vazio.text = "Sem conta aberta — lance o primeiro item"
            resumo.text = ""
            badge.visibility = View.GONE
        } else {
            adapter.itens = c.itens
            adapter.notifyDataSetChanged()
            vazio.visibility = if (c.itens.isEmpty()) View.VISIBLE else View.GONE
            if (c.itens.isEmpty()) vazio.text = "Conta aberta, sem itens"
            badge.visibility = if (c.contaPedida) View.VISIBLE else View.GONE
            val linhas = mutableListOf(
                "Total ${Cupom.brl(c.total)}  ·  serviço ${Cupom.brl(c.servico)}",
            )
            if (c.pago > 0) linhas.add("Pago ${Cupom.brl(c.pago)}")
            linhas.add("FALTA ${Cupom.brl(c.saldo)}")
            resumo.text = linhas.joinToString("\n")
        }
        atualizarBotoes()
    }

    private fun mostrarComandas(info: Api.MesaInfo?) {
        comandasBox.removeAllViews()
        val cs = info?.comandas ?: emptyList()
        comandasBox.visibility = if (cs.isEmpty()) View.GONE else View.VISIBLE
        cs.forEach { cNum ->
            val b = Button(this)
            b.text = "C$cNum" + (info?.nomes?.get(cNum.toString())?.let { " · $it" } ?: "")
            b.textSize = 12f
            b.isAllCaps = false
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(36))
            lp.marginEnd = dp(6)
            b.layoutParams = lp
            b.setOnClickListener {
                val i = Intent(this, ContaActivity::class.java)
                i.putExtra("numero", cNum)
                startActivity(i)
            }
            comandasBox.addView(b)
        }
    }

    private fun atualizarBotoes() {
        val c = conta
        val temSaldo = c != null && c.saldo > 0.009
        receberBtn.visibility = if (lioReady) View.VISIBLE else View.GONE
        receberBtn.isEnabled = lioReady && temSaldo && !cobrando
        receberBtn.text = when {
            cobrando -> "💳 Aguardando pagamento…"
            temSaldo -> "💳 Receber ${Cupom.brl(c!!.saldo)}"
            else -> "💳 Receber"
        }
        conferenciaBtn.isEnabled = c != null
        contaPedidaBtn.isEnabled = c != null
        contaPedidaBtn.text = if (c?.contaPedida == true) "Liberar conta" else "Pedir conta"
        // Conta pedida trava lançamento novo (regra do servidor).
        lancarBtn.isEnabled = !(c?.contaPedida ?: false)
        lancarBtn.text = if (c?.contaPedida == true) "Conta pedida" else "＋ Lançar itens"
    }

    private fun lancar() {
        val i = Intent(this, ProdutosActivity::class.java)
        i.putExtra("numero", numero)
        startActivity(i)
    }

    private fun alternarContaPedida() {
        val c = conta ?: return
        val tk = Session.token(this) ?: return logout()
        val acao = if (c.contaPedida) "reabrir" else "fechar"
        val msg = if (c.contaPedida) "Liberar a conta pra lançar de novo?"
        else "Pedir a conta? Trava novos lançamentos."
        AlertDialog.Builder(this)
            .setMessage(msg)
            .setPositiveButton("Sim") { _, _ ->
                Thread {
                    try {
                        val r = Api.acaoConta(Session.servidor(this), tk, numero, acao)
                        runOnUiThread {
                            Toast.makeText(this, r.optString("msg", r.optString("erro", "ok")), Toast.LENGTH_SHORT).show()
                            carregar()
                        }
                    } catch (e: Api.SemSessao) {
                        runOnUiThread { logout() }
                    } catch (e: Exception) {
                        runOnUiThread { Toast.makeText(this, e.message, Toast.LENGTH_LONG).show() }
                    }
                }.start()
            }
            .setNegativeButton("Não", null)
            .show()
    }

    // ---- conferência impressa na térmica da maquininha ----
    private fun imprimirConferencia() {
        conferenciaBtn.isEnabled = false
        Thread {
            try {
                val j = Api.contaTexto(Session.servidor(this), numero)
                val corpo = Cupom.montar(j, ehComanda)
                runOnUiThread {
                    Lio.imprimirCupom(
                        this, Session.loja(this) + " · CONFERÊNCIA", corpo,
                        onOk = { runOnUiThread { conferenciaBtn.isEnabled = true } },
                        onErro = { msg ->
                            runOnUiThread {
                                conferenciaBtn.isEnabled = true
                                Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
                            }
                        }
                    )
                }
            } catch (e: Exception) {
                runOnUiThread {
                    conferenciaBtn.isEnabled = true
                    Toast.makeText(this, e.message ?: "Erro ao montar a conta", Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }

    // ---- RECEBER no terminal ----
    // Dialog com o valor (default = saldo; editar = parcial/rachar) → UI nativa
    // de pagamento da Cielo → registra no vendas-local com NSU/bandeira.
    private fun receber() {
        val c = conta ?: return
        if (!lioReady || cobrando) return

        val input = EditText(this)
        input.inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL
        input.setText(String.format(java.util.Locale.US, "%.2f", c.saldo).replace(".", ","))
        val box = LinearLayout(this)
        box.setPadding(dp(20), dp(8), dp(20), 0)
        box.addView(input, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        AlertDialog.Builder(this)
            .setTitle("Receber quanto?")
            .setMessage("Falta ${Cupom.brl(c.saldo)}. Valor menor = pagamento parcial (rachar conta).")
            .setView(box)
            .setPositiveButton("Cobrar") { _, _ ->
                val valor = input.text.toString().trim().replace(".", "").replace(",", ".").toDoubleOrNull()
                if (valor == null || valor <= 0) {
                    Toast.makeText(this, "Valor inválido", Toast.LENGTH_SHORT).show()
                } else if (valor > c.saldo + 0.01) {
                    Toast.makeText(this, "Maior que o saldo (${Cupom.brl(c.saldo)})", Toast.LENGTH_LONG).show()
                } else {
                    cobrarNoTerminal(Math.round(valor * 100))
                }
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun cobrarNoTerminal(valorCentavos: Long) {
        val c = conta ?: return
        cobrando = true
        atualizarBotoes()

        // Itens REAIS da conta no pedido da LIO (o certificador confere) —
        // pais somados com serviço; o valor cobrado pode ser parcial.
        val linhas = c.itens.filter { it.tipo != 2 }.map {
            val q = if (it.qtd == Math.floor(it.qtd)) it.qtd.toInt().toString() else it.qtd.toString()
            Lio.Linha("${q}x ${it.nome}", Math.round(it.valor * 100))
        } + (if (c.servico > 0) listOf(Lio.Linha("Serviço", Math.round(c.servico * 100))) else emptyList())

        val ref = (if (ehComanda) "COMANDA-" else "MESA-") + numero
        Lio.cobrar(
            ref = ref,
            linhas = linhas,
            valorCentavos = valorCentavos,
            onInicio = { /* a UI de pagamento da Cielo assume a tela */ },
            onPago = { _, pagamentos -> registrarPagamentos(pagamentos) },
            onCancelado = {
                runOnUiThread {
                    cobrando = false
                    atualizarBotoes()
                    Toast.makeText(this, "Pagamento cancelado", Toast.LENGTH_SHORT).show()
                }
            },
            onErro = { msg ->
                runOnUiThread {
                    cobrando = false
                    atualizarBotoes()
                    Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
                }
            }
        )
    }

    // Aprovado no terminal → fila de pendentes ANTES, registro com retry, e só
    // então sai da fila. Rede caiu nesse meio tempo: fica pendente e a tela de
    // mesas reenvia — o pagamento nunca se perde.
    private fun registrarPagamentos(pagamentos: List<Lio.PagamentoLio>) {
        val tk = Session.token(this)
        val base = Session.servidor(this)
        Thread {
            var quitada = false
            var registrouTudo = true
            var ultimoErro: String? = null
            for (p in pagamentos) {
                val body = Api.bodyPagamento(numero, p)
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
                            // Servidor recusou de verdade (ex.: caixa fechado no
                            // Consumer) — reenviar não muda; guarda o motivo.
                            ultimoErro = r.erro
                        }
                        break
                    } catch (e: Api.SemSessao) {
                        ultimoErro = e.message
                        break
                    } catch (e: Exception) {
                        ultimoErro = e.message
                        try { Thread.sleep(2000L * tentativa) } catch (_: InterruptedException) { }
                    }
                }
                if (!okEste) registrouTudo = false
            }
            val totalPago = pagamentos.sumOf { it.valorCentavos }
            runOnUiThread {
                cobrando = false
                carregar()
                mostrarResultado(totalPago, pagamentos, registrouTudo, quitada, ultimoErro)
            }
        }.start()
    }

    private fun mostrarResultado(
        totalCentavos: Long,
        pagamentos: List<Lio.PagamentoLio>,
        registrou: Boolean,
        quitada: Boolean,
        erro: String?,
    ) {
        val p = pagamentos.firstOrNull()
        val detalhe = p?.let {
            val mask4 = it.mask.takeLast(4)
            "${it.forma.uppercase()} ${it.bandeira}" +
                (if (mask4.isNotBlank()) " **** $mask4" else "") +
                (if (it.nsu.isNotBlank()) "\nNSU ${it.nsu} · AUT ${it.autorizacao}" else "")
        } ?: ""
        val msg = StringBuilder("Recebido ${Cupom.brl(totalCentavos / 100.0)}\n$detalhe")
        if (quitada) msg.append("\n\n🎉 Conta quitada!")
        if (!registrou) msg.append(
            "\n\n⚠️ O pagamento foi APROVADO na maquininha mas ainda não foi registrado no sistema" +
                (erro?.let { " ($it)" } ?: "") +
                ". Ele ficou na fila — reenvie na tela de mesas assim que a rede voltar."
        )
        AlertDialog.Builder(this)
            .setTitle(if (registrou) "✅ Pago!" else "⚠️ Pago — registro pendente")
            .setMessage(msg.toString())
            .setPositiveButton("🖨 Recibo") { _, _ -> imprimirRecibo(pagamentos) }
            .setNegativeButton("OK", null)
            .setCancelable(false)
            .show()
    }

    private fun imprimirRecibo(pagamentos: List<Lio.PagamentoLio>) {
        Thread {
            val extras = mutableListOf("RECIBO DE PAGAMENTO")
            pagamentos.forEach { p ->
                extras.add("${p.forma.uppercase()} ${p.bandeira} ${Cupom.brl(p.valorCentavos / 100.0)}".trim())
                if (p.nsu.isNotBlank()) extras.add("NSU ${p.nsu} AUT ${p.autorizacao}")
            }
            val corpo = try {
                Cupom.montar(Api.contaTexto(Session.servidor(this), numero), ehComanda, extras)
            } catch (_: Exception) {
                // Conta já fechada/indisponível: recibo mínimo, só do pagamento.
                extras.joinToString("\n") + "\n" + (if (ehComanda) "Comanda" else "Mesa") + " $numero\n" + Cupom.agoraBr()
            }
            runOnUiThread {
                Lio.imprimirCupom(
                    this, Session.loja(this), corpo,
                    onOk = { runOnUiThread { Toast.makeText(this, "Recibo impresso!", Toast.LENGTH_SHORT).show() } },
                    onErro = { m -> runOnUiThread { Toast.makeText(this, m, Toast.LENGTH_LONG).show() } }
                )
            }
        }.start()
    }

    private fun logout() {
        Session.clear(this)
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private inner class ItemAdapter : BaseAdapter() {
        var itens: List<Api.ItemConta> = emptyList()
        override fun getCount() = itens.size
        override fun getItem(position: Int) = itens[position]
        override fun getItemId(position: Int) = position.toLong()

        override fun getView(position: Int, convertView: View?, parent: ViewGroup?): View {
            val v = convertView ?: layoutInflater.inflate(R.layout.item_conta, parent, false)
            val it = itens[position]
            val nomeTxt = v.findViewById<TextView>(R.id.nome)
            if (it.tipo == 2) {
                nomeTxt.text = "    + ${it.nome}"
                v.findViewById<TextView>(R.id.valor).text = if (it.valor > 0) Cupom.brl(it.valor) else ""
            } else {
                val q = if (it.qtd == Math.floor(it.qtd)) it.qtd.toInt().toString() else it.qtd.toString()
                nomeTxt.text = "${q}x ${it.nome}"
                v.findViewById<TextView>(R.id.valor).text = Cupom.brl(it.valor)
            }
            return v
        }
    }
}
