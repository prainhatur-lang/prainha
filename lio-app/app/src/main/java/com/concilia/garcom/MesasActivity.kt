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
                        vazio.text = e.message ?: "Servidor da loja fora do ar"
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
            v.setBackgroundColor(fundo)
            return v
        }
    }
}
