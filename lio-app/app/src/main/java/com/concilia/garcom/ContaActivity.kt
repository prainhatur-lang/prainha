package com.concilia.garcom

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

// Conta da mesa/comanda — números AO VIVO do Firebird (GET /api/conta).
// Daqui o garçom: lança itens (ProdutosActivity), pede/libera a conta,
// imprime a conferência na térmica, identifica o cliente, vincula comanda,
// transfere/junta mesas (menu ⋯) e RECEBE no terminal (Order Manager SDK) —
// integral ou parcial. Pagamento aprovado entra na fila de pendentes ANTES
// do registro no vendas-local (retry 3x) e só sai depois da confirmação —
// dinheiro capturado não se perde nem duplica.
//
// A lista mostra os itens E os pagamentos como LANÇAMENTOS individuais
// (hora + forma, em vermelho, valor negativo); o rodapé mostra o SALDO.
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

    private val adapter = LinhaAdapter()

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
        findViewById<Button>(R.id.maisAcoes).setOnClickListener { mostrarMaisAcoes() }
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
                    // Nome de quem está na mesa, quando identificado.
                    val nome = info?.nomes?.get(numero.toString())
                    titulo.text = (if (ehComanda) "Comanda $numero" else "Mesa $numero") +
                        (if (!nome.isNullOrBlank()) " · $nome" else "")
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
            adapter.linhas = emptyList()
            adapter.notifyDataSetChanged()
            vazio.visibility = View.VISIBLE
            vazio.text = "Sem conta aberta — lance o primeiro item"
            resumo.text = ""
            badge.visibility = View.GONE
        } else {
            // Itens + pagamentos como lançamentos individuais (em vermelho).
            val linhas = mutableListOf<Any>()
            linhas.addAll(c.itens)
            linhas.addAll(c.pagamentos.filter { it.status == "ok" })
            adapter.linhas = linhas
            adapter.notifyDataSetChanged()
            vazio.visibility = if (linhas.isEmpty()) View.VISIBLE else View.GONE
            if (linhas.isEmpty()) vazio.text = "Conta aberta, sem itens"
            badge.visibility = if (c.contaPedida) View.VISIBLE else View.GONE
            // Serviço zerado não vira "R$ 0,00" — só aparece quando o PDV aplicou.
            val cab = if (c.servico > 0)
                "Consumo ${Cupom.brl(c.total - c.servico)}  ·  Serviço ${Cupom.brl(c.servico)}  ·  Total ${Cupom.brl(c.total)}"
            else "Total ${Cupom.brl(c.total)}"
            resumo.text = "$cab\nSALDO ${Cupom.brl(c.saldo)}"
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
        else "Pedir a conta? Trava novos lançamentos e imprime a conta completa aqui na maquininha."
        AlertDialog.Builder(this)
            .setMessage(msg)
            .setPositiveButton("Sim") { _, _ ->
                Thread {
                    try {
                        val r = Api.acaoConta(Session.servidor(this), tk, numero, acao)
                        runOnUiThread {
                            Toast.makeText(this, r.optString("msg", r.optString("erro", "ok")), Toast.LENGTH_SHORT).show()
                            carregar()
                            // Conta pedida = conta na mão: imprime na hora, com tudo.
                            if (acao == "fechar" && r.optBoolean("ok")) imprimirConta("CONTA")
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

    // ---- menu ⋯: identificar / vincular comanda / transferir-juntar ----

    private fun mostrarMaisAcoes() {
        data class Acao(val rotulo: String, val executar: () -> Unit)
        val acoes = mutableListOf<Acao>()
        acoes.add(Acao("👤 Identificar cliente") { dialogIdentificar() })
        if (!ehComanda && Session.comandaAtiva(this)) {
            acoes.add(Acao("🧾 Vincular comanda a esta mesa") { dialogVincular() })
        }
        acoes.add(Acao(if (ehComanda) "🔁 Mudar a comanda de mesa" else "🔁 Transferir/juntar em outra mesa") { dialogTransferir() })
        AlertDialog.Builder(this)
            .setTitle(titulo.text)
            .setItems(acoes.map { it.rotulo }.toTypedArray()) { _, pos -> acoes[pos].executar() }
            .setNegativeButton("Fechar", null)
            .show()
    }

    private fun campo(hint: String, tipo: Int = android.text.InputType.TYPE_CLASS_TEXT): EditText {
        val e = EditText(this)
        e.hint = hint
        e.inputType = tipo
        return e
    }

    private fun caixa(vararg views: View): LinearLayout {
        val box = LinearLayout(this)
        box.orientation = LinearLayout.VERTICAL
        box.setPadding(dp(20), dp(8), dp(20), 0)
        views.forEach {
            box.addView(it, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        return box
    }

    /** Nome/CPF/WhatsApp de quem está na mesa (busca o nome na casa/grupo/SPC). */
    private fun dialogIdentificar() {
        val nomeIn = campo("Nome")
        val cpfIn = campo("CPF (só números)", android.text.InputType.TYPE_CLASS_NUMBER)
        val telIn = campo("WhatsApp (com DDD)", android.text.InputType.TYPE_CLASS_PHONE)
        val cadastrarCb = CheckBox(this)
        cadastrarCb.text = "Cadastrar como cliente da casa"
        cadastrarCb.isChecked = true
        val buscarBtn = Button(this)
        buscarBtn.text = "🔍 Buscar nome pelo CPF/telefone"
        buscarBtn.isAllCaps = false
        buscarBtn.setOnClickListener {
            val cpf = cpfIn.text.toString().trim()
            val tel = telIn.text.toString().trim()
            if (cpf.isBlank() && tel.isBlank()) {
                Toast.makeText(this, "Preencha CPF ou WhatsApp antes", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            buscarBtn.isEnabled = false
            Thread {
                val r = Api.identificarBuscar(Session.servidor(this), cpf.ifBlank { null }, tel.ifBlank { null })
                runOnUiThread {
                    buscarBtn.isEnabled = true
                    val nome = r?.optStringOrNull("nome")
                    if (nome != null) {
                        nomeIn.setText(nome)
                        Toast.makeText(this, "Achou: $nome", Toast.LENGTH_SHORT).show()
                    } else {
                        Toast.makeText(this, r?.optStringOrNull("aviso") ?: "Não achei — digite o nome", Toast.LENGTH_SHORT).show()
                    }
                }
            }.start()
        }
        AlertDialog.Builder(this)
            .setTitle("Quem está ${if (ehComanda) "na comanda" else "na mesa"} $numero?")
            .setView(caixa(nomeIn, cpfIn, telIn, buscarBtn, cadastrarCb))
            .setPositiveButton("Salvar") { _, _ ->
                val nome = nomeIn.text.toString().trim()
                if (nome.isBlank()) { Toast.makeText(this, "Informe o nome", Toast.LENGTH_SHORT).show(); return@setPositiveButton }
                Thread {
                    try {
                        val r = Api.identificarSalvar(
                            Session.servidor(this), numero, nome,
                            cpfIn.text.toString().trim().ifBlank { null },
                            telIn.text.toString().trim().ifBlank { null },
                            cadastrarCb.isChecked,
                        )
                        runOnUiThread {
                            when {
                                r.optBoolean("ok") -> {
                                    Toast.makeText(this, "✓ ${r.optString("nome_curto", nome)}", Toast.LENGTH_SHORT).show()
                                    carregar()
                                }
                                r.optBoolean("ja_tem_dono") -> AlertDialog.Builder(this)
                                    .setMessage("Já tem dono: ${r.optString("dono")}. O dono não muda por aqui — confira o CPF/telefone.")
                                    .setPositiveButton("OK", null).show()
                                else -> Toast.makeText(this, r.optStringOrNull("erro") ?: "Não salvou", Toast.LENGTH_LONG).show()
                            }
                        }
                    } catch (e: Exception) {
                        runOnUiThread { Toast.makeText(this, e.message, Toast.LENGTH_LONG).show() }
                    }
                }.start()
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    /** Pendura uma comanda nesta mesa (criação exige dono: nome + CPF/WhatsApp). */
    private fun dialogVincular() {
        val comandaIn = campo("Nº da comanda (${Session.comandaMin(this)}–${Session.numeroMax(this)})", android.text.InputType.TYPE_CLASS_NUMBER)
        val nomeIn = campo("Nome do dono (obrigatório se for nova)")
        val cpfIn = campo("CPF (ou WhatsApp abaixo)", android.text.InputType.TYPE_CLASS_NUMBER)
        val telIn = campo("WhatsApp (com DDD)", android.text.InputType.TYPE_CLASS_PHONE)
        AlertDialog.Builder(this)
            .setTitle("Vincular comanda à mesa $numero")
            .setView(caixa(comandaIn, nomeIn, cpfIn, telIn))
            .setPositiveButton("Vincular") { _, _ ->
                val cNum = comandaIn.text.toString().trim().toIntOrNull()
                if (cNum == null) { Toast.makeText(this, "Número da comanda inválido", Toast.LENGTH_SHORT).show(); return@setPositiveButton }
                val tk = Session.token(this) ?: return@setPositiveButton logout()
                Thread {
                    try {
                        val r = Api.vincular(
                            Session.servidor(this), tk, numero, cNum,
                            nomeIn.text.toString().trim().ifBlank { null },
                            cpfIn.text.toString().trim().ifBlank { null },
                            telIn.text.toString().trim().ifBlank { null },
                        )
                        runOnUiThread {
                            when {
                                r.optBoolean("ok") -> {
                                    Toast.makeText(this, "✓ Comanda $cNum na mesa $numero" +
                                        (r.optStringOrNull("nome_curto")?.let { " ($it)" } ?: ""), Toast.LENGTH_SHORT).show()
                                    carregar()
                                }
                                r.optBoolean("precisa_dono") -> AlertDialog.Builder(this)
                                    .setMessage(r.optString("erro")).setPositiveButton("OK", null).show()
                                else -> Toast.makeText(this, r.optStringOrNull("erro") ?: "Não vinculou", Toast.LENGTH_LONG).show()
                            }
                        }
                    } catch (e: Api.SemSessao) {
                        runOnUiThread { logout() }
                    } catch (e: Exception) {
                        runOnUiThread { Toast.makeText(this, e.message, Toast.LENGTH_LONG).show() }
                    }
                }.start()
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    /** Comanda→mesa muda o vínculo; mesa→mesa move TODOS os itens (juntar). */
    private fun dialogTransferir() {
        val paraIn = campo("Nº da mesa destino", android.text.InputType.TYPE_CLASS_NUMBER)
        val aviso = TextView(this)
        aviso.textSize = 13f
        aviso.text = if (ehComanda) "A comanda $numero passa a ser da mesa escolhida."
        else "TODOS os itens da mesa $numero vão pro destino — as comandas penduradas vão junto."
        AlertDialog.Builder(this)
            .setTitle(if (ehComanda) "Mudar comanda de mesa" else "Transferir / juntar mesas")
            .setView(caixa(aviso, paraIn))
            .setPositiveButton("Transferir") { _, _ ->
                val para = paraIn.text.toString().trim().toIntOrNull()
                if (para == null) { Toast.makeText(this, "Informe a mesa destino", Toast.LENGTH_SHORT).show(); return@setPositiveButton }
                val tk = Session.token(this) ?: return@setPositiveButton logout()
                Thread {
                    try {
                        val r = Api.transferir(Session.servidor(this), tk, numero, para, Session.login(this))
                        runOnUiThread {
                            if (r.optBoolean("ok")) {
                                Toast.makeText(this, r.optString("msg", "Transferido!"), Toast.LENGTH_LONG).show()
                                if (r.optString("tipo") == "mesa") finish() else carregar()
                            } else {
                                Toast.makeText(this, r.optStringOrNull("erro") ?: "Não transferiu", Toast.LENGTH_LONG).show()
                            }
                        }
                    } catch (e: Api.SemSessao) {
                        runOnUiThread { logout() }
                    } catch (e: Exception) {
                        runOnUiThread { Toast.makeText(this, e.message, Toast.LENGTH_LONG).show() }
                    }
                }.start()
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    // ---- conta/conferência impressa na térmica da maquininha ----
    private fun imprimirConferencia() = imprimirConta("CONFERÊNCIA")

    private fun imprimirConta(rotulo: String) {
        conferenciaBtn.isEnabled = false
        Thread {
            try {
                val j = Api.contaTexto(Session.servidor(this), numero)
                val corpo = Cupom.montar(j, ehComanda)
                runOnUiThread {
                    Lio.imprimirCupom(
                        this, Session.loja(this) + " · " + rotulo, corpo,
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
    // Dialog com o valor + atalhos de rateio (Tudo, ÷2…÷5) e campo livre pra
    // parcial → UI nativa de pagamento da Cielo → registra no vendas-local.
    // Rachar em N: cada pessoa é um Receber; o saldo cai a cada pagamento e
    // no último usa-se "Tudo" (fecha os centavos que sobraram da divisão).
    private fun receber() {
        val c = conta ?: return
        if (!lioReady || cobrando) return

        val input = EditText(this)
        input.inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL
        input.textSize = 22f
        fun poe(v: Double) = input.setText(String.format(java.util.Locale.US, "%.2f", v).replace(".", ","))
        poe(c.saldo)

        val chips = LinearLayout(this)
        chips.orientation = LinearLayout.HORIZONTAL
        fun chip(rotulo: String, valor: Double) {
            val b = Button(this)
            b.text = rotulo
            b.textSize = 13f
            b.isAllCaps = false
            val lp = LinearLayout.LayoutParams(0, dp(42))
            lp.weight = 1f
            lp.marginEnd = dp(4)
            b.layoutParams = lp
            b.setOnClickListener { poe(valor) }
            chips.addView(b)
        }
        chip("Tudo", c.saldo)
        for (n in 2..5) chip("÷$n", Math.round(c.saldo / n * 100) / 100.0)

        val dica = TextView(this)
        dica.textSize = 12f
        dica.setTextColor(0xFF6B7280.toInt())
        dica.text = "Rachar: um Receber por pessoa — o saldo vai caindo. No último, use Tudo."

        val box = LinearLayout(this)
        box.orientation = LinearLayout.VERTICAL
        box.setPadding(dp(20), dp(8), dp(20), 0)
        box.addView(chips, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        box.addView(input, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        box.addView(dica, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        AlertDialog.Builder(this)
            .setTitle("Receber — saldo ${Cupom.brl(c.saldo)}")
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

    /** Linhas da conta: Api.ItemConta (preto) ou Api.PagFeito (vermelho, "−"). */
    private inner class LinhaAdapter : BaseAdapter() {
        var linhas: List<Any> = emptyList()
        override fun getCount() = linhas.size
        override fun getItem(position: Int) = linhas[position]
        override fun getItemId(position: Int) = position.toLong()

        override fun getView(position: Int, convertView: View?, parent: ViewGroup?): View {
            val v = convertView ?: layoutInflater.inflate(R.layout.item_conta, parent, false)
            val nomeTxt = v.findViewById<TextView>(R.id.nome)
            val valorTxt = v.findViewById<TextView>(R.id.valor)
            when (val l = linhas[position]) {
                is Api.ItemConta -> {
                    val preto = 0xFF111827.toInt()
                    nomeTxt.setTextColor(preto)
                    valorTxt.setTextColor(preto)
                    if (l.tipo == 2) {
                        nomeTxt.text = "    + ${l.nome}"
                        valorTxt.text = if (l.valor > 0) Cupom.brl(l.valor) else ""
                    } else {
                        val q = if (l.qtd == Math.floor(l.qtd)) l.qtd.toInt().toString() else l.qtd.toString()
                        nomeTxt.text = "${q}x ${l.nome}"
                        valorTxt.text = Cupom.brl(l.valor)
                    }
                }
                is Api.PagFeito -> {
                    val vermelho = 0xFFDC2626.toInt()
                    val hora = Cupom.horaBr(l.criadoEm)
                    nomeTxt.text = "Pago" + (if (hora.isNotBlank()) " $hora" else "") + " · ${l.forma}"
                    nomeTxt.setTextColor(vermelho)
                    valorTxt.text = "− ${Cupom.brl(l.valor)}"
                    valorTxt.setTextColor(vermelho)
                }
            }
            return v
        }
    }
}
