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

    private data class ItemCarrinho(
        val codigoPdv: Int,
        val nome: String,
        val precoUnit: Double,       // estimativa de tela; o preço real é o do servidor
        var qtd: Int,
        val obs: String?,
        val respostas: List<Int>,
        val extras: Double,          // soma dos preços das respostas do wizard
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

        buscaIn = findViewById(R.id.busca)
        chipsBox = findViewById(R.id.chips)
        lista = findViewById(R.id.listaProdutos)
        vazio = findViewById(R.id.produtosVazio)
        carrinhoBar = findViewById(R.id.carrinhoBar)
        carrinhoTxt = findViewById(R.id.carrinhoTxt)
        enviarBtn = findViewById(R.id.enviar)

        findViewById<TextView>(R.id.tituloProdutos).text =
            if (Session.ehComanda(this, numero)) "Lançar · Comanda $numero" else "Lançar · Mesa $numero"
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
            runOnUiThread { responderPerguntas(codigoPdv, nome, preco, pergs, 0, emptyList(), 0.0, sugestoes) }
        }.start()
    }

    /** Uma pergunta do wizard por vez; no fim cai no dialog de qtd/observação. */
    private fun responderPerguntas(
        codigoPdv: Int, nome: String, preco: Double,
        pergs: List<Api.Pergunta>, idx: Int,
        respostas: List<Int>, extras: Double,
        sugestoes: List<String>,
    ) {
        if (idx >= pergs.size) { dialogQtdObs(codigoPdv, nome, preco, respostas, extras, sugestoes); return }
        val p = pergs[idx]
        val rotulos = p.opcoes.map { it.nome + (if (it.preco > 0) "  +" + Cupom.brl(it.preco) else "") }.toTypedArray()

        if (p.max == 1) {
            val b = AlertDialog.Builder(this)
                .setTitle(p.texto)
                .setItems(rotulos) { _, pos ->
                    val op = p.opcoes[pos]
                    responderPerguntas(codigoPdv, nome, preco, pergs, idx + 1,
                        respostas + op.codigo, extras + op.preco, sugestoes)
                }
            if (p.min < 1) b.setNegativeButton("Pular") { _, _ ->
                responderPerguntas(codigoPdv, nome, preco, pergs, idx + 1, respostas, extras, sugestoes)
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
                        responderPerguntas(codigoPdv, nome, preco, pergs, idx, respostas, extras, sugestoes)
                    } else if (p.max > 0 && escolhidas.size > p.max) {
                        Toast.makeText(this, "No máximo ${p.max}", Toast.LENGTH_SHORT).show()
                        responderPerguntas(codigoPdv, nome, preco, pergs, idx, respostas, extras, sugestoes)
                    } else {
                        responderPerguntas(codigoPdv, nome, preco, pergs, idx + 1,
                            respostas + escolhidas.map { it.codigo },
                            extras + escolhidas.sumOf { it.preco }, sugestoes)
                    }
                }
                .setCancelable(false)
                .show()
        }
    }

    private fun dialogQtdObs(
        codigoPdv: Int, nome: String, preco: Double,
        respostas: List<Int>, extras: Double, sugestoes: List<String>,
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
                    respostas = respostas, extras = extras,
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
        val rotulos = carrinho.map {
            "${it.qtd}x ${it.nome} · ${Cupom.brl(it.total)}" + (it.obs?.let { o -> "\n   $o" } ?: "")
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
            .setPositiveButton("✔ ENVIAR") { _, _ -> enviar() }
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
