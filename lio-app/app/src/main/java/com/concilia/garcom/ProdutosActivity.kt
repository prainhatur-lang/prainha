package com.concilia.garcom

import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
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
import org.json.JSONArray
import org.json.JSONObject

// Lançar itens na mesa/comanda: categorias na ordem do Consumer, busca sem
// acento, variantes (dose/garrafa), wizard de perguntas (ponto da carne...),
// observação com sugestões do grupo, carrinho e ENVIAR — o servidor reprecifica
// tudo, cria a conta se não existir e manda pra impressora da cozinha.
class ProdutosActivity : AppCompatActivity() {

    private var numero = 0
    /** VENDA DIRETA: sem mesa — revisa, escolhe com/sem 10%, cobra na hora e
     *  imprime um ticket por unidade (ver Ticket). A mesa segue igual. */
    private var ticket = false
    private var cobrandoTicket = false

    private data class ItemCarrinho(
        val codigoPdv: Int,
        val nome: String,
        val precoUnit: Double,       // estimativa de tela; o preço real é o do servidor
        var qtd: Int,
        val obs: String?,
        val respostas: List<Int>,
        val extras: Double,          // soma dos preços das respostas do wizard
        val escolhas: List<String> = emptyList(), // nomes das respostas (com gelo, complementos…) pra revisão
    ) {
        val total: Double get() = (precoUnit + extras) * qtd
    }

    private lateinit var buscaIn: EditText
    private lateinit var chipsBox: LinearLayout
    private lateinit var lista: ListView
    private lateinit var vazio: TextView
    private lateinit var carrinhoBar: LinearLayout
    private lateinit var carrinhoTxt: TextView
    private lateinit var enviarBtn: Button

    private var categorias: List<Api.Categoria> = emptyList()
    private var categoriaAtual: String? = null
    private var produtos: List<Api.Produto> = emptyList()
    private val carrinho = mutableListOf<ItemCarrinho>()
    private val adapter = ProdutoAdapter()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_produtos)
        numero = intent.getIntExtra("numero", 0)
        ticket = intent.getBooleanExtra("ticket", false)

        buscaIn = findViewById(R.id.busca)
        chipsBox = findViewById(R.id.chips)
        lista = findViewById(R.id.listaProdutos)
        vazio = findViewById(R.id.produtosVazio)
        carrinhoBar = findViewById(R.id.carrinhoBar)
        carrinhoTxt = findViewById(R.id.carrinhoTxt)
        enviarBtn = findViewById(R.id.enviar)

        findViewById<TextView>(R.id.tituloProdutos).text =
            if (ticket) "🎟 Ticket · venda direta"
            else if (Session.ehComanda(this, numero)) "Lançar · Comanda $numero" else "Lançar · Mesa $numero"
        if (ticket) {
            enviarBtn.text = "💳 COBRAR"
            findViewById<Button>(R.id.voltarProdutos).text = "‹ Voltar"
            // a cobrança é daqui mesmo: já liga o serviço da maquininha
            if (Pagamento.configured() && !Pagamento.pronto) Pagamento.bind(this, onReady = { }, onError = { })
        }
        findViewById<Button>(R.id.voltarProdutos).setOnClickListener { finish() }

        lista.adapter = adapter
        lista.setOnItemClickListener { _, _, pos, _ -> escolher(adapter.itens[pos]) }
        buscaIn.addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(s: Editable?) {
                val t = s?.toString()?.trim() ?: ""
                if (t.length >= 2) buscar(t) else if (t.isEmpty()) abrirCategoria(categoriaAtual)
            }
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        })
        carrinhoTxt.setOnClickListener { revisarCarrinho() }
        // Revisão OBRIGATÓRIA antes de mandar pra cozinha (igual ao celular).
        enviarBtn.setOnClickListener { revisarCarrinho() }

        atualizarCarrinho()
        carregarCategorias()
    }

    // ---- catálogo ----

    private fun carregarCategorias() {
        vazio.visibility = View.VISIBLE
        vazio.text = "Carregando cardápio…"
        Thread {
            try {
                val cs = Api.categorias(Session.servidor(this))
                runOnUiThread {
                    categorias = cs
                    montarChips()
                    abrirCategoria(cs.firstOrNull()?.nome)
                }
            } catch (e: Exception) {
                runOnUiThread { vazio.text = Api.msgErroRede(e, Session.servidor(this@ProdutosActivity)) }
            }
        }.start()
    }

    private fun montarChips() {
        chipsBox.removeAllViews()
        categorias.forEach { c ->
            val b = Button(this)
            b.text = c.nome
            b.textSize = 12f
            b.isAllCaps = false
            b.setPadding(dp(12), 0, dp(12), 0)
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(34))
            lp.marginEnd = dp(6)
            b.layoutParams = lp
            b.setOnClickListener { buscaIn.text.clear(); abrirCategoria(c.nome) }
            chipsBox.addView(b)
        }
        pintarChips()
    }

    private fun pintarChips() {
        for (i in 0 until chipsBox.childCount) {
            val b = chipsBox.getChildAt(i) as Button
            val ativo = categorias.getOrNull(i)?.nome == categoriaAtual
            b.setBackgroundColor(if (ativo) 0xFF0C7091.toInt() else 0xFFFFFFFF.toInt())
            b.setTextColor(if (ativo) 0xFFFFFFFF.toInt() else 0xFF374151.toInt())
        }
    }

    private fun abrirCategoria(nome: String?) {
        categoriaAtual = nome
        pintarChips()
        if (nome == null) return
        Thread {
            try {
                val ps = Api.categoria(Session.servidor(this), nome)
                runOnUiThread { mostrarProdutos(ps) }
            } catch (e: Exception) {
                runOnUiThread { vazio.visibility = View.VISIBLE; vazio.text = e.message ?: "Erro" }
            }
        }.start()
    }

    private fun buscar(termo: String) {
        Thread {
            try {
                val ps = Api.busca(Session.servidor(this), termo)
                runOnUiThread { mostrarProdutos(ps) }
            } catch (_: Exception) { }
        }.start()
    }

    private fun mostrarProdutos(ps: List<Api.Produto>) {
        produtos = ps
        adapter.itens = ps
        adapter.notifyDataSetChanged()
        vazio.visibility = if (ps.isEmpty()) View.VISIBLE else View.GONE
        if (ps.isEmpty()) vazio.text = "Nada encontrado"
    }

    // ---- fluxo de escolha: variante → wizard → qtd/obs → carrinho ----

    private fun escolher(p: Api.Produto) {
        if (p.semEstoque) {
            AlertDialog.Builder(this)
                .setMessage("${p.nome} está SEM ESTOQUE no Consumer. Lançar mesmo assim?")
                .setPositiveButton("Lançar") { _, _ -> escolherVariante(p) }
                .setNegativeButton("Não", null)
                .show()
        } else escolherVariante(p)
    }

    private fun escolherVariante(p: Api.Produto) {
        if (!p.grupo && p.codigoPdv != null) { carregarPerguntas(p.codigoPdv, nomeComTamanho(p), p.preco); return }
        Thread {
            try {
                val vs = Api.variantes(Session.servidor(this), p.produtoCodigo)
                runOnUiThread {
                    if (vs.isEmpty()) { Toast.makeText(this, "Sem variantes vendáveis", Toast.LENGTH_SHORT).show(); return@runOnUiThread }
                    val rotulos = vs.map {
                        (it.tamanho ?: it.nome) + "  ·  " + Cupom.brl(it.preco) +
                            when {
                                it.semEstoque -> "  (sem estoque)"
                                it.estoque != null -> "  (resta " + Cupom.qtd(it.estoque) + ")"
                                else -> ""
                            }
                    }.toTypedArray()
                    AlertDialog.Builder(this)
                        .setTitle(p.nome)
                        .setItems(rotulos) { _, pos ->
                            val v = vs[pos]
                            if (v.codigoPdv != null) carregarPerguntas(v.codigoPdv, nomeComTamanho(v), v.preco)
                        }
                        .show()
                }
            } catch (e: Exception) {
                runOnUiThread { Toast.makeText(this, e.message, Toast.LENGTH_LONG).show() }
            }
        }.start()
    }

    private fun nomeComTamanho(p: Api.Produto): String =
        p.nome + (p.tamanho?.takeIf { it.isNotBlank() }?.let { " $it" } ?: "")

    private fun carregarPerguntas(codigoPdv: Int, nome: String, preco: Double) {
        Thread {
            val pergs = try { Api.perguntas(Session.servidor(this), codigoPdv) } catch (_: Exception) { emptyList() }
            val sugestoes = Api.observacoes(Session.servidor(this), codigoPdv)
            runOnUiThread { responderPerguntas(codigoPdv, nome, preco, pergs, 0, emptyList(), 0.0, sugestoes, emptyList()) }
        }.start()
    }

    /** Uma pergunta do wizard por vez; no fim cai no dialog de qtd/observação. */
    private fun responderPerguntas(
        codigoPdv: Int, nome: String, preco: Double,
        pergs: List<Api.Pergunta>, idx: Int,
        respostas: List<Int>, extras: Double,
        sugestoes: List<String>,
        escolhas: List<String>,
    ) {
        if (idx >= pergs.size) { dialogQtdObs(codigoPdv, nome, preco, respostas, extras, sugestoes, escolhas); return }
        fun rot(op: Api.Opcao) = op.nome + (if (op.preco > 0) " +" + Cupom.brl(op.preco) else "")
        val p = pergs[idx]
        val rotulos = p.opcoes.map { it.nome + (if (it.preco > 0) "  +" + Cupom.brl(it.preco) else "") }.toTypedArray()

        if (p.max == 1) {
            val b = AlertDialog.Builder(this)
                .setTitle(p.texto)
                .setItems(rotulos) { _, pos ->
                    val op = p.opcoes[pos]
                    responderPerguntas(codigoPdv, nome, preco, pergs, idx + 1,
                        respostas + op.codigo, extras + op.preco, sugestoes, escolhas + rot(op))
                }
            if (p.min < 1) b.setNegativeButton("Pular") { _, _ ->
                responderPerguntas(codigoPdv, nome, preco, pergs, idx + 1, respostas, extras, sugestoes, escolhas)
            }
            b.setCancelable(false)
            b.show()
        } else {
            val marcadas = BooleanArray(rotulos.size)
            AlertDialog.Builder(this)
                .setTitle(p.texto + (if (p.max > 1) " (até ${p.max})" else ""))
                .setMultiChoiceItems(rotulos, marcadas) { _, pos, checked -> marcadas[pos] = checked }
                .setPositiveButton("OK") { _, _ ->
                    val escolhidas = p.opcoes.filterIndexed { i, _ -> marcadas[i] }
                    if (escolhidas.size < p.min) {
                        Toast.makeText(this, "Escolha pelo menos ${p.min}", Toast.LENGTH_SHORT).show()
                        responderPerguntas(codigoPdv, nome, preco, pergs, idx, respostas, extras, sugestoes, escolhas)
                    } else if (p.max > 0 && escolhidas.size > p.max) {
                        Toast.makeText(this, "No máximo ${p.max}", Toast.LENGTH_SHORT).show()
                        responderPerguntas(codigoPdv, nome, preco, pergs, idx, respostas, extras, sugestoes, escolhas)
                    } else {
                        responderPerguntas(codigoPdv, nome, preco, pergs, idx + 1,
                            respostas + escolhidas.map { it.codigo },
                            extras + escolhidas.sumOf { it.preco }, sugestoes, escolhas + escolhidas.map { rot(it) })
                    }
                }
                .setCancelable(false)
                .show()
        }
    }

    private fun dialogQtdObs(
        codigoPdv: Int, nome: String, preco: Double,
        respostas: List<Int>, extras: Double, sugestoes: List<String>,
        escolhas: List<String> = emptyList(),
    ) {
        val box = LinearLayout(this)
        box.orientation = LinearLayout.VERTICAL
        box.setPadding(dp(20), dp(8), dp(20), 0)

        // Quantidade: − 1 +
        val qtdRow = LinearLayout(this)
        qtdRow.orientation = LinearLayout.HORIZONTAL
        val menos = Button(this); menos.text = "−"
        val mais = Button(this); mais.text = "＋"
        val qtdTxt = TextView(this)
        qtdTxt.textSize = 22f
        qtdTxt.setPadding(dp(20), 0, dp(20), 0)
        qtdTxt.text = "1"
        var qtd = 1
        menos.setOnClickListener { if (qtd > 1) { qtd--; qtdTxt.text = "$qtd" } }
        mais.setOnClickListener { if (qtd < 99) { qtd++; qtdTxt.text = "$qtd" } }
        qtdRow.gravity = android.view.Gravity.CENTER_VERTICAL
        qtdRow.addView(menos, LinearLayout.LayoutParams(dp(56), dp(48)))
        qtdRow.addView(qtdTxt)
        qtdRow.addView(mais, LinearLayout.LayoutParams(dp(56), dp(48)))
        box.addView(qtdRow)

        val obsIn = EditText(this)
        obsIn.hint = "Observação (opcional)"
        box.addView(obsIn, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        // Sugestões do grupo ("ao ponto", "sem cebola"...) — toque adiciona.
        if (sugestoes.isNotEmpty()) {
            val sugRow = LinearLayout(this)
            sugRow.orientation = LinearLayout.HORIZONTAL
            val scroll = android.widget.HorizontalScrollView(this)
            sugestoes.take(8).forEach { s ->
                val b = Button(this)
                b.text = s
                b.textSize = 11f
                b.isAllCaps = false
                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(34))
                lp.marginEnd = dp(6)
                b.layoutParams = lp
                b.setOnClickListener {
                    val atual = obsIn.text.toString().trim()
                    obsIn.setText(if (atual.isBlank()) s else "$atual, $s")
                }
                sugRow.addView(b)
            }
            scroll.addView(sugRow)
            box.addView(scroll)
        }

        AlertDialog.Builder(this)
            .setTitle("$nome · ${Cupom.brl(preco + extras)}")
            .setView(box)
            .setPositiveButton("Adicionar") { _, _ ->
                carrinho.add(ItemCarrinho(
                    codigoPdv = codigoPdv, nome = nome, precoUnit = preco, qtd = qtd,
                    obs = obsIn.text.toString().trim().ifBlank { null },
                    respostas = respostas, extras = extras, escolhas = escolhas,
                ))
                atualizarCarrinho()
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    // ---- carrinho / enviar ----

    private fun atualizarCarrinho() {
        val n = carrinho.sumOf { it.qtd }
        val total = carrinho.sumOf { it.total }
        carrinhoBar.visibility = if (carrinho.isEmpty()) View.GONE else View.VISIBLE
        carrinhoTxt.text = "$n item(ns) · ${Cupom.brl(total)}  (toque pra revisar)"
    }

    // Revisão do pedido (o mesmo passo homologado da comanda do celular):
    // confere item a item, tira o que errou, e SÓ o ENVIAR daqui dispara o
    // envio de verdade pra cozinha.
    private fun revisarCarrinho() {
        if (carrinho.isEmpty()) return
        // Item COMPLETO: opções/complementos escolhidos + observação — o garçom
        // confere o pedido inteiro antes de mandar pra cozinha.
        val rotulos = carrinho.map {
            "${it.qtd}x ${it.nome} · ${Cupom.brl(it.total)}" +
                it.escolhas.joinToString("") { e -> "\n   • $e" } +
                (it.obs?.let { o -> "\n   ✎ $o" } ?: "")
        }.toTypedArray()
        val total = carrinho.sumOf { it.total }
        AlertDialog.Builder(this)
            .setTitle("Revisão — ${carrinho.sumOf { it.qtd }} item(ns) · ${Cupom.brl(total)}")
            .setItems(rotulos) { _, pos ->
                AlertDialog.Builder(this)
                    .setMessage("Tirar \"${carrinho[pos].nome}\" do pedido?")
                    .setPositiveButton("Tirar") { _, _ ->
                        carrinho.removeAt(pos)
                        atualizarCarrinho()
                        if (carrinho.isNotEmpty()) revisarCarrinho()
                    }
                    .setNegativeButton("Não") { _, _ -> revisarCarrinho() }
                    .show()
            }
            .setPositiveButton(if (ticket) "💳 COBRAR" else "✔ ENVIAR") { _, _ -> if (ticket) ticketPrevia() else enviar() }
            .setNegativeButton("Continuar lançando", null)
            .show()
    }

    private fun enviar() {
        if (carrinho.isEmpty()) return
        val tk = Session.token(this) ?: return finish()
        val itens = JSONArray()
        carrinho.forEach {
            val o = JSONObject().put("codigo_pdv", it.codigoPdv).put("qtd", it.qtd)
            if (it.obs != null) o.put("obs", it.obs)
            if (it.respostas.isNotEmpty()) o.put("respostas", JSONArray(it.respostas))
            itens.put(o)
        }
        enviarBtn.isEnabled = false
        enviarBtn.text = "Enviando…"
        Thread {
            try {
                val r = Api.enviar(Session.servidor(this), tk, numero, itens)
                runOnUiThread {
                    enviarBtn.isEnabled = true
                    enviarBtn.text = "ENVIAR"
                    when {
                        r.ok -> {
                            Toast.makeText(this, "✅ Enviado pra cozinha (${r.nItens} item/ns)", Toast.LENGTH_LONG).show()
                            finish()
                        }
                        r.contaPedida -> AlertDialog.Builder(this)
                            .setMessage((r.erro ?: "A conta já foi pedida.") + "\n\nLiberar a conta e enviar de novo?")
                            .setPositiveButton("Liberar") { _, _ -> liberarEEnviar() }
                            .setNegativeButton("Não", null)
                            .show()
                        r.precisaCadastro -> AlertDialog.Builder(this)
                            .setMessage(r.erro ?: "A comanda precisa de cadastro (nome + CPF/WhatsApp). Faça o cadastro no celular do garçom e lance de novo.")
                            .setPositiveButton("OK", null)
                            .show()
                        else -> Toast.makeText(this, r.erro ?: "Falha ao enviar", Toast.LENGTH_LONG).show()
                    }
                }
            } catch (e: Api.SemSessao) {
                runOnUiThread { Toast.makeText(this, e.message, Toast.LENGTH_LONG).show(); finish() }
            } catch (e: Exception) {
                runOnUiThread {
                    enviarBtn.isEnabled = true
                    enviarBtn.text = "ENVIAR"
                    Toast.makeText(this, e.message ?: "Falha ao enviar", Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }

    // ---- VENDA DIRETA (ticket) ----

    private fun itensJson(): JSONArray {
        val itens = JSONArray()
        carrinho.forEach {
            val o = JSONObject().put("codigo_pdv", it.codigoPdv).put("qtd", it.qtd)
            if (it.obs != null) o.put("obs", it.obs)
            if (it.respostas.isNotEmpty()) o.put("respostas", JSONArray(it.respostas))
            itens.put(o)
        }
        return itens
    }

    private fun ticketOcupado(on: Boolean, txt: String = "💳 COBRAR") {
        cobrandoTicket = on
        enviarBtn.isEnabled = !on
        enviarBtn.text = txt
    }

    /** Token do vendas-local = login.vence_ms.assinatura — vence nos próximos
     *  10 min? (a cobrança + o registro do pagamento têm que caber na sessão) */
    private fun tokenVenceLogo(tk: String): Boolean {
        val exp = tk.split('.').getOrNull(1)?.toLongOrNull() ?: return false
        return exp < System.currentTimeMillis() + 10 * 60_000L
    }

    /** Sessão vencida no ticket: pede o PIN do MESMO login, renova o token e
     *  segue (o carrinho fica). Sem login salvo → volta pro login de verdade. */
    private fun ticketRelogar(depois: () -> Unit) {
        val login = Session.login(this)
        if (login.isNullOrBlank()) {
            Session.clear(this)
            startActivity(android.content.Intent(this, LoginActivity::class.java))
            finishAffinity()
            return
        }
        val pin = EditText(this).apply {
            hint = "PIN"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD
        }
        val caixa = LinearLayout(this).apply { setPadding(48, 16, 48, 0); addView(pin) }
        val d = AlertDialog.Builder(this)
            .setTitle("Sessão expirou")
            .setMessage("Digite o PIN de $login pra continuar a venda (o carrinho continua).")
            .setView(caixa)
            .setNegativeButton("Cancelar", null)
            .setPositiveButton("Entrar", null)
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
                                d.dismiss()
                                depois()
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

    /** Preço do servidor (com e sem 10%) e o garçom escolhe — o 10% é opcional. */
    private fun ticketPrevia() {
        if (carrinho.isEmpty() || cobrandoTicket) return
        val tk = Session.token(this)
        // Sessão vencida (16 h) ou vencendo: renova AQUI com o PIN, sem perder o
        // carrinho. Antes o 401 fechava a tela e voltava pras mesas — que abrem
        // sem login —, e o COBRAR "não fazia nada" (Mar, 16/10).
        if (tk == null || tokenVenceLogo(tk)) { ticketRelogar { ticketPrevia() }; return }
        ticketOcupado(true, "Calculando…")
        val base = Session.servidor(this)
        Thread {
            try {
                val j = Api.ticketAbrir(base, tk, itensJson(), servico = false, previa = true)
                runOnUiThread {
                    ticketOcupado(false)
                    if (!j.optBoolean("ok")) {
                        Toast.makeText(this, j.optString("erro").ifBlank { "Falha ao calcular" }, Toast.LENGTH_LONG).show()
                        return@runOnUiThread
                    }
                    val com = j.optDouble("total_com", 0.0)
                    val sem = j.optDouble("total_sem", 0.0)
                    val svc = j.optDouble("valor_servico_10", 0.0)
                    val taxa = j.optDouble("taxa", 10.0)
                    val taxaTxt = if (taxa % 1.0 == 0.0) taxa.toInt().toString() else taxa.toString()
                    val n = carrinho.sumOf { it.qtd }
                    val b = AlertDialog.Builder(this)
                        .setTitle("🎟 $n ticket(s) — atendimento $taxaTxt%?")
                        .setMessage("Itens: ${Cupom.brl(sem)}\nServiço $taxaTxt%: ${Cupom.brl(svc)}\n\n" +
                            "COM $taxaTxt%: ${Cupom.brl(com)}\nSEM $taxaTxt%: ${Cupom.brl(sem)}\n\nO $taxaTxt% é opcional — pergunte ao cliente.")
                        .setNegativeButton("Voltar", null)
                    if (svc > 0) {
                        b.setPositiveButton("Com $taxaTxt% · ${Cupom.brl(com)}") { _, _ -> ticketCobrar(true) }
                        b.setNeutralButton("Sem $taxaTxt% · ${Cupom.brl(sem)}") { _, _ -> ticketCobrar(false) }
                    } else {
                        b.setPositiveButton("Cobrar ${Cupom.brl(sem)}") { _, _ -> ticketCobrar(false) }
                    }
                    b.show()
                }
            } catch (e: Api.SemSessao) {
                runOnUiThread { ticketOcupado(false); ticketRelogar { ticketPrevia() } }
            } catch (e: Exception) {
                runOnUiThread {
                    ticketOcupado(false)
                    Toast.makeText(this, e.message ?: "Falha ao calcular", Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }

    /** Abre o ticket no servidor (nada vai pra cozinha ainda) e cobra na
     *  maquininha. A conta, os itens e o KDS só nascem quando o pagamento
     *  registra (POST /api/lio/pagar com ticket_id). */
    private fun ticketCobrar(servico: Boolean) {
        val tk = Session.token(this)
        if (tk == null || tokenVenceLogo(tk)) { ticketRelogar { ticketCobrar(servico) }; return }
        if (!Pagamento.pronto) {
            Toast.makeText(this, "Maquininha não conectada — o ticket só é vendido na maquininha", Toast.LENGTH_LONG).show()
            if (Pagamento.configured()) Pagamento.bind(this, onReady = { }, onError = { })
            return
        }
        ticketOcupado(true, "Abrindo…")
        val base = Session.servidor(this)
        Thread {
            try {
                val j = Api.ticketAbrir(base, tk, itensJson(), servico = servico, previa = false)
                val id = j.optInt("ticket_id", 0)
                val totalCents = Math.round(j.optDouble("total", 0.0) * 100)
                if (!j.optBoolean("ok") || id <= 0 || totalCents <= 0) {
                    runOnUiThread {
                        ticketOcupado(false)
                        Toast.makeText(this, j.optString("erro").ifBlank { "Falha ao abrir o ticket" }, Toast.LENGTH_LONG).show()
                    }
                    return@Thread
                }
                val linhas = mutableListOf<Linha>()
                val arr = j.optJSONArray("itens") ?: JSONArray()
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    linhas.add(Linha("${o.optInt("qtd", 1)}x " + o.optString("nome"), Math.round(o.optDouble("valor", 0.0) * 100)))
                }
                val svcCents = Math.round(j.optDouble("valor_servico", 0.0) * 100)
                if (svcCents > 0) linhas.add(Linha("Serviço", svcCents))
                // só manda as linhas pro pedido da maquininha se fecham com o total
                val linhasOk = if (linhas.sumOf { it.valorCentavos } == totalCents) linhas else emptyList()
                val ref = "TICKET-$id"
                val destino = JSONObject().put("tipo", "ticket").put("ticket_id", id)
                runOnUiThread {
                    ticketOcupado(true, "Na maquininha…")
                    Pagamento.cobrar(
                        ref = ref,
                        linhas = linhasOk,
                        valorCentavos = totalCents,
                        onInicio = { },
                        onPago = { pedidoLio, pagamentos -> ticketRegistrar(j, pagamentos, pedidoLio) },
                        onCancelado = {
                            Recuperacao.evento(this, "cancelado", JSONObject().put("ref", ref).put("valor", totalCents / 100.0))
                            runOnUiThread {
                                ticketOcupado(false)
                                Toast.makeText(this, "Pagamento cancelado", Toast.LENGTH_SHORT).show()
                            }
                        },
                        onErro = { m ->
                            Recuperacao.evento(this, "erro", JSONObject().put("ref", ref).put("valor", totalCents / 100.0).put("erro", m))
                            runOnUiThread {
                                ticketOcupado(false)
                                Toast.makeText(this, m, Toast.LENGTH_LONG).show()
                            }
                        },
                        destino = destino,
                    )
                }
            } catch (e: Api.SemSessao) {
                runOnUiThread { ticketOcupado(false); ticketRelogar { ticketCobrar(servico) } }
            } catch (e: Exception) {
                runOnUiThread {
                    ticketOcupado(false)
                    Toast.makeText(this, e.message ?: "Falha ao abrir o ticket", Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }

    // Aprovado → fila de pendentes ANTES (igual à conta), registro com retry.
    // O ticket imprime de qualquer jeito: o dinheiro já foi aprovado e, se a
    // rede caiu, a fila reenvia e o servidor monta a conta depois.
    private fun ticketRegistrar(t: JSONObject, pagamentos: List<PagamentoLio>, pedidoLio: String) {
        val id = t.optInt("ticket_id", 0)
        if (pagamentos.isEmpty()) {
            EmAndamento.marcarPago(this, pedidoLio)
            Recuperacao.evento(this, "vazio", JSONObject().put("pedido_lio", pedidoLio).put("ticket_id", id))
            runOnUiThread {
                ticketOcupado(false)
                if (isFinishing || isDestroyed) return@runOnUiThread
                AlertDialog.Builder(this)
                    .setTitle("⚠️ Não cobre de novo ainda")
                    .setMessage("A maquininha avisou que o pagamento passou, mas não devolveu os dados da transação.\n\n" +
                        "Vou conferir direto no terminal. Se aprovado, o ticket $id entra sozinho — " +
                        "reimprima em 🎟 Ticket → Reimprimir. NÃO passe o cartão/Pix de novo antes disso.")
                    .setPositiveButton("OK") { _, _ -> finish() }
                    .setCancelable(false)
                    .show()
            }
            return
        }
        val tk = Session.token(this)
        val base = Session.servidor(this)
        Thread {
            var registrou = true
            var ultimoErro: String? = null
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
                        if (r.ok || r.jaRegistrado) { okEste = true; Pendentes.remover(this, fid) }
                        else ultimoErro = r.erro
                        break
                    } catch (e: Api.SemSessao) {
                        ultimoErro = e.message
                        break
                    } catch (e: Exception) {
                        ultimoErro = e.message
                        try { Thread.sleep(2000L * tentativa) } catch (_: InterruptedException) { }
                    }
                }
                if (!okEste) registrou = false
            }
            val total = pagamentos.sumOf { it.valorCentavos }
            val p0 = pagamentos.first()
            runOnUiThread {
                carrinho.clear()
                atualizarCarrinho()
                ticketOcupado(false)
                if (isFinishing || isDestroyed) return@runOnUiThread
                // comprovante da maquininha já saiu; agora os tickets, um por unidade
                Ticket.imprimirComRetomada(this, t)
                val msg = StringBuilder("Recebido ${Cupom.brl(total / 100.0)}\n${p0.forma.uppercase()} ${p0.bandeira}" +
                    (if (p0.nsu.isNotBlank()) " · NSU ${p0.nsu}" else "") +
                    "\n\n🎟 Ticket $id impresso.")
                if (!registrou) msg.append("\n\n⚠️ APROVADO na maquininha mas ainda não registrado no sistema" +
                    (ultimoErro?.let { " ($it)" } ?: "") + ". Ficou na fila — reenvie na tela de mesas.")
                AlertDialog.Builder(this)
                    .setTitle(if (registrou) "✅ Ticket pago" else "⚠️ Pago — registro pendente")
                    .setMessage(msg.toString())
                    .setPositiveButton("Nova venda") { _, _ -> }
                    .setNeutralButton("🔒 Reimprimir") { _, _ -> Ticket.reimprimirComSupervisor(this, id) }
                    .setNegativeButton("Sair") { _, _ -> finish() }
                    .setCancelable(false)
                    .show()
            }
        }.start()
    }

    private fun liberarEEnviar() {
        val tk = Session.token(this) ?: return
        Thread {
            try {
                Api.acaoConta(Session.servidor(this), tk, numero, "reabrir")
                runOnUiThread { enviar() }
            } catch (e: Exception) {
                runOnUiThread { Toast.makeText(this, e.message, Toast.LENGTH_LONG).show() }
            }
        }.start()
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private inner class ProdutoAdapter : BaseAdapter() {
        var itens: List<Api.Produto> = emptyList()
        override fun getCount() = itens.size
        override fun getItem(position: Int) = itens[position]
        override fun getItemId(position: Int) = position.toLong()

        override fun getView(position: Int, convertView: View?, parent: ViewGroup?): View {
            val v = convertView ?: layoutInflater.inflate(R.layout.item_produto, parent, false)
            val p = itens[position]
            v.findViewById<TextView>(R.id.nome).text = nomeComTamanho(p)
            val precoTxt = v.findViewById<TextView>(R.id.preco)
            precoTxt.text = when {
                p.grupo && p.precoMax != null && p.precoMax > p.preco ->
                    "${Cupom.brl(p.preco)}–${Cupom.brl(p.precoMax)} · ${p.variantes} opções"
                p.grupo -> "${Cupom.brl(p.preco)} · ${p.variantes} opções"
                else -> Cupom.brl(p.preco)
            }
            // ESTOQUE na consulta: quem está com a maquininha na mão precisa
            // saber quanto tem, não só se acabou (pedido do dono).
            val est = v.findViewById<TextView>(R.id.estoque)
            if (p.estoque != null && !p.semEstoque) {
                est.text = "resta " + Cupom.qtd(p.estoque)
                est.visibility = View.VISIBLE
            } else est.visibility = View.GONE
            val alpha = if (p.semEstoque) 0.4f else 1f
            v.findViewById<TextView>(R.id.nome).alpha = alpha
            precoTxt.alpha = alpha
            v.findViewById<TextView>(R.id.semEstoque).visibility = if (p.semEstoque) View.VISIBLE else View.GONE
            return v
        }
    }
}
