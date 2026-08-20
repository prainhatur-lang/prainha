package com.concilia.garcom

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.GridView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

// Grade de mesas/comandas abertas (GET /api/venda/abertas — espelho local,
// atualiza a cada 15 s). Verde = andamento, âmbar = atrasada, vermelho =
// fechando (conta pedida). Tocar abre a conta; o campo de número abre
// qualquer mesa (inclusive vazia — o primeiro lançamento cria a conta).
// Aqui também mora o reenvio das baixas pendentes (pagamento aprovado na
// maquininha que ainda não conseguiu ser registrado no servidor).
class MesasActivity : AppCompatActivity() {

    private lateinit var lista: GridView
    private lateinit var vazio: TextView
    private lateinit var pendentesBanner: TextView
    private lateinit var numeroIn: EditText

    private var abertas: List<Api.Aberta> = emptyList()
    private val adapter = MesaAdapter()
    private val handler = Handler(Looper.getMainLooper())
    private val refreshRunnable = object : Runnable {
        override fun run() {
            carregar(silencioso = true)
            handler.postDelayed(this, 15000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_mesas)

        lista = findViewById(R.id.lista)
        vazio = findViewById(R.id.listaVazia)
        pendentesBanner = findViewById(R.id.pendentes)
        numeroIn = findViewById(R.id.numero)

        findViewById<TextView>(R.id.lojaNome).text = Session.loja(this)
        findViewById<TextView>(R.id.garcomNome).text =
            (Session.nome(this) ?: Session.login(this) ?: "") + " · v" + BuildConfig.VERSION_NAME
        findViewById<Button>(R.id.sair).setOnClickListener { logout() }
        findViewById<Button>(R.id.fechamentoDia).setOnClickListener { dialogFechamento() }
        findViewById<Button>(R.id.abrir).setOnClickListener { abrirDigitada() }
        pendentesBanner.setOnClickListener { dialogPendentes() }

        lista.adapter = adapter
        lista.setOnItemClickListener { _, _, pos, _ -> abrirConta(adapter.itens[pos].numero) }
    }

    override fun onResume() {
        super.onResume()
        carregar()
        handler.postDelayed(refreshRunnable, 15000)
        atualizarPendentes()
        if (Pendentes.quantidade(this) > 0) reenviarPendentes(silencioso = true)
    }

    override fun onPause() {
        handler.removeCallbacks(refreshRunnable)
        super.onPause()
    }

    private fun abrirDigitada() {
        val n = numeroIn.text.toString().trim().toIntOrNull()
        val max = Session.numeroMax(this)
        if (n == null || n < 1 || n > max) {
            Toast.makeText(this, "Número válido: 1 a $max", Toast.LENGTH_SHORT).show()
            return
        }
        numeroIn.text.clear()
        abrirConta(n)
    }

    private fun abrirConta(numero: Int) {
        val i = Intent(this, ContaActivity::class.java)
        i.putExtra("numero", numero)
        startActivity(i)
    }

    private fun carregar(silencioso: Boolean = false) {
        if (!silencioso && abertas.isEmpty()) { vazio.text = "Carregando mesas…"; vazio.visibility = View.VISIBLE }
        Thread {
            try {
                val (mesas, comandas) = Api.abertas(Session.servidor(this))
                runOnUiThread {
                    abertas = mesas + comandas
                    adapter.itens = abertas
                    adapter.notifyDataSetChanged()
                    vazio.visibility = if (abertas.isEmpty()) View.VISIBLE else View.GONE
                    if (abertas.isEmpty()) vazio.text = "Nenhuma mesa aberta — digite o número pra começar"
                }
            } catch (e: Exception) {
                runOnUiThread {
                    if (abertas.isEmpty()) {
                        vazio.visibility = View.VISIBLE
                        vazio.text = Api.msgErroRede(e, Session.servidor(this@MesasActivity))
                    }
                }
            }
        }.start()
    }

    // ---- baixas pendentes (dinheiro já capturado, registro falhou) ----

    private fun atualizarPendentes() {
        val n = Pendentes.quantidade(this)
        pendentesBanner.visibility = if (n > 0) View.VISIBLE else View.GONE
        if (n > 0) pendentesBanner.text = "⚠ $n pagamento(s) da maquininha sem registro — toque pra resolver"
    }

    /** Toque no aviso: lista os pendentes e oferece reenviar OU descartar
     *  (descartar = pedido foi cancelado, ex.: teste — não registra nunca). */
    private fun dialogPendentes() {
        val itens = Pendentes.listar(this)
        if (itens.isEmpty()) { atualizarPendentes(); return }
        val resumo = itens.joinToString("\n") { p ->
            val n = p.optInt("numero")
            "• ${if (Session.ehComanda(this, n)) "Comanda" else "Mesa"} $n — " +
                Cupom.brl(p.optDouble("valor", 0.0)) + " (${p.optString("forma")})" +
                (p.optString("nsu").takeIf { it.isNotBlank() }?.let { " · NSU $it" } ?: "")
        }
        AlertDialog.Builder(this)
            .setTitle("${itens.size} pagamento(s) sem registro")
            .setMessage(resumo + "\n\nREENVIAR tenta registrar de novo.\nDESCARTAR apaga da fila sem registrar — só pra pedido cancelado (testes).")
            .setPositiveButton("Reenviar") { _, _ -> reenviarPendentes() }
            .setNegativeButton("Descartar todos") { _, _ ->
                AlertDialog.Builder(this)
                    .setMessage("Descartar ${itens.size} pagamento(s)? Eles NÃO serão registrados no sistema.")
                    .setPositiveButton("Descartar") { _, _ ->
                        Pendentes.limpar(this)
                        atualizarPendentes()
                        Toast.makeText(this, "Fila limpa", Toast.LENGTH_SHORT).show()
                    }
                    .setNegativeButton("Voltar", null)
                    .show()
            }
            .setNeutralButton("Fechar", null)
            .show()
    }

    private fun reenviarPendentes(silencioso: Boolean = false) {
        val tk = Session.token(this) ?: return
        val base = Session.servidor(this)
        Thread {
            var ok = 0
            var falha = 0
            for (p in Pendentes.listar(this)) {
                try {
                    val r = Api.lioPagar(base, tk, p)
                    if (r.ok || r.jaRegistrado) { Pendentes.remover(this, p.optString("_id")); ok++ }
                    else falha++
                } catch (e: Api.SemSessao) {
                    runOnUiThread { logout() }
                    return@Thread
                } catch (_: Exception) { falha++ }
            }
            runOnUiThread {
                atualizarPendentes()
                if (!silencioso || ok > 0) {
                    val msg = if (falha == 0) "✅ $ok pagamento(s) registrado(s)"
                    else "$ok registrado(s), $falha ainda pendente(s) — tente de novo com rede"
                    if (ok + falha > 0) Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }

    // ---- Fechamento do dia: SISTEMA × TERMINAL, NSU a NSU ----
    // A promessa do caixa-só-maquininha: se os dois lados batem, não há o que
    // conferir na mão. O lado do terminal vem do catálogo do SDK; se a
    // plataforma não suportar a listagem, a tela mostra só o lado do sistema
    // (que já serve pra bater contra o Resumo de Vendas da própria Cielo).
    private fun dialogFechamento() {
        val tk = Session.token(this) ?: return logout()
        val espera = AlertDialog.Builder(this).setMessage("🧾 Conferindo o dia…").setCancelable(false).create()
        espera.show()
        val prosseguir = {
            Thread {
                val resumo = try {
                    Api.lioResumoDia(Session.servidor(this), tk)
                } catch (e: Api.SemSessao) {
                    runOnUiThread { espera.dismiss(); logout() }
                    null
                } catch (e: Exception) { null }
                if (resumo != null) {
                    val term = Lio.vendasDoTerminal()
                    runOnUiThread { espera.dismiss(); mostrarFechamento(resumo, term) }
                } else if (Session.token(this) != null) {
                    runOnUiThread {
                        espera.dismiss()
                        Toast.makeText(this, "Servidor não respondeu o resumo do dia (atualize o vendas-local?)", Toast.LENGTH_LONG).show()
                    }
                }
            }.start()
        }
        // O lado do terminal exige o serviço de pagamento conectado.
        if (Lio.configured() && !Lio.pronto) Lio.bind(this, onReady = { prosseguir() }, onError = { prosseguir() })
        else prosseguir()
    }

    private fun mostrarFechamento(resumo: org.json.JSONObject, term: List<Lio.VendaTerminal>?) {
        val qtd = resumo.optInt("qtd")
        val total = resumo.optDouble("total", 0.0)
        val sb = StringBuilder()
        // SEU DIA primeiro (só o garçom logado) — é o que interessa na troca de
        // turno. O total do aparelho/dia continua embaixo, pra conferência.
        resumo.optJSONObject("meu")?.let { meu ->
            sb.append("SEU DIA — ${Session.nome(this) ?: meu.optString("login")}: " +
                "${meu.optInt("qtd")} pagamento(s) · ${Cupom.brl(meu.optDouble("total", 0.0))}")
            meu.optJSONObject("formas")?.let { f ->
                f.keys().forEach { k ->
                    val o = f.optJSONObject(k) ?: return@forEach
                    sb.append("\n  $k: ${o.optInt("qtd")} · ${Cupom.brl(o.optDouble("total", 0.0))}")
                }
            }
            sb.append("\n\n")
        }
        sb.append("SISTEMA hoje (todos): $qtd pagamento(s) · ${Cupom.brl(total)}")
        resumo.optJSONObject("formas")?.let { f ->
            f.keys().forEach { k ->
                val o = f.optJSONObject(k) ?: return@forEach
                sb.append("\n  $k: ${o.optInt("qtd")} · ${Cupom.brl(o.optDouble("total", 0.0))}")
            }
        }
        val pags = resumo.optJSONArray("pagamentos")
        val nsusServidor = mutableSetOf<String>()
        if (pags != null) for (i in 0 until pags.length()) {
            pags.optJSONObject(i)?.optStringOrNull("nsu")?.let { nsusServidor.add(it) }
        }

        if (term == null) {
            sb.append("\n\nTERMINAL: listagem indisponível — confira contra o Resumo de Vendas da própria maquininha (app Cielo).")
        } else {
            val hoje = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
                .apply { timeZone = java.util.TimeZone.getTimeZone("America/Sao_Paulo") }
                .format(java.util.Date())
            val comData = term.any { it.dia != null }
            val termHoje = if (comData) term.filter { it.dia == hoje } else emptyList()
            if (!comData) {
                sb.append("\n\nTERMINAL: ${term.size} venda(s) no catálogo (sem data legível — comparação só pelo NSU).")
                val semPar = nsusServidor.filter { nsu -> term.none { it.nsu == nsu } }
                if (semPar.isEmpty()) sb.append("\n✓ Todos os registros de hoje têm par no terminal.")
                else sb.append("\n⚠ Registrados HOJE sem par no terminal: NSU ${semPar.joinToString(", ")}")
            } else {
                val totalTerm = termHoje.sumOf { it.valorCentavos } / 100.0
                sb.append("\n\nTERMINAL hoje: ${termHoje.size} venda(s) · ${Cupom.brl(totalTerm)}")
                val semRegistro = termHoje.filter { it.nsu !in nsusServidor }
                val nsusTerm = termHoje.map { it.nsu }.toSet()
                val semPar = nsusServidor.filter { it !in nsusTerm }
                when {
                    semRegistro.isEmpty() && semPar.isEmpty() && termHoje.size == qtd ->
                        sb.append("\n\n✅ BATEU — terminal e sistema idênticos, caixa conferido.")
                    else -> {
                        if (semRegistro.isNotEmpty()) sb.append("\n⚠ No TERMINAL sem registro no sistema:\n" +
                            semRegistro.joinToString("\n") { "  NSU ${it.nsu} · ${Cupom.brl(it.valorCentavos / 100.0)}" })
                        if (semPar.isNotEmpty()) sb.append("\n⚠ No SISTEMA sem par no terminal: NSU ${semPar.joinToString(", ")}")
                    }
                }
            }
        }

        val texto = sb.toString()
        AlertDialog.Builder(this)
            .setTitle("🧾 Fechamento do dia")
            .setMessage(texto)
            .setPositiveButton("🖨 Imprimir") { _, _ ->
                Lio.imprimirBlocos(this, listOf(
                    Lio.Bloco("\n${Session.loja(this)}\nFECHAMENTO DO DIA", negrito = true, tamanho = 22),
                    Lio.Bloco(Cupom.agoraBr(), tamanho = 16),
                    Lio.Bloco(texto, tamanho = 18),
                    Lio.Bloco("\n\n\n\n", tamanho = 12),
                ), onOk = { runOnUiThread { Toast.makeText(this, "Fechamento impresso!", Toast.LENGTH_SHORT).show() } },
                    onErro = { m -> runOnUiThread { Toast.makeText(this, m, Toast.LENGTH_LONG).show() } })
            }
            .setNegativeButton("Fechar", null)
            .setNeutralButton("🔒 Fechar meu caixa") { _, _ -> fecharMeuCaixa() }
            .show()
    }

    /** Troca de turno: fecha o caixa da MAQUININHA do logado. O servidor só
     *  fecha se BATER (NSU a NSU) — não bateu, mostra o motivo e fica aberto. */
    private fun fecharMeuCaixa() {
        AlertDialog.Builder(this)
            .setTitle("Fechar meu caixa")
            .setMessage("Fechar o SEU caixa da maquininha agora?\n\nSó fecha se bater tudo (NSU a NSU). Depois é só sair e o próximo entrar.")
            .setPositiveButton("Fechar meu caixa") { _, _ ->
                val tk = Session.token(this) ?: return@setPositiveButton logout()
                Thread {
                    val r = try { Api.lioFecharCaixa(Session.servidor(this), tk) }
                        catch (e: Exception) { org.json.JSONObject().put("ok", false).put("erro", Api.msgErroRede(e, Session.servidor(this))) }
                    runOnUiThread {
                        AlertDialog.Builder(this)
                            .setTitle(if (r.optBoolean("ok")) "✅ Caixa fechado" else "⚠ Não fechou")
                            .setMessage(if (r.optBoolean("ok"))
                                "BATEU — ${r.optInt("pagamentos")} pagamento(s) conferido(s) por NSU.\nPode sair; o próximo garçom entra e o caixa dele abre sozinho no primeiro recebimento."
                            else r.optStringOrNull("erro") ?: "Não foi possível fechar agora.")
                            .setPositiveButton("OK", null)
                            .show()
                    }
                }.start()
            }
            .setNegativeButton("Voltar", null)
            .show()
    }

    private fun logout() {
        Session.clear(this)
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }

    private inner class MesaAdapter : BaseAdapter() {
        var itens: List<Api.Aberta> = emptyList()
        override fun getCount() = itens.size
        override fun getItem(position: Int) = itens[position]
        override fun getItemId(position: Int) = position.toLong()

        override fun getView(position: Int, convertView: View?, parent: ViewGroup?): View {
            val v = convertView ?: layoutInflater.inflate(R.layout.item_mesa, parent, false)
            val m = itens[position]
            v.findViewById<TextView>(R.id.numero).text = if (m.ehComanda) "C${m.numero}" else "${m.numero}"
            val sub = listOfNotNull(
                m.nome,
                if (m.ehComanda) (m.mesa?.let { "mesa $it" } ?: "solta") else null,
            ).joinToString(" · ")
            val subTxt = v.findViewById<TextView>(R.id.sub)
            subTxt.text = sub
            subTxt.visibility = if (sub.isBlank()) View.GONE else View.VISIBLE
            v.findViewById<TextView>(R.id.valor).text = Cupom.brl(m.valorTotal)
            // Cores do vendas-local: verde andamento, âmbar atrasada, vermelho fechando.
            val fundo = when (m.status) {
                "fechando" -> 0xFFFEE2E2.toInt()
                "atrasada" -> 0xFFFEF3C7.toInt()
                else -> 0xFFDCFCE7.toInt()
            }
            // 🔔 CHAMOU O GARÇOM: vermelho mais forte PISCANDO, pra saltar aos
            // olhos. clearAnimation() no ramo normal garante que a célula
            // reaproveitada (GridView recicla views) pare de piscar.
            if (m.chamouGarcom) {
                v.setBackgroundColor(0xFFFCA5A5.toInt())
                if (v.animation == null || v.animation.hasEnded()) {
                    v.startAnimation(android.view.animation.AlphaAnimation(1f, 0.3f).apply {
                        duration = 420
                        repeatMode = android.view.animation.Animation.REVERSE
                        repeatCount = android.view.animation.Animation.INFINITE
                    })
                }
            } else {
                v.clearAnimation()
                v.setBackgroundColor(fundo)
            }
            return v
        }
    }
}
