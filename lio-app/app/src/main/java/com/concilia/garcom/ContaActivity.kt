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
    private var nomeAtual: String? = null      // quem já está identificado aqui
    private var infoAtual: Api.MesaInfo? = null           // comandas da mesa (chips)
    private var resumoGeral: org.json.JSONObject? = null  // /api/conta/texto: mesa + comandas
    private var lioReady = false
    private var cobrando = false

    private lateinit var titulo: TextView
    private lateinit var badge: TextView
    private lateinit var comandasBox: LinearLayout
    private lateinit var lista: ListView
    private lateinit var vazio: TextView
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
        // NÃO desligar o serviço da maquininha aqui: o bind é global do app
        // (applicationContext). Abrir a comanda a partir da mesa e voltar
        // derrubava o serviço da tela de baixo — "maquininha indisponível".
        super.onDestroy()
    }

    // Conecta ao serviço de pagamento. Fora da maquininha (celular) o app segue
    // como consulta/lançamento — o botão de receber some e o aviso explica.
    private fun bindLio() {
        receberBtn.isEnabled = false
        lioStatus.visibility = View.VISIBLE
        lioStatus.text = "💳 Conectando à maquininha…"
        Pagamento.bind(
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
                // Nomes vêm da mesa: a da conta (mesa) ou a mesa da comanda.
                val mesaConsulta = if (ehComanda) c?.mesa else numero
                val info = if (mesaConsulta != null) try { Api.mesaInfo(base, mesaConsulta) } catch (_: Exception) { null } else null
                // O GERAL (mesa + comandas penduradas) vem do mesmo lugar do
                // cupom — a tela tem que bater com a conta impressa.
                val texto = if (!ehComanda && c != null) try { Api.contaTexto(base, numero, Session.token(this)) } catch (_: Exception) { null } else null
                runOnUiThread {
                    conta = c
                    infoAtual = if (ehComanda) null else info
                    resumoGeral = texto
                    mostrarConta(c)
                    mostrarComandas(if (ehComanda) null else info)
                    nomeAtual = info?.nomes?.get(numero.toString())?.takeIf { it.isNotBlank() }
                    titulo.text = (if (ehComanda) "Comanda $numero" else "Mesa $numero") +
                        (nomeAtual?.let { " · $it" } ?: "")
                }
            } catch (e: Exception) {
                runOnUiThread {
                    vazio.visibility = View.VISIBLE
                    vazio.text = e.message ?: "Erro ao carregar a conta"
                }
            }
        }.start()
    }

    /** Linha de total no FIM da lista — rola junto com os itens, em colunas. */
    private data class Resumo(
        val rotulo: String,
        val valor: String,
        val destaque: Boolean = false,
        val vermelho: Boolean = false,
    )

    private fun mostrarConta(c: Api.Conta?) {
        if (c == null) {
            // Mesa vazia: sem conta no Consumer ainda — o primeiro envio abre.
            adapter.linhas = emptyList()
            adapter.notifyDataSetChanged()
            vazio.visibility = View.VISIBLE
            vazio.text = "Sem conta aberta — lance o primeiro item"
            badge.visibility = View.GONE
        } else {
            // Itens, depois os pagamentos (vermelho), e por último o FECHAMENTO
            // organizado — tudo na MESMA lista, como um extrato.
            val linhas = mutableListOf<Any>()
            linhas.addAll(c.itens)
            linhas.addAll(c.pagamentos.filter { it.status == "ok" })

            // Consumo + serviço − pago = saldo, SEMPRE com os 10% à vista.
            // Antes de pedir a conta o serviço é estimativa; ao pedir, o
            // servidor aplica no pedido e os números viram os oficiais.
            // QUITADA (pago ≥ consumo) = saldo zero — não se estima serviço
            // sobre conta paga (serviço é opcional; regra do passe de saída).
            val taxa = Session.taxaServico(this)
            val taxaTxt = if (taxa == Math.floor(taxa)) taxa.toInt().toString() else taxa.toString()
            val aplicado = c.servico > 0
            val quitada = c.saldo <= 0.009
            val consumo = if (aplicado) c.total - c.servico else c.total
            linhas.add(Resumo("Consumo", Cupom.brl(consumo)))
            if (quitada) {
                if (aplicado) linhas.add(Resumo("Serviço", Cupom.brl(c.servico)))
                linhas.add(Resumo("Total", Cupom.brl(c.total)))
                if (c.pago > 0) linhas.add(Resumo("Pago", "− " + Cupom.brl(c.pago), vermelho = true))
                linhas.add(Resumo("SALDO — QUITADA", Cupom.brl(0.0), destaque = true))
            } else {
                val svc = if (aplicado) c.servico else Math.round(consumo * taxa) / 100.0
                val totalCom = consumo + svc
                val saldoExibe = if (aplicado) c.saldo else totalCom - c.pago
                linhas.add(Resumo("Serviço $taxaTxt%" + (if (aplicado) "" else " (entra ao pedir a conta)"), Cupom.brl(svc)))
                linhas.add(Resumo("Total", Cupom.brl(totalCom)))
                if (c.pago > 0) linhas.add(Resumo("Pago", "− " + Cupom.brl(c.pago), vermelho = true))
                linhas.add(Resumo("SALDO", Cupom.brl(saldoExibe), destaque = true))
            }

            // Mesa com comandas: o RESULTADO FINAL igual ao cupom (senão a mesa
            // diz 171 e a conta impressa diz 222 — divergência).
            val t = resumoGeral
            val nComandas = t?.optJSONArray("comandas")?.length() ?: 0
            if (t != null && nComandas > 0) {
                linhas.add(Resumo("Comandas na mesa ($nComandas)", Cupom.brl(t.optDouble("total_comandas", 0.0))))
                linhas.add(Resumo("GERAL mesa+comandas", Cupom.brl(t.optDouble("geral", 0.0))))
                linhas.add(Resumo("FALTA GERAL", Cupom.brl(t.optDouble("falta_geral", 0.0)), destaque = true))
            }

            adapter.linhas = linhas
            adapter.notifyDataSetChanged()
            vazio.visibility = if (c.itens.isEmpty()) View.VISIBLE else View.GONE
            if (c.itens.isEmpty()) vazio.text = "Conta aberta, sem itens"
            badge.visibility = if (c.contaPedida) View.VISIBLE else View.GONE
        }
        atualizarBotoes()
    }

    private fun mostrarComandas(info: Api.MesaInfo?) {
        comandasBox.removeAllViews()
        val cs = info?.comandas ?: emptyList()
        comandasBox.visibility = if (cs.isEmpty()) View.GONE else View.VISIBLE
        // Valor de cada comanda no chip (mesma fonte do cupom) — o garçom vê
        // na mesa que existem comandas penduradas e quanto cada uma deve.
        val valores = mutableMapOf<Int, String>()
        resumoGeral?.optJSONArray("comandas")?.let { arr ->
            for (i in 0 until arr.length()) {
                val c = arr.optJSONObject(i) ?: continue
                valores[c.optInt("numero")] =
                    if (c.optBoolean("quitada")) "paga" else Cupom.brl(c.optDouble("resta", c.optDouble("com_servico", 0.0)))
            }
        }
        cs.forEach { cNum ->
            val b = Button(this)
            b.text = "C$cNum" + (info?.nomes?.get(cNum.toString())?.let { " · $it" } ?: "") +
                (valores[cNum]?.let { " · $it" } ?: "")
            // Botão GRANDE (tamanho dos botões de ação) — é alvo de toque frequente.
            b.textSize = 15f
            b.isAllCaps = false
            b.setPadding(dp(16), 0, dp(16), 0)
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(52))
            lp.marginEnd = dp(8)
            b.layoutParams = lp
            b.setOnClickListener {
                val i = Intent(this, ContaActivity::class.java)
                i.putExtra("numero", cNum)
                startActivity(i)
            }
            comandasBox.addView(b)
        }
    }

    /** Saldo JÁ com o serviço (10% padrão): o Receber nunca aparece sem os 10%
     *  — no dialog dá pra subir pra 15%, nunca ficar abaixo de 10.
     *  Conta QUITADA (pago ≥ consumo) é saldo ZERO: serviço é opcional por lei
     *  (mesma regra do passe de saída) — não se estima 10% sobre conta paga. */
    private fun saldoComServico(c: Api.Conta): Double {
        if (c.saldo <= 0.009) return 0.0
        if (c.servico > 0) return c.saldo
        val taxa = Session.taxaServico(this)
        val svc = Math.round(c.total * taxa) / 100.0
        return Math.max(0.0, Math.round((c.total + svc - c.pago) * 100) / 100.0)
    }

    private fun atualizarBotoes() {
        val c = conta
        val saldoExibe = c?.let { saldoComServico(it) } ?: 0.0
        val temSaldo = saldoExibe > 0.009
        receberBtn.visibility = if (lioReady) View.VISIBLE else View.GONE
        receberBtn.isEnabled = lioReady && temSaldo && !cobrando
        receberBtn.text = when {
            cobrando -> "💳 Aguardando pagamento…"
            temSaldo -> "💳 Receber ${Cupom.brl(saldoExibe)}"
            else -> "💳 Receber"
        }
        conferenciaBtn.isEnabled = c != null
        contaPedidaBtn.isEnabled = c != null
        contaPedidaBtn.text = if (c?.contaPedida == true) "Liberar conta" else "Pedir conta"
        // Conta pedida trava lançamento novo (regra do servidor).
        lancarBtn.isEnabled = !(c?.contaPedida ?: false)
        lancarBtn.text = if (c?.contaPedida == true) "Conta pedida" else "＋ Lançar"
    }

    private fun lancar() {
        val i = Intent(this, ProdutosActivity::class.java)
        i.putExtra("numero", numero)
        startActivity(i)
    }

    private fun alternarContaPedida() {
        val c = conta ?: return
        val tk = Session.token(this) ?: return logout()
        if (c.contaPedida) {
            AlertDialog.Builder(this)
                .setMessage("Liberar a conta pra lançar de novo?")
                .setPositiveButton("Sim") { _, _ -> executarAcaoConta(tk, "reabrir", null) }
                .setNegativeButton("Não", null)
                .show()
            return
        }
        // Pedir a conta: trava lançamentos e imprime — com rateio nos botões.
        val div = escolhaDivisao()
        AlertDialog.Builder(this)
            .setTitle("Pedir a conta?")
            .setMessage("Trava novos lançamentos e imprime a conta completa aqui na maquininha.")
            .setView(caixa(div.view))
            .setPositiveButton("Pedir e imprimir") { _, _ ->
                executarAcaoConta(tk, "fechar", div.valor())
            }
            .setNegativeButton("Não", null)
            .show()
    }

    private fun executarAcaoConta(tk: String, acao: String, pessoas: Int?) {
        Thread {
            try {
                val r = Api.acaoConta(Session.servidor(this), tk, numero, acao)
                runOnUiThread {
                    Toast.makeText(this, r.optString("msg", r.optString("erro", "ok")), Toast.LENGTH_SHORT).show()
                    carregar()
                    // Conta pedida = conta na mão: imprime na hora, com tudo.
                    if (acao == "fechar" && r.optBoolean("ok")) imprimirConta("CONTA", pessoas)
                }
            } catch (e: Api.SemSessao) {
                runOnUiThread { logout() }
            } catch (e: Exception) {
                runOnUiThread { Toast.makeText(this, e.message, Toast.LENGTH_LONG).show() }
            }
        }.start()
    }

    // ---- menu ⋯: identificar / vincular comanda / transferir-juntar ----

    private fun mostrarMaisAcoes() {
        data class Acao(val rotulo: String, val executar: () -> Unit)
        val acoes = mutableListOf<Acao>()
        // Já identificado: o dono não muda por aqui (mesma regra do celular).
        val dono = nomeAtual
        if (dono == null) acoes.add(Acao("👤 Identificar cliente") { dialogIdentificar() })
        else acoes.add(Acao("👤 $dono · já identificado") {
            Toast.makeText(this, "O dono não muda por aqui — já identificado: $dono", Toast.LENGTH_LONG).show()
        })
        if (!ehComanda && Session.comandaAtiva(this)) {
            acoes.add(Acao("🧾 Vincular comanda a esta mesa") { dialogVincular() })
        }
        acoes.add(Acao(if (ehComanda) "🔁 Mudar a comanda de mesa" else "🔁 Transferir/juntar em outra mesa") { dialogTransferir() })
        // Conta QUITADA: fechar = ato final do caixa (some da grade, libera).
        if (conta != null && (conta?.saldo ?: 1.0) <= 0.009) {
            acoes.add(Acao("✔ Fechar conta (quitada)") { dialogFechar() })
        }
        // Comanda vinculada SEM pedido: só solta o número (não há o que fechar).
        if (ehComanda && conta == null) {
            acoes.add(Acao("✔ Dar baixa na comanda (vazia)") { darBaixaComanda() })
        }
        // Passe de saída (catraca + cancela) — o servidor exige conta zerada.
        acoes.add(Acao("🚗 Passe de saída") { dialogPasse(numero) })
        AlertDialog.Builder(this)
            .setTitle(titulo.text)
            .setItems(acoes.map { it.rotulo }.toTypedArray()) { _, pos -> acoes[pos].executar() }
            .setNegativeButton("Fechar", null)
            .show()
    }

    private fun dialogFechar() {
        val tk = Session.token(this) ?: return logout()
        AlertDialog.Builder(this)
            .setMessage("Fechar a conta ${titulo.text}? Ela some da grade e a " +
                (if (ehComanda) "comanda" else "mesa") + " fica livre.")
            .setPositiveButton("Fechar") { _, _ ->
                Thread {
                    try {
                        val r = Api.lioFechar(Session.servidor(this), tk, numero)
                        runOnUiThread {
                            if (r.optBoolean("ok")) {
                                Toast.makeText(this, "✓ Conta fechada — liberada!", Toast.LENGTH_LONG).show()
                                // Fechou = hora de oferecer a nota fiscal (some
                                // se a NFC-e estiver desligada no painel).
                                nfcePerguntar(numero) { finish() }
                            } else {
                                Toast.makeText(this, r.optStringOrNull("erro") ?: "Não fechou", Toast.LENGTH_LONG).show()
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

    private fun darBaixaComanda() {
        val tk = Session.token(this) ?: return logout()
        AlertDialog.Builder(this)
            .setMessage("Dar baixa na comanda $numero? O número fica livre pra outro cliente.")
            .setPositiveButton("Dar baixa") { _, _ ->
                Thread {
                    try {
                        val r = Api.comandaBaixa(Session.servidor(this), tk, numero)
                        runOnUiThread {
                            if (r.optBoolean("ok")) {
                                Toast.makeText(this, r.optString("msg", "Comanda liberada."), Toast.LENGTH_LONG).show()
                                finish()
                            } else {
                                Toast.makeText(this, r.optStringOrNull("erro") ?: "Não deu baixa", Toast.LENGTH_LONG).show()
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

    // ---- WhatsApp com PAÍS (bandeirinha +DDI) — turista também é cliente ----
    // BR (+55) mantém o padrão da casa: salva DDD+número, sem o 55. Outro
    // país: salva DDI+número completo (o telefone só é usado em consulta e
    // cadastro — o servidor nunca monta link wa.me com ele, conferido).
    private val PAISES_ZAP = listOf(
        "🇧🇷" to "55", "🇦🇷" to "54", "🇺🇾" to "598", "🇵🇾" to "595", "🇨🇱" to "56",
        "🇧🇴" to "591", "🇵🇪" to "51", "🇨🇴" to "57", "🇺🇸" to "1", "🇲🇽" to "52",
        "🇵🇹" to "351", "🇪🇸" to "34", "🇫🇷" to "33", "🇮🇹" to "39", "🇩🇪" to "49", "🇬🇧" to "44",
    )

    private class CampoZap(
        val view: LinearLayout,
        /** Padrão da casa (cadastro): BR sem o 55; gringo com DDI. */
        val valor: () -> String?,
        /** Sempre DDI+número (wa.me exige o país, inclusive no Brasil). */
        val valorComDdi: () -> String?,
    )

    private fun campoZap(): CampoZap {
        var idx = 0
        val btn = Button(this)
        btn.textSize = 14f
        btn.isAllCaps = false
        val input = campo("WhatsApp com DDD (opcional)", android.text.InputType.TYPE_CLASS_PHONE)
        fun pinta() {
            val (bandeira, ddi) = PAISES_ZAP[idx]
            btn.text = "$bandeira +$ddi"
            input.hint = if (ddi == "55") "WhatsApp com DDD (opcional)" else "WhatsApp (sem o +$ddi)"
        }
        btn.setOnClickListener {
            AlertDialog.Builder(this)
                .setTitle("País do WhatsApp")
                .setItems(PAISES_ZAP.map { "${it.first}  +${it.second}" }.toTypedArray()) { _, pos ->
                    idx = pos
                    pinta()
                }
                .show()
        }
        pinta()
        val row = LinearLayout(this)
        row.orientation = LinearLayout.HORIZONTAL
        row.gravity = android.view.Gravity.CENTER_VERTICAL
        row.addView(btn, LinearLayout.LayoutParams(dp(100), dp(48)))
        val lp = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT)
        lp.weight = 1f
        row.addView(input, lp)
        return CampoZap(
            row,
            valor = {
                val d = input.text.toString().filter { it.isDigit() }
                val ddi = PAISES_ZAP[idx].second
                when {
                    d.isEmpty() -> null
                    ddi == "55" -> d.takeIf { it.length >= 10 }
                    else -> (ddi + d).takeIf { d.length >= 7 }
                }
            },
            valorComDdi = {
                val d = input.text.toString().filter { it.isDigit() }
                val ddi = PAISES_ZAP[idx].second
                d.takeIf { it.length >= 7 }?.let { ddi + it }
            },
        )
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

    // O FLUXO É UM SÓ (igual à tela do celular): CPF → o nome VEM — da base da
    // casa, de quem já atendemos, das outras filiais ou do SPC. O garçom não
    // digita nome; o campo manual só aparece quando NENHUMA fonte respondeu.

    private class Achado {
        var nome: String? = null
        var contatoFb: Int? = null
    }

    private fun cpfValido(c: String): Boolean {
        if (c.length != 11 || c.all { it == c[0] }) return false
        for (k in 0..1) {
            val len = 9 + k
            val pos = 10 + k
            var soma = 0
            for (i in 0 until len) soma += (c[i] - '0') * (pos - i)
            var d = (soma * 10) % 11
            if (d == 10) d = 0
            if (d != c[len] - '0') return false
        }
        return true
    }

    private fun fonteTexto(f: String?): String = when (f) {
        "consumer" -> "já é cliente da casa"
        "grupo" -> "já veio em outra unidade"
        "ja-atendido" -> "já atendido aqui"
        "spc", "spc-cache" -> "consulta externa"
        "ambiguo" -> "CPF repetido na base"
        else -> "cadastro"
    }

    /** Liga a consulta automática: 11 dígitos válidos → busca (500ms) → nome. */
    private fun ligarConsultaCpf(cpfIn: EditText, status: TextView, nomeManual: EditText, achado: Achado) {
        val h = android.os.Handler(android.os.Looper.getMainLooper())
        var pendente: Runnable? = null
        val cinza = 0xFF6B7280.toInt()
        val verde = 0xFF0F8A3E.toInt()
        val ambar = 0xFFB45309.toInt()
        val vermelho = 0xFFDC2626.toInt()
        status.text = "Digite o CPF — o nome vem da consulta."
        cpfIn.addTextChangedListener(object : android.text.TextWatcher {
            override fun afterTextChanged(s: android.text.Editable?) {
                pendente?.let { h.removeCallbacks(it) }
                achado.nome = null
                achado.contatoFb = null
                nomeManual.visibility = View.GONE
                val d = (s?.toString() ?: "").filter { it.isDigit() }
                if (d.length < 11) {
                    status.setTextColor(cinza)
                    status.text = "Digite o CPF — o nome vem da consulta."
                    return
                }
                if (!cpfValido(d)) {
                    status.setTextColor(vermelho)
                    status.text = "CPF não confere — confira os números."
                    return
                }
                status.setTextColor(cinza)
                status.text = "consultando…"
                val r = Runnable {
                    Thread {
                        val resp = Api.identificarBuscar(Session.servidor(this@ContaActivity), d, null)
                        runOnUiThread {
                            val nome = resp?.optStringOrNull("nome")
                            when {
                                resp == null || !resp.optBoolean("ok") -> {
                                    status.setTextColor(vermelho)
                                    status.text = resp?.optStringOrNull("erro") ?: "A consulta não respondeu."
                                }
                                nome != null -> {
                                    achado.nome = nome
                                    achado.contatoFb = if (resp.isNull("contato_fb")) null else resp.optInt("contato_fb")
                                    status.setTextColor(verde)
                                    status.text = "✓ $nome · ${fonteTexto(resp.optStringOrNull("fonte"))}"
                                }
                                resp.optString("fonte") == "erro" -> {
                                    status.setTextColor(ambar)
                                    status.text = "A consulta não respondeu agora — digite o nome:"
                                    nomeManual.visibility = View.VISIBLE
                                }
                                else -> {
                                    status.setTextColor(ambar)
                                    status.text = "Não achei nome pra este CPF. Se o número está certo, digite o nome:"
                                    nomeManual.visibility = View.VISIBLE
                                }
                            }
                        }
                    }.start()
                }
                pendente = r
                h.postDelayed(r, 500)
            }
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        })
    }

    /** Quem está na mesa/comanda: CPF → nome automático (fluxo do celular). */
    private fun dialogIdentificar() {
        val achado = Achado()
        val status = TextView(this)
        status.textSize = 13f
        val cpfIn = campo("CPF (só números)", android.text.InputType.TYPE_CLASS_NUMBER)
        val zap = campoZap()
        val nomeManual = campo("Nome")
        nomeManual.visibility = View.GONE
        ligarConsultaCpf(cpfIn, status, nomeManual, achado)

        val dlg = AlertDialog.Builder(this)
            .setTitle("Quem está ${if (ehComanda) "na comanda" else "na mesa"} $numero?")
            .setView(caixa(status, cpfIn, zap.view, nomeManual))
            .setPositiveButton("Salvar", null)
            .setNegativeButton("Cancelar", null)
            .create()
        dlg.setOnShowListener {
            dlg.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val nome = achado.nome
                    ?: nomeManual.text.toString().trim().takeIf { nomeManual.visibility == View.VISIBLE && it.isNotBlank() }
                if (nome == null) {
                    Toast.makeText(this, "Digite o CPF — o nome vem da consulta.", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                val cpf = cpfIn.text.toString().filter { it.isDigit() }.takeIf { it.length == 11 }
                val tel = zap.valor()
                Thread {
                    try {
                        val r = Api.identificarSalvar(Session.servidor(this), numero, nome, cpf, tel, achado.contatoFb, cadastrar = true)
                        runOnUiThread {
                            when {
                                r.optBoolean("ok") -> {
                                    Toast.makeText(this, "✓ ${r.optString("nome_curto", nome)}", Toast.LENGTH_SHORT).show()
                                    carregar()
                                    dlg.dismiss()
                                }
                                r.optBoolean("ja_tem_dono") -> AlertDialog.Builder(this)
                                    .setMessage("Já tem dono: ${r.optString("dono")}. O dono não muda por aqui — confira o CPF.")
                                    .setPositiveButton("OK", null).show()
                                else -> Toast.makeText(this, r.optStringOrNull("erro") ?: "Não salvou", Toast.LENGTH_LONG).show()
                            }
                        }
                    } catch (e: Exception) {
                        runOnUiThread { Toast.makeText(this, e.message, Toast.LENGTH_LONG).show() }
                    }
                }.start()
            }
        }
        dlg.show()
    }

    /** Comanda nova nasce COM o dono (CPF → nome), igual ao celular:
     *  vincular + identificar na sequência — falhou, não sobra comanda solta. */
    private fun dialogVincular() {
        val achado = Achado()
        val comandaIn = campo("Nº da comanda (${Session.comandaMin(this)}–${Session.numeroMax(this)})", android.text.InputType.TYPE_CLASS_NUMBER)
        val status = TextView(this)
        status.textSize = 13f
        val cpfIn = campo("CPF do dono (só números)", android.text.InputType.TYPE_CLASS_NUMBER)
        val zap = campoZap()
        val nomeManual = campo("Nome")
        nomeManual.visibility = View.GONE
        ligarConsultaCpf(cpfIn, status, nomeManual, achado)

        val dlg = AlertDialog.Builder(this)
            .setTitle("Vincular comanda à mesa $numero")
            .setView(caixa(comandaIn, status, cpfIn, zap.view, nomeManual))
            .setPositiveButton("Vincular", null)
            .setNegativeButton("Cancelar", null)
            .create()
        dlg.setOnShowListener {
            dlg.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val cNum = comandaIn.text.toString().trim().toIntOrNull()
                if (cNum == null) {
                    Toast.makeText(this, "Número da comanda inválido", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                val nome = achado.nome
                    ?: nomeManual.text.toString().trim().takeIf { nomeManual.visibility == View.VISIBLE && it.isNotBlank() }
                val cpf = cpfIn.text.toString().filter { it.isDigit() }.takeIf { it.length == 11 }
                val tel = zap.valor()
                val tk = Session.token(this) ?: return@setOnClickListener logout()
                Thread {
                    try {
                        // Comanda já ABERTA (nesta ou noutra mesa) não se recadastra —
                        // o dono não muda. Transfira de mesa ou dê baixa nela antes.
                        val emUso = try {
                            Api.abertas(Session.servidor(this)).second.firstOrNull { it.numero == cNum }
                        } catch (_: Exception) { null }
                        if (emUso != null) {
                            runOnUiThread {
                                AlertDialog.Builder(this)
                                    .setMessage("A comanda $cNum já está aberta" +
                                        (emUso.mesa?.let { " na mesa $it" } ?: "") +
                                        (emUso.nome?.let { " ($it)" } ?: "") +
                                        ". O dono não muda — transfira de mesa ou dê baixa nela.")
                                    .setPositiveButton("OK", null).show()
                            }
                            return@Thread
                        }
                        val r = Api.vincular(Session.servidor(this), tk, numero, cNum, nome, cpf, tel, achado.contatoFb)
                        if (r.optBoolean("ok") && nome != null) {
                            // Carimba o dono na comanda recém-vinculada (mesmo passo do celular).
                            try { Api.identificarSalvar(Session.servidor(this), cNum, nome, cpf, tel, achado.contatoFb, cadastrar = true) } catch (_: Exception) { }
                        }
                        runOnUiThread {
                            when {
                                r.optBoolean("ok") -> {
                                    Toast.makeText(this, "✓ Comanda $cNum na mesa $numero" +
                                        (r.optStringOrNull("nome_curto")?.let { " ($it)" } ?: ""), Toast.LENGTH_SHORT).show()
                                    carregar()
                                    dlg.dismiss()
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
        }
        dlg.show()
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

    /** "Dividir por" com BOTÕES [1..5] + campo pra número maior — nada de
     *  digitar no caso comum. valor() devolve null quando não há rateio (1). */
    private class EscolhaDivisao(val view: LinearLayout, val valor: () -> Int?)

    private fun escolhaDivisao(): EscolhaDivisao {
        var escolhido = 1
        val botoes = mutableListOf<Pair<Int, Button>>()
        val maisIn = campo("Mais que 5? Digite aqui", android.text.InputType.TYPE_CLASS_NUMBER)
        fun pinta() {
            val digitado = maisIn.text.toString().trim().toIntOrNull()
            botoes.forEach { (n, b) ->
                val on = digitado == null && n == escolhido
                b.setBackgroundColor(if (on) 0xFF0C7091.toInt() else 0xFFE5E7EB.toInt())
                b.setTextColor(if (on) 0xFFFFFFFF.toInt() else 0xFF374151.toInt())
            }
        }
        val row = LinearLayout(this)
        row.orientation = LinearLayout.HORIZONTAL
        (1..5).forEach { n ->
            val b = Button(this)
            b.text = "$n"
            b.textSize = 15f
            val lp = LinearLayout.LayoutParams(0, dp(46))
            lp.weight = 1f
            lp.marginEnd = dp(4)
            b.layoutParams = lp
            b.setOnClickListener { escolhido = n; maisIn.setText(""); pinta() }
            row.addView(b)
            botoes.add(n to b)
        }
        maisIn.addTextChangedListener(object : android.text.TextWatcher {
            override fun afterTextChanged(s: android.text.Editable?) { pinta() }
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        })
        val rot = TextView(this)
        rot.text = "Dividir por"
        rot.textSize = 13f
        rot.setTypeface(null, android.graphics.Typeface.BOLD)
        rot.setPadding(0, dp(8), 0, dp(2))
        val box = LinearLayout(this)
        box.orientation = LinearLayout.VERTICAL
        listOf<View>(rot, row, maisIn).forEach {
            box.addView(it, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        pinta()
        return EscolhaDivisao(box) {
            (maisIn.text.toString().trim().toIntOrNull() ?: escolhido).takeIf { it > 1 }
        }
    }

    private fun imprimirConferencia() {
        val div = escolhaDivisao()
        AlertDialog.Builder(this)
            .setTitle("Imprimir conferência")
            .setView(caixa(div.view))
            .setPositiveButton("🖨 Imprimir") { _, _ -> imprimirConta("CONFERÊNCIA", div.valor()) }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun imprimirConta(rotulo: String, pessoas: Int?) {
        conferenciaBtn.isEnabled = false
        Thread {
            try {
                val j = Api.contaTexto(Session.servidor(this), numero, Session.token(this))
                val blocos = Cupom.montarBlocos(j, ehComanda, Session.loja(this), rotulo, pessoas)
                runOnUiThread {
                    Pagamento.imprimirBlocos(
                        this, blocos,
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
    // ESPELHO da tela Receber do celular (telaReceber/rcbCalc do vendas-local):
    // consumo + serviço ESCOLHIDO (chips 10%/15%) − já pago, "Dividir por"
    // 1–6, ou valor digitado. O servidor aceita o teto com serviço
    // (permitir_servico no /api/lio/pagar) — não depende de pedir a conta.
    private fun receber() {
        if (conta == null || !lioReady || cobrando) return
        abrirReceber(numero)
    }

    /** Abre o Receber de um ALVO (a própria conta OU uma comanda da mesa) —
     *  os chips "Receber de" trocam de alvo, igual à tela do celular. */
    private fun abrirReceber(alvo: Int) {
        Thread {
            val base = Session.servidor(this)
            val texto = try { Api.contaTexto(base, alvo, Session.token(this)) } catch (_: Exception) { null }
            val cAlvo = if (alvo == numero) conta else try { Api.conta(base, alvo) } catch (_: Exception) { null }
            runOnUiThread {
                if (texto == null && cAlvo == null) {
                    Toast.makeText(this, "Sem conta aberta no $alvo", Toast.LENGTH_SHORT).show()
                } else {
                    dialogReceber(alvo, cAlvo, texto)
                }
            }
        }.start()
    }

    private fun dialogReceber(alvo: Int, cAlvo: Api.Conta?, texto: org.json.JSONObject?) {
        // Consumo da conta do ALVO (mesa ou comanda) — mesma base do celular.
        val aplicado = (cAlvo?.servico ?: 0.0) > 0
        val itens = texto?.optDouble("total", -1.0)?.takeIf { it >= 0 }
            ?: (cAlvo?.let { if (aplicado) it.total - it.servico else it.total } ?: 0.0)
        val pago = cAlvo?.pago ?: texto?.optDouble("pago", 0.0) ?: 0.0
        // DESCONTO/ACRÉSCIMO do pedido (do Consumer): a conta com desconto era
        // cobrada CHEIA — o cálculo só olhava itens + serviço − pago.
        val desconto = texto?.optDouble("desconto", 0.0) ?: 0.0
        val acrescimo = texto?.optDouble("acrescimo", 0.0) ?: 0.0
        var dlg: AlertDialog? = null
        var gorj = if (Session.taxaServico(this) >= 15.0) 15 else 10
        var partes = 1
        var valorDig: Double? = null

        val valorTxt = TextView(this)
        valorTxt.textSize = 34f
        valorTxt.setTypeface(null, android.graphics.Typeface.BOLD)
        valorTxt.setTextColor(0xFF111827.toInt())
        val subTxt = TextView(this)
        subTxt.textSize = 13f
        subTxt.setTextColor(0xFF6B7280.toInt())

        fun rotulo(t: String): TextView {
            val v = TextView(this)
            v.text = t
            v.textSize = 13f
            v.setTypeface(null, android.graphics.Typeface.BOLD)
            v.setPadding(0, dp(10), 0, dp(2))
            return v
        }
        val gorjBtns = mutableListOf<Pair<Int, Button>>()
        val partesBtns = mutableListOf<Pair<Int, Button>>()
        fun chipRow(): LinearLayout {
            val row = LinearLayout(this)
            row.orientation = LinearLayout.HORIZONTAL
            return row
        }
        fun chip(row: LinearLayout, texto: String): Button {
            val b = Button(this)
            b.text = texto
            b.textSize = 14f
            b.isAllCaps = false
            val lp = LinearLayout.LayoutParams(0, dp(44))
            lp.weight = 1f
            lp.marginEnd = dp(4)
            b.layoutParams = lp
            row.addView(b)
            return b
        }

        fun calc(): Triple<Double, Double, Double> {
            val svc = Math.round(itens * gorj) / 100.0
            // canônico do Consumer: itens + serviço − desconto + acréscimo − pago
            val resta = Math.max(0.0, Math.round((itens + svc - desconto + acrescimo - pago) * 100) / 100.0)
            val cobrar = valorDig?.coerceAtMost(resta) ?: (Math.round(resta / partes * 100) / 100.0)
            return Triple(svc, resta, cobrar)
        }
        fun pinta() {
            val (svc, resta, cobrar) = calc()
            valorTxt.text = Cupom.brl(cobrar)
            subTxt.text = when {
                valorDig != null -> "valor digitado — o resto continua na conta"
                partes > 1 -> "1/$partes do que falta (${Cupom.brl(resta)})"
                else -> "consumo ${Cupom.brl(itens)} + serviço ${Cupom.brl(svc)}" +
                    (if (desconto > 0) " − desconto ${Cupom.brl(desconto)}" else "") +
                    (if (acrescimo > 0) " + acréscimo ${Cupom.brl(acrescimo)}" else "") +
                    (if (pago > 0) " − já pago ${Cupom.brl(pago)}" else "")
            }
            gorjBtns.forEach { (p, b) ->
                b.setBackgroundColor(if (p == gorj) 0xFF0C7091.toInt() else 0xFFE5E7EB.toInt())
                b.setTextColor(if (p == gorj) 0xFFFFFFFF.toInt() else 0xFF374151.toInt())
            }
            partesBtns.forEach { (k, b) ->
                val on = k == partes && valorDig == null
                b.setBackgroundColor(if (on) 0xFF0C7091.toInt() else 0xFFE5E7EB.toInt())
                b.setTextColor(if (on) 0xFFFFFFFF.toInt() else 0xFF374151.toInt())
            }
        }

        val gorjRow = chipRow()
        listOf(10, 15).forEach { p ->
            val b = chip(gorjRow, "$p%")
            b.setOnClickListener { gorj = p; valorDig = null; pinta() }
            gorjBtns.add(p to b)
        }
        val partesRow = chipRow()
        (1..6).forEach { k ->
            val b = chip(partesRow, "$k")
            b.setOnClickListener { partes = k; valorDig = null; pinta() }
            partesBtns.add(k to b)
        }

        // "Receber de": a mesa e cada comanda pendurada (igual ao celular) —
        // cada comanda é um PEDIDO próprio no Consumer, então é um pagamento
        // por conta: cobra a mesa, depois cada comanda, trocando de chip.
        val alvos = mutableListOf(numero)
        if (!ehComanda) alvos.addAll(infoAtual?.comandas ?: emptyList())
        val valoresComanda = mutableMapOf<Int, String>()
        resumoGeral?.optJSONArray("comandas")?.let { arr ->
            for (i in 0 until arr.length()) {
                val cc = arr.optJSONObject(i) ?: continue
                valoresComanda[cc.optInt("numero")] =
                    if (cc.optBoolean("quitada")) "paga" else Cupom.brl(cc.optDouble("resta", 0.0))
            }
        }
        val alvoRow = chipRow()
        if (alvos.size > 1) {
            // TUDO: mesa + comandas numa PASSADA só — um NSU, baixas rateadas
            // por conta (o conciliador central agrupa pelo NSU).
            val bTudo = chip(alvoRow, "💳 TUDO")
            bTudo.textSize = 12f
            bTudo.setBackgroundColor(0xFF15803D.toInt())
            bTudo.setTextColor(0xFFFFFFFF.toInt())
            bTudo.setOnClickListener { dlg?.dismiss(); abrirReceberTudo() }
            alvos.forEach { a ->
                val rot = (if (a == numero) "Mesa $a" else "C$a") + (valoresComanda[a]?.let { "\n$it" } ?: "")
                val b = chip(alvoRow, rot)
                b.textSize = 12f
                if (a == alvo) {
                    b.setBackgroundColor(0xFF0C7091.toInt())
                    b.setTextColor(0xFFFFFFFF.toInt())
                }
                b.setOnClickListener {
                    if (a != alvo) { dlg?.dismiss(); abrirReceber(a) }
                }
            }
        }
        // DINHEIRO EM CENTAVOS, padrão de maquininha: digita SÓ números e o
        // campo se formata sozinho (550 → R$ 5,50). O teclado numérico da LIO
        // não tem vírgula, e o parse antigo tratava ponto como milhar — "5.50"
        // virava 550 e cobrava a conta inteira (bug real em campo, 20/08).
        val digIn = campo("Ou digite o valor (só números — 550 = R$ 5,50)", android.text.InputType.TYPE_CLASS_NUMBER)
        digIn.addTextChangedListener(object : android.text.TextWatcher {
            private var editando = false
            override fun afterTextChanged(s: android.text.Editable?) {
                if (editando) return
                editando = true
                val dig = (s?.toString() ?: "").filter { it.isDigit() }.trimStart('0').take(9)
                val cents = dig.toLongOrNull() ?: 0L
                valorDig = if (cents > 0) cents / 100.0 else null
                val txt = if (cents > 0) Cupom.brl(cents / 100.0) else ""
                digIn.setText(txt)
                digIn.setSelection(txt.length)
                editando = false
                pinta()
            }
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, x: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, x: Int) {}
        })

        val box = LinearLayout(this)
        box.orientation = LinearLayout.VERTICAL
        box.setPadding(dp(20), dp(8), dp(20), 0)
        val views = mutableListOf<View>()
        if (alvos.size > 1) { views.add(rotulo("Receber de")); views.add(alvoRow) }
        views.addAll(listOf(
            valorTxt, subTxt,
            rotulo("Serviço"), gorjRow,
            rotulo("Dividir por"), partesRow,
            digIn,
        ))
        views.forEach {
            box.addView(it, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        pinta()

        val ehComandaAlvo = Session.ehComanda(this, alvo)
        val nomeAlvo = texto?.optStringOrNull("nome")
        dlg = AlertDialog.Builder(this)
            .setTitle("Receber — " + (if (ehComandaAlvo) "Comanda $alvo" else "Mesa $alvo") +
                (nomeAlvo?.let { " · $it" } ?: ""))
            .setView(box)
            .setPositiveButton("💳 Cobrar") { _, _ ->
                val (_, _, cobrar) = calc()
                if (cobrar <= 0.009) Toast.makeText(this, "Nada a cobrar", Toast.LENGTH_SHORT).show()
                else cobrarNoTerminal(alvo, linhasDoAlvo(texto, cAlvo), Math.round(cobrar * 100))
            }
            .setNegativeButton("Cancelar", null)
            .create()
        dlg?.show()
    }

    // ---- RECEBER TUDO: mesa + comandas numa passada só ----
    // Uma transação no terminal (um NSU) e o servidor recebe uma baixa POR
    // CONTA com esse NSU — cada pedido quita e fecha; o conciliador central
    // agrupa as parcelas pelo NSU pra casar com a venda única da Cielo.
    // Só integral (rachar continua no Receber de cada conta).

    private data class ParcelaTudo(val numero: Int, val consumo: Double, val pago: Double)

    private fun abrirReceberTudo() {
        val base = Session.servidor(this)
        Thread {
            val alvos = mutableListOf(numero)
            alvos.addAll(infoAtual?.comandas ?: emptyList())
            val parcelas = mutableListOf<ParcelaTudo>()
            for (a in alvos) {
                val c = try { if (a == numero) conta else Api.conta(base, a) } catch (_: Exception) { null } ?: continue
                val consumo = if (c.servico > 0) c.total - c.servico else c.total
                parcelas.add(ParcelaTudo(a, consumo, c.pago))
            }
            runOnUiThread {
                if (parcelas.size < 2) Toast.makeText(this, "Sem comandas com conta aberta pra somar", Toast.LENGTH_SHORT).show()
                else dialogReceberTudo(parcelas)
            }
        }.start()
    }

    private fun dialogReceberTudo(parcelas: List<ParcelaTudo>) {
        var gorj = if (Session.taxaServico(this) >= 15.0) 15 else 10

        fun restaDe(p: ParcelaTudo): Long {
            val svc = Math.round(p.consumo * gorj) / 100.0
            return Math.max(0L, Math.round((p.consumo + svc - p.pago) * 100))
        }

        val valorTxt = TextView(this)
        valorTxt.textSize = 34f
        valorTxt.setTypeface(null, android.graphics.Typeface.BOLD)
        valorTxt.setTextColor(0xFF111827.toInt())
        val subTxt = TextView(this)
        subTxt.textSize = 13f
        subTxt.setTextColor(0xFF6B7280.toInt())

        val gorjRow = LinearLayout(this)
        gorjRow.orientation = LinearLayout.HORIZONTAL
        val gorjBtns = mutableListOf<Pair<Int, Button>>()
        listOf(10, 15).forEach { pct ->
            val b = Button(this)
            b.text = "$pct%"
            b.textSize = 14f
            b.isAllCaps = false
            val lp = LinearLayout.LayoutParams(0, dp(44))
            lp.weight = 1f
            lp.marginEnd = dp(4)
            b.layoutParams = lp
            gorjRow.addView(b)
            gorjBtns.add(pct to b)
        }
        fun pinta() {
            val total = parcelas.sumOf { restaDe(it) }
            valorTxt.text = Cupom.brl(total / 100.0)
            subTxt.text = parcelas.joinToString("\n") { p ->
                (if (p.numero == numero) "Mesa ${p.numero}" else "Comanda ${p.numero}") +
                    ": ${Cupom.brl(restaDe(p) / 100.0)}"
            } + "\n(uma passada de cartão; cada conta quita e fecha)"
            gorjBtns.forEach { (pct, b) ->
                b.setBackgroundColor(if (pct == gorj) 0xFF0C7091.toInt() else 0xFFE5E7EB.toInt())
                b.setTextColor(if (pct == gorj) 0xFFFFFFFF.toInt() else 0xFF374151.toInt())
            }
        }
        gorjBtns.forEach { (pct, b) -> b.setOnClickListener { gorj = pct; pinta() } }
        pinta()

        val box = LinearLayout(this)
        box.orientation = LinearLayout.VERTICAL
        box.setPadding(dp(20), dp(8), dp(20), 0)
        listOf<View>(valorTxt, subTxt, gorjRow).forEach {
            box.addView(it, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }

        AlertDialog.Builder(this)
            .setTitle("💳 Receber TUDO — mesa + comandas")
            .setView(box)
            .setPositiveButton("💳 Cobrar") { _, _ ->
                val vivas = parcelas.map { it to restaDe(it) }.filter { it.second > 0 }
                val total = vivas.sumOf { it.second }
                if (total <= 0) { Toast.makeText(this, "Nada a cobrar", Toast.LENGTH_SHORT).show(); return@setPositiveButton }
                cobrando = true
                atualizarBotoes()
                val linhas = vivas.map { (p, cents) ->
                    Lio.Linha(if (p.numero == numero) "Mesa ${p.numero}" else "Comanda ${p.numero}", cents)
                }
                Pagamento.cobrar(
                    ref = "MESA-$numero-TUDO",
                    linhas = linhas,
                    valorCentavos = total,
                    onInicio = { },
                    onPago = { _, pagamentos -> registrarRateio(vivas.map { it.first.numero to it.second }, pagamentos) },
                    onCancelado = {
                        runOnUiThread {
                            cobrando = false
                            atualizarBotoes()
                            Toast.makeText(this, "Pagamento cancelado", Toast.LENGTH_SHORT).show()
                        }
                    },
                    onErro = { m ->
                        runOnUiThread {
                            cobrando = false
                            atualizarBotoes()
                            Toast.makeText(this, m, Toast.LENGTH_LONG).show()
                        }
                    },
                )
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    /** Uma baixa POR CONTA, todas com o NSU da passada única. Cada parcela
     *  entra na fila de pendentes antes e só sai confirmada — igual ao fluxo
     *  normal. NFC-e: por pedido, depois, pelo caixa (rateio não emite). */
    private fun registrarRateio(parcelas: List<Pair<Int, Long>>, pagamentos: List<Lio.PagamentoLio>) {
        val p = pagamentos.firstOrNull()
        if (p == null) {
            runOnUiThread { cobrando = false; atualizarBotoes() }
            return
        }
        val tk = Session.token(this)
        val base = Session.servidor(this)
        Thread {
            var ok = 0
            var falha = 0
            var ultimoErro: String? = null
            for ((alvoP, cents) in parcelas) {
                val body = org.json.JSONObject()
                    .put("numero", alvoP)
                    .put("forma", p.forma)
                    .put("valor", cents / 100.0)
                    .put("nsu", p.nsu)
                    .put("autorizacao", p.autorizacao)
                    .put("bandeira", p.bandeira)
                    .put("descricao", p.descricao)
                val id = Pendentes.adicionar(this, body)
                var okEste = false
                for (t in 1..3) {
                    try {
                        if (tk == null) throw Api.SemSessao()
                        val r = Api.lioPagar(base, tk, body)
                        if (r.ok || r.jaRegistrado) { okEste = true; Pendentes.remover(this, id) }
                        else ultimoErro = r.erro
                        break
                    } catch (e: Api.SemSessao) {
                        ultimoErro = e.message
                        break
                    } catch (e: Exception) {
                        ultimoErro = e.message
                        try { Thread.sleep(2000L * t) } catch (_: InterruptedException) { }
                    }
                }
                if (okEste) ok++ else falha++
            }
            runOnUiThread {
                cobrando = false
                carregar()
                val total = parcelas.sumOf { it.second }
                val msg = StringBuilder(
                    "Recebido ${Cupom.brl(total / 100.0)} em UMA passada\n" +
                        "${p.forma.uppercase()} ${p.bandeira}" +
                        (if (p.nsu.isNotBlank()) " · NSU ${p.nsu}" else "") +
                        "\n\nBaixas: $ok de ${parcelas.size} contas" +
                        (if (falha == 0) " — todas quitadas e fechadas ✓" else ""),
                )
                if (falha > 0) msg.append(
                    "\n⚠ $falha parcela(s) na fila" + (ultimoErro?.let { " ($it)" } ?: "") +
                        " — reenvie na tela de mesas.",
                )
                msg.append("\n\nNota fiscal: emita por conta pelo caixa, se pedirem.")
                AlertDialog.Builder(this)
                    .setTitle(if (falha == 0) "✅ Tudo pago!" else "⚠️ Pago — baixas pendentes")
                    .setMessage(msg.toString())
                    .setPositiveButton("🖨 Comprovante") { _, _ ->
                        Pagamento.imprimirBlocos(this, listOf(
                            Lio.Bloco("\n${Session.loja(this)}\nPAGAMENTO ÚNICO", negrito = true, tamanho = 22),
                            Lio.Bloco("MESA $numero + COMANDAS", negrito = true, tamanho = 24),
                            Lio.Bloco(parcelas.joinToString("\n") { (n, c) ->
                                (if (n == numero) "Mesa $n" else "Comanda $n") + "  " + Cupom.brl(c / 100.0)
                            } + "\nTOTAL ${Cupom.brl(total / 100.0)}" +
                                "\n${p.forma.uppercase()} ${p.bandeira}" +
                                (if (p.nsu.isNotBlank()) "\nNSU ${p.nsu} AUT ${p.autorizacao}" else ""), tamanho = 20),
                            Lio.Bloco("Emitido ${Cupom.agoraBr()}\n\n\n\n\n\n", tamanho = 16),
                        ), onOk = { runOnUiThread { if (falha == 0) finish() } },
                            onErro = { m -> runOnUiThread { Toast.makeText(this, m, Toast.LENGTH_LONG).show() } })
                    }
                    .setNeutralButton("📱 Zap") { _, _ ->
                        dialogZapComprovante(numero, total, pagamentos, quitada = false, fecharAoSair = falha == 0)
                    }
                    .setNegativeButton("OK") { _, _ -> if (falha == 0) finish() }
                    .setCancelable(false)
                    .show()
            }
        }.start()
    }

    /** Itens reais da conta do alvo pro pedido da LIO (o certificador confere). */
    private fun linhasDoAlvo(texto: org.json.JSONObject?, cAlvo: Api.Conta?): List<Lio.Linha> {
        val arr = texto?.optJSONArray("itens")
        if (arr != null && arr.length() > 0) {
            val out = mutableListOf<Lio.Linha>()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                if (o.optInt("tipo", 1) == 2) continue
                val q = o.optDouble("quantidade", 1.0)
                val qTxt = if (q == Math.floor(q)) q.toInt().toString() else q.toString()
                out.add(Lio.Linha("${qTxt}x " + o.optString("nome"), Math.round(o.optDouble("valor_total", 0.0) * 100)))
            }
            if (out.isNotEmpty()) return out
        }
        return (cAlvo?.itens ?: emptyList()).filter { it.tipo != 2 }.map {
            val q = if (it.qtd == Math.floor(it.qtd)) it.qtd.toInt().toString() else it.qtd.toString()
            Lio.Linha("${q}x ${it.nome}", Math.round(it.valor * 100))
        }
    }

    private fun cobrarNoTerminal(alvo: Int, linhas: List<Lio.Linha>, valorCentavos: Long) {
        cobrando = true
        atualizarBotoes()

        val ref = (if (Session.ehComanda(this, alvo)) "COMANDA-" else "MESA-") + alvo
        Pagamento.cobrar(
            ref = ref,
            linhas = linhas,
            valorCentavos = valorCentavos,
            onInicio = { /* a UI de pagamento da Cielo assume a tela */ },
            onPago = { _, pagamentos -> registrarPagamentos(alvo, pagamentos) },
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
    private fun registrarPagamentos(alvo: Int, pagamentos: List<Lio.PagamentoLio>) {
        val tk = Session.token(this)
        val base = Session.servidor(this)
        Thread {
            var quitada = false
            var registrouTudo = true
            var ultimoErro: String? = null
            for (p in pagamentos) {
                val body = Api.bodyPagamento(alvo, p)
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
                // Quitou (e o servidor já fechou a conta): pergunta a NFC-e
                // ANTES do resultado — o cliente ainda está na frente do garçom
                // pra responder e ditar o CPF. Recibo/passe vêm em seguida.
                if (registrouTudo && quitada) {
                    nfcePerguntar(alvo) {
                        mostrarResultado(alvo, totalPago, pagamentos, registrouTudo, quitada, ultimoErro)
                    }
                } else {
                    mostrarResultado(alvo, totalPago, pagamentos, registrouTudo, quitada, ultimoErro)
                }
            }
        }.start()
    }

    private fun mostrarResultado(
        alvo: Int,
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
        val msg = StringBuilder("Recebido ${Cupom.brl(totalCentavos / 100.0)}" +
            (if (alvo != numero) " (${if (Session.ehComanda(this, alvo)) "comanda" else "mesa"} $alvo)" else "") +
            "\n$detalhe")
        if (quitada) msg.append("\n\n🎉 Conta quitada!")
        if (!registrou) msg.append(
            "\n\n⚠️ O pagamento foi APROVADO na maquininha mas ainda não foi registrado no sistema" +
                (erro?.let { " ($it)" } ?: "") +
                ". Ele ficou na fila — reenvie na tela de mesas assim que a rede voltar."
        )
        // Conta DA TELA quitada = o pedido já foi fechado pelo servidor; depois
        // do resultado (e do recibo/passe, se pedirem) a tela volta SOZINHA
        // pras mesas — ficar numa mesa morta parecia travado ("aguardando
        // pagamento" de conta que já fechou).
        val fecharAoSair = quitada && alvo == numero
        val b = AlertDialog.Builder(this)
            .setTitle(if (registrou) "✅ Pago!" else "⚠️ Pago — registro pendente")
            .setMessage(msg.toString())
            .setPositiveButton("🖨 Recibo") { _, _ -> imprimirRecibo(alvo, pagamentos, fecharAoSair) }
            .setNegativeButton("OK") { _, _ -> if (fecharAoSair) finish() }
            .setCancelable(false)
            // Comprovante no zap do cliente (com país — turista também paga).
            // Quitada: ao sair do zap, o passe de saída é oferecido na sequência.
            .setNeutralButton("📱 Zap") { _, _ ->
                dialogZapComprovante(alvo, totalCentavos, pagamentos, quitada, fecharAoSair)
            }
        b.show()
        // Quitada continua com o passe a um toque: ⋯ da mesa ou após o Zap.
    }

    /** Envia o comprovante do cartão pro WhatsApp do cliente — número com a
     *  bandeirinha do país (wa.me exige DDI). Sem número: abre o WhatsApp pra
     *  escolher o contato. Na maquininha sem WhatsApp instalado, o aparelho
     *  avisa — aí o caminho é o recibo impresso. */
    private fun dialogZapComprovante(
        alvo: Int,
        totalCentavos: Long,
        pagamentos: List<Lio.PagamentoLio>,
        quitada: Boolean,
        fecharAoSair: Boolean,
    ) {
        val p = pagamentos.firstOrNull()
        val texto = buildString {
            append("*${Session.loja(this@ContaActivity)}*\n")
            append("Comprovante — ${if (Session.ehComanda(this@ContaActivity, alvo)) "Comanda" else "Mesa"} $alvo\n")
            append(Cupom.brl(totalCentavos / 100.0))
            if (p != null) {
                append(" · ${p.forma.uppercase()} ${p.bandeira}")
                if (p.mask.isNotBlank()) append(" **** ${p.mask.takeLast(4)}")
                if (p.nsu.isNotBlank()) append("\nNSU ${p.nsu} · AUT ${p.autorizacao}")
            }
            append("\n${Cupom.agoraBr()}")
        }
        val zap = campoZap()
        val depois = {
            if (quitada) dialogPasse(alvo, fecharAoSair) else if (fecharAoSair) finish()
        }
        AlertDialog.Builder(this)
            .setTitle("📱 Comprovante por WhatsApp")
            .setMessage("Número do cliente (troque o país na bandeirinha) — ou envie sem número e escolha o contato.")
            .setView(caixa(zap.view))
            .setPositiveButton("Enviar") { _, _ ->
                val num = zap.valorComDdi()
                val uri = if (num != null) "https://wa.me/$num?text=${android.net.Uri.encode(texto)}"
                else "https://wa.me/?text=${android.net.Uri.encode(texto)}"
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(uri)))
                } catch (_: Exception) {
                    Toast.makeText(this, "WhatsApp indisponível neste aparelho — use o recibo impresso", Toast.LENGTH_LONG).show()
                }
                depois()
            }
            .setNegativeButton("Voltar") { _, _ -> depois() }
            .setCancelable(false)
            .show()
    }

    // ---- passe de saída: QR da catraca (N passagens) + placas pra cancela ----
    /** PRIMEIRO confere a quitação (o servidor barra passe de conta em aberto)
     *  — só abre o formulário quando o passe realmente pode sair. */
    private fun dialogPasse(alvo: Int, fecharDepois: Boolean = false) {
        val espera = AlertDialog.Builder(this).setMessage("🚗 Conferindo a conta…").setCancelable(false).create()
        espera.show()
        Thread {
            val texto = try { Api.contaTexto(Session.servidor(this), alvo, Session.token(this)) } catch (_: Exception) { null }
            runOnUiThread {
                espera.dismiss()
                val falta = texto?.optDouble("falta_geral", texto.optDouble("resta", 0.0)) ?: 0.0
                if (texto != null && falta > 0.009) {
                    AlertDialog.Builder(this)
                        .setTitle("🚗 Passe de saída")
                        .setMessage("A conta ainda tem ${Cupom.brl(falta)} em aberto.\n\n" +
                            "O passe só sai com a conta ZERADA — é ele que libera as pessoas na " +
                            "catraca e os carros na cancela. Receba primeiro e peça de novo.")
                        .setPositiveButton("OK") { _, _ -> if (fecharDepois) finish() }
                        .show()
                } else {
                    formularioPasse(alvo, texto?.optInt("pessoas", 0) ?: 0, fecharDepois)
                }
            }
        }.start()
    }

    private fun formularioPasse(alvo: Int, pessoasConta: Int, fecharDepois: Boolean) {
        val explica = TextView(this)
        explica.textSize = 13f
        explica.setTextColor(0xFF374151.toInt())
        explica.text = "O QR libera as PESSOAS na catraca (uma passagem por pessoa). " +
            "As placas liberam os CARROS na cancela automática, pela leitura da placa."
        val adultosIn = campo("Adultos saindo", android.text.InputType.TYPE_CLASS_NUMBER)
        adultosIn.setText("${if (pessoasConta > 0) pessoasConta else 2}")
        val criancasIn = campo("Crianças", android.text.InputType.TYPE_CLASS_NUMBER)
        criancasIn.setText("0")
        val placasIn = campo("Placas dos carros — ex.: ABC1D23 (vazio = sem carro)")
        placasIn.inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
        val viasIn = campo("Vias impressas do MESMO QR (1 por grupo)", android.text.InputType.TYPE_CLASS_NUMBER)
        viasIn.setText("1")
        AlertDialog.Builder(this)
            .setTitle("🚗 Passe — " + (if (Session.ehComanda(this, alvo)) "comanda" else "mesa") + " $alvo · conta zerada ✓")
            .setView(caixa(explica, adultosIn, criancasIn, placasIn, viasIn))
            .setPositiveButton("Gerar e imprimir") { _, _ ->
                val adultos = adultosIn.text.toString().trim().toIntOrNull() ?: 0
                val criancas = criancasIn.text.toString().trim().toIntOrNull() ?: 0
                val placas = placasIn.text.toString().split(Regex("[,;\\s]+")).map { it.trim() }.filter { it.isNotBlank() }
                val vias = (viasIn.text.toString().trim().toIntOrNull() ?: 1).coerceIn(1, 6)
                Thread {
                    try {
                        val r = Api.saidaGerar(Session.servidor(this), alvo, adultos, criancas, placas)
                        runOnUiThread {
                            if (!r.optBoolean("ok")) {
                                AlertDialog.Builder(this)
                                    .setMessage(r.optStringOrNull("erro") ?: "Não deu pra gerar o passe")
                                    .setPositiveButton("OK") { _, _ -> if (fecharDepois) finish() }
                                    .show()
                            } else {
                                imprimirPasses(alvo, r, vias, fecharDepois)
                            }
                        }
                    } catch (e: Exception) {
                        runOnUiThread { Toast.makeText(this, e.message, Toast.LENGTH_LONG).show() }
                    }
                }.start()
            }
            .setNegativeButton("Cancelar") { _, _ -> if (fecharDepois) finish() }
            .show()
    }

    /** Sem impressora (celular / térmica falhou): o passe vai pro WhatsApp —
     *  a página /passe?t= vira o QR da catraca na tela do cliente. */
    private fun fallbackPasse(token: String, pessoas: Int, fecharDepois: Boolean) {
        val url = Session.servidor(this) + "/passe?t=" + token
        AlertDialog.Builder(this)
            .setTitle("Passe gerado — sem impressora aqui")
            .setMessage("Vale $pessoas pessoa(s). Mande o link pro WhatsApp do cliente: " +
                "a tela do celular dele vira o QR da catraca.\n\n$url")
            .setPositiveButton("📱 WhatsApp") { _, _ ->
                val msg = "Passe de saída — ${Session.loja(this)}: $url"
                try {
                    startActivity(Intent(Intent.ACTION_VIEW,
                        android.net.Uri.parse("https://wa.me/?text=${android.net.Uri.encode(msg)}")))
                } catch (_: Exception) {
                    Toast.makeText(this, "WhatsApp indisponível neste aparelho", Toast.LENGTH_LONG).show()
                }
                if (fecharDepois) finish()
            }
            .setNegativeButton("OK") { _, _ -> if (fecharDepois) finish() }
            .show()
    }

    /** Imprime `vias` cópias do MESMO passe — cada escaneada na catraca
     *  consome 1 das N passagens; os carros saem pela placa na cancela.
     *  Fora da maquininha, cai direto pro link de WhatsApp. */
    private fun imprimirPasses(alvo: Int, r: org.json.JSONObject, vias: Int, fecharDepois: Boolean = false) {
        val token = r.optString("token")
        val pessoas = r.optInt("pessoas", 1)
        val validade = r.optInt("validade_min", 90)
        val placasArr = r.optJSONArray("placas")
        val placas = (0 until (placasArr?.length() ?: 0)).mapNotNull { placasArr?.optString(it) }
        if (!Pagamento.pronto) {
            fallbackPasse(token, pessoas, fecharDepois)
            return
        }
        fun via(i: Int) {
            if (i > vias) {
                Toast.makeText(this, "✓ Passe impresso ($vias via/s)", Toast.LENGTH_LONG).show()
                if (fecharDepois) finish()
                return
            }
            val blocos = mutableListOf(
                Lio.Bloco("\n${Session.loja(this)}\nPASSE DE SAÍDA", negrito = true, tamanho = 22),
                Lio.Bloco((if (Session.ehComanda(this, alvo)) "COMANDA" else "MESA") + " $alvo", negrito = true, tamanho = 26),
                Lio.Bloco("Vale $pessoas pessoa(s) · $validade min" +
                    (if (placas.isNotEmpty()) "\nCarros: ${placas.joinToString(" ")}" else ""), tamanho = 18),
                Lio.Bloco(qr = token),
                Lio.Bloco("Apresente o QR na catraca" +
                    (if (placas.isNotEmpty()) "\nCancela libera pela placa" else "") +
                    (if (vias > 1) "\nvia $i/$vias" else "") + "\n\n\n\n\n\n", tamanho = 16),
            )
            Pagamento.imprimirBlocos(this, blocos,
                onOk = { runOnUiThread { via(i + 1) } },
                onErro = { m ->
                    runOnUiThread {
                        Toast.makeText(this, m, Toast.LENGTH_LONG).show()
                        // Térmica falhou no meio: o cliente ainda leva o passe.
                        fallbackPasse(token, pessoas, fecharDepois)
                    }
                })
        }
        via(1)
    }

    private fun imprimirRecibo(alvo: Int, pagamentos: List<Lio.PagamentoLio>, fecharDepois: Boolean = false) {
        val ehComandaAlvo = Session.ehComanda(this, alvo)
        Thread {
            val extras = mutableListOf<String>()
            pagamentos.forEach { p ->
                extras.add("${p.forma.uppercase()} ${p.bandeira} ${Cupom.brl(p.valorCentavos / 100.0)}".trim())
                if (p.nsu.isNotBlank()) extras.add("NSU ${p.nsu} AUT ${p.autorizacao}")
            }
            val blocos = try {
                Cupom.montarBlocos(
                    Api.contaTexto(Session.servidor(this), alvo, Session.token(this)), ehComandaAlvo,
                    Session.loja(this), "RECIBO", null, extras,
                )
            } catch (_: Exception) {
                // Conta já fechada/indisponível: recibo mínimo, só do pagamento.
                listOf(
                    Lio.Bloco("\n${Session.loja(this)}\nRECIBO", negrito = true, tamanho = 22),
                    Lio.Bloco((if (ehComandaAlvo) "COMANDA" else "MESA") + " $alvo", negrito = true, tamanho = 26),
                    Lio.Bloco(extras.joinToString("\n"), negrito = true, tamanho = 20),
                    Lio.Bloco("Emitido ${Cupom.agoraBr()}\n\n\n\n\n\n", tamanho = 16),
                )
            }
            runOnUiThread {
                Pagamento.imprimirBlocos(
                    this, blocos,
                    onOk = { runOnUiThread {
                        Toast.makeText(this, "Recibo impresso!", Toast.LENGTH_SHORT).show()
                        if (fecharDepois) finish()
                    } },
                    onErro = { m -> runOnUiThread {
                        Toast.makeText(this, m, Toast.LENGTH_LONG).show()
                        if (fecharDepois) finish()
                    } }
                )
            }
        }.start()
    }

    // ---- NFC-e: pergunta ao fechar a conta (caixa manda; a lei também) ----
    // O fechamento JÁ aconteceu quando a pergunta aparece — "Sem nota", erro ou
    // SEFAZ fora do ar nunca desfazem nada; dá pra emitir depois pelo caixa.

    /** Dígito verificador de CPF (11) e CNPJ (14) — validação local, sem rede. */
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

    /** Consulta se a NFC-e está ligada e mostra a pergunta. `depois` roda SEMPRE
     *  ao final do fluxo (emitiu, recusou ou nem perguntou). */
    private fun nfcePerguntar(alvo: Int, depois: () -> Unit) {
        val tk = Session.token(this) ?: return depois()
        Thread {
            val info = Api.nfceInfo(Session.servidor(this), tk, alvo)
            runOnUiThread {
                if (info == null || isFinishing) { depois(); return@runOnUiThread }
                nfceDialog(alvo, info, info.documentoSugerido, depois)
            }
        }.start()
    }

    private fun nfceDialog(alvo: Int, info: Api.NfceInfo, docInicial: String?, depois: () -> Unit) {
        if (info.emitida) {
            AlertDialog.Builder(this)
                .setTitle("🧾 Nota já emitida")
                .setMessage("A NFC-e nº ${info.notaNumero ?: "?"} deste pedido já foi autorizada.")
                .setPositiveButton("🖨 Reimprimir DANFE") { _, _ -> nfceEmitirNota(alvo, null, depois) }
                .setNegativeButton("OK") { _, _ -> depois() }
                .setOnCancelListener { depois() }
                .show()
            return
        }
        val docIn = campo("CPF/CNPJ (vazio = sem CPF)", android.text.InputType.TYPE_CLASS_NUMBER)
        if (!docInicial.isNullOrBlank()) docIn.setText(docInicial)
        val msg = StringBuilder("Cliente quer nota? Informe o CPF/CNPJ ou deixe vazio.")
        if (!info.documentoSugerido.isNullOrBlank()) msg.append("\nCPF do cadastro já preenchido — confirme ou apague.")
        if (info.homologacao) msg.append("\n(ambiente de HOMOLOGAÇÃO — sem valor fiscal)")
        AlertDialog.Builder(this)
            .setTitle("🧾 Emitir nota fiscal (NFC-e)?")
            .setMessage(msg.toString())
            .setView(caixa(docIn))
            .setPositiveButton("✓ Emitir nota") { _, _ ->
                val doc = docIn.text.toString().filter { it.isDigit() }
                if (doc.isNotEmpty() && !nfceDocValido(doc)) {
                    Toast.makeText(this, "CPF/CNPJ inválido — confira os dígitos", Toast.LENGTH_LONG).show()
                    nfceDialog(alvo, info, doc, depois) // reabre com o que foi digitado
                    return@setPositiveButton
                }
                nfceEmitirNota(alvo, doc.ifEmpty { null }, depois)
            }
            .setNegativeButton("Sem nota") { _, _ -> depois() }
            .setOnCancelListener { depois() }
            .show()
    }

    private fun nfceEmitirNota(alvo: Int, documento: String?, depois: () -> Unit) {
        val tk = Session.token(this) ?: return depois()
        val espera = AlertDialog.Builder(this)
            .setMessage("🧾 Emitindo NFC-e — falando com a SEFAZ…")
            .setCancelable(false)
            .create()
        espera.show()
        Thread {
            try {
                val r = Api.nfceEmitir(Session.servidor(this), tk, alvo, documento)
                runOnUiThread {
                    espera.dismiss()
                    if (!r.ok && r.pendente) {
                        // SEFAZ fora do ar: ficou na fila da loja — segue o baile
                        AlertDialog.Builder(this)
                            .setTitle("🕐 Nota na fila")
                            .setMessage("SEFAZ/central sem resposta agora. A nota ficou na fila da loja " +
                                "e será emitida sozinha (o DANFE sai na impressora do caixa). " +
                                "A mesa já está liberada — pode seguir.")
                            .setPositiveButton("OK") { _, _ -> depois() }
                            .setOnCancelListener { depois() }
                            .show()
                        return@runOnUiThread
                    }
                    if (!r.ok) {
                        AlertDialog.Builder(this)
                            .setTitle("✗ Nota não saiu")
                            .setMessage((r.erro ?: "falhou") +
                                "\n\nA conta segue fechada e a mesa liberada. Dá pra emitir depois: no caixa, " +
                                "digite o número da mesa e use \"NFC-e do último pedido fechado\".")
                            .setPositiveButton("OK") { _, _ -> depois() }
                            .setOnCancelListener { depois() }
                            .show()
                        return@runOnUiThread
                    }
                    if (r.blocos.isEmpty()) {
                        Toast.makeText(this, "✓ NFC-e nº ${r.notaNumero ?: ""} autorizada", Toast.LENGTH_LONG).show()
                        depois(); return@runOnUiThread
                    }
                    Pagamento.imprimirBlocos(this, r.blocos,
                        onOk = { runOnUiThread {
                            Toast.makeText(this, "✓ NFC-e nº ${r.notaNumero ?: ""} impressa", Toast.LENGTH_LONG).show()
                            depois()
                        } },
                        onErro = { m -> runOnUiThread {
                            Toast.makeText(this, "NFC-e autorizada; impressão falhou: $m", Toast.LENGTH_LONG).show()
                            depois()
                        } })
                }
            } catch (e: Api.SemSessao) {
                runOnUiThread { espera.dismiss(); logout() }
            } catch (e: Exception) {
                runOnUiThread {
                    espera.dismiss()
                    AlertDialog.Builder(this)
                        .setMessage("Erro: ${e.message}\nTente de novo — o sistema confere antes de reenviar, não duplica a nota.")
                        .setPositiveButton("OK") { _, _ -> depois() }
                        .setOnCancelListener { depois() }
                        .show()
                }
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
            // Views recicladas: sempre resetar estilo antes de aplicar o da linha.
            val preto = 0xFF111827.toInt()
            val vermelho = 0xFFDC2626.toInt()
            nomeTxt.setTypeface(null, android.graphics.Typeface.NORMAL)
            valorTxt.setTypeface(null, android.graphics.Typeface.BOLD)
            nomeTxt.textSize = 14f
            valorTxt.textSize = 14f
            nomeTxt.setTextColor(preto)
            valorTxt.setTextColor(preto)
            when (val l = linhas[position]) {
                is Api.ItemConta -> {
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
                    val hora = Cupom.horaBr(l.criadoEm)
                    nomeTxt.text = "Pago" + (if (hora.isNotBlank()) " $hora" else "") + " · ${l.forma}"
                    nomeTxt.setTextColor(vermelho)
                    valorTxt.text = "− ${Cupom.brl(l.valor)}"
                    valorTxt.setTextColor(vermelho)
                }
                is Resumo -> {
                    nomeTxt.text = l.rotulo
                    valorTxt.text = l.valor
                    if (l.vermelho) {
                        nomeTxt.setTextColor(vermelho)
                        valorTxt.setTextColor(vermelho)
                    }
                    if (l.destaque) {
                        nomeTxt.setTypeface(null, android.graphics.Typeface.BOLD)
                        nomeTxt.textSize = 17f
                        valorTxt.textSize = 17f
                    }
                }
            }
            return v
        }
    }
}
