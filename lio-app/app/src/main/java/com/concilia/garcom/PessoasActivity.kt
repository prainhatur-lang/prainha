package com.concilia.garcom

import android.content.Intent
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

/**
 * "Quantas pessoas?" — tela exclusiva, em tela cheia, que abre logo depois do
 * número da mesa (pedido do dono, 10/10/2026: bem visível e bem prático).
 * Números de 1 a 12 bem grandes, um toque grava e a mesa abre; "Mais de 12"
 * troca a grade por um teclado próprio.
 *
 * Dois usos:
 *  - abrir (padrão): vem do "Abrir" das mesas, só pra mesa SEM conta. Gravou
 *    → abre a ContaActivity. A resposta espera no servidor a conta nascer.
 *  - corrigir ("corrigir" = true): vem do ⋯ da conta. Gravou → volta pra conta.
 *
 * A pergunta nunca prende a mesa: se a gravação falhar aparece o botão de
 * seguir sem informar, e o "‹ Voltar" sempre devolve pra tela de antes.
 */
class PessoasActivity : AppCompatActivity() {

    private var numero = 0
    private var corrigir = false
    private var atual = 0             // o que já está valendo — destaca o botão
    private var doCliente = false     // quem informou `atual` foi o cliente, no QR
    private var digitando = false     // "Mais de 12": teclado próprio
    private var digitado = ""
    private var gravando = false

    private lateinit var dica: TextView
    private lateinit var visor: TextView
    private lateinit var grade: LinearLayout
    private lateinit var erro: TextView
    private lateinit var maisBtn: Button
    private lateinit var semBtn: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_pessoas)
        numero = intent.getIntExtra("numero", 0)
        corrigir = intent.getBooleanExtra("corrigir", false)
        atual = intent.getIntExtra("atual", 0)
        doCliente = intent.getBooleanExtra("do_cliente", false)

        dica = findViewById(R.id.dica)
        visor = findViewById(R.id.visor)
        grade = findViewById(R.id.grade)
        erro = findViewById(R.id.erro)
        maisBtn = findViewById(R.id.maisDe12)
        semBtn = findViewById(R.id.semInformar)

        findViewById<TextView>(R.id.mesa).text = "Mesa $numero"
        findViewById<Button>(R.id.voltar).setOnClickListener { voltar() }
        maisBtn.setOnClickListener { if (!gravando) { digitando = !digitando; digitado = ""; pintar() } }
        semBtn.text = if (corrigir) "Voltar sem alterar" else "Abrir a mesa sem informar"
        semBtn.setOnClickListener { seguir(null) }

        pintar()
        if (corrigir) buscarAtual()
    }

    /** Corrigindo pela conta: mostra o número que está valendo hoje. */
    private fun buscarAtual() {
        val base = Session.servidor(this)
        Thread {
            val info = Api.pessoasVer(base, numero, timeoutMs = 4000) ?: return@Thread
            runOnUiThread {
                if (isFinishing || isDestroyed || gravando || digitando) return@runOnUiThread
                val p = info.pessoas ?: 0
                // conta nasce com 1 por padrão: só destaca o 1 se alguém informou
                if (p > 1 || (p == 1 && info.informado)) { atual = p; pintar() }
            }
        }.start()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() = voltar()

    private fun voltar() {
        if (gravando) return
        if (digitando) { digitando = false; digitado = ""; pintar() } else finish()
    }

    // ---- desenho ----

    private fun pintar() {
        erro.visibility = View.GONE
        semBtn.visibility = View.GONE
        grade.removeAllViews()
        if (digitando) pintarTeclado() else pintarGrade()
    }

    /** 1 a 12 em 4 linhas de 3 — cada botão pega um terço da largura e um
     *  quarto da altura que sobra. */
    private fun pintarGrade() {
        visor.visibility = View.GONE
        dica.text = when {
            atual > 0 && doCliente -> "O cliente informou $atual — toque pra confirmar ou corrigir."
            atual > 0 -> "Hoje está com $atual. Toque no número certo."
            corrigir -> "Toque no número certo."
            else -> "Toque no número — a mesa abre em seguida."
        }
        for (linha in 0 until 4) {
            val row = novaLinha()
            for (col in 1..3) {
                val n = linha * 3 + col
                row.addView(botao("$n", 40f, destaque = n == atual) { gravar(n) })
            }
            grade.addView(row)
        }
        maisBtn.text = if (atual > 12) "Mais de 12 — hoje está com $atual" else "Mais de 12 — digitar o número"
        maisBtn.background = fundo(0xFFE0F2FE.toInt(), 0xFF0C7091.toInt())
        maisBtn.setTextColor(0xFF0C7091.toInt())
    }

    /** Teclado do "Mais de 12": visor grande, 0–9, apagar e OK. */
    private fun pintarTeclado() {
        visor.visibility = View.VISIBLE
        dica.text = "Digite a quantidade e toque em OK."
        val teclas = listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK")
        for (linha in 0 until 4) {
            val row = novaLinha()
            for (col in 0 until 3) {
                val t = teclas[linha * 3 + col]
                row.addView(when (t) {
                    "⌫" -> botao(t, 32f) { digitado = digitado.dropLast(1); mostrarDigitado() }
                    "OK" -> botao(t, 30f, destaque = true) { confirmarDigitado() }
                    else -> botao(t, 36f) {
                        // até 99 (o teto do servidor); zero à esquerda não entra
                        if (digitado.length < 2 && !(digitado.isEmpty() && t == "0")) { digitado += t; mostrarDigitado() }
                    }
                })
            }
            grade.addView(row)
        }
        maisBtn.text = "‹ Voltar pros números de 1 a 12"
        maisBtn.background = fundo(0xFFE5E7EB.toInt(), 0xFF9CA3AF.toInt())
        maisBtn.setTextColor(0xFF374151.toInt())
        mostrarDigitado()
    }

    private fun mostrarDigitado() {
        visor.text = if (digitado.isEmpty()) "—" else digitado
        erro.visibility = View.GONE
    }

    private fun confirmarDigitado() {
        val n = digitado.toIntOrNull()
        if (n == null || n < 1 || n > PESSOAS_MAX) {
            erro.text = "Digite de 1 a $PESSOAS_MAX pessoas."
            erro.visibility = View.VISIBLE
            return
        }
        gravar(n)
    }

    private fun novaLinha(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
    }

    private fun botao(texto: String, tamanho: Float, destaque: Boolean = false, aoTocar: () -> Unit): Button =
        Button(this).apply {
            text = texto
            textSize = tamanho
            isAllCaps = false
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setPadding(0, 0, 0, 0)
            minHeight = 0
            minimumHeight = 0
            stateListAnimator = null
            setTextColor(if (destaque) 0xFFFFFFFF.toInt() else 0xFF0C7091.toInt())
            background = fundo(if (destaque) 0xFF0C7091.toInt() else 0xFFFFFFFF.toInt(), 0xFF0C7091.toInt())
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply {
                setMargins(dp(4), dp(4), dp(4), dp(4))
            }
            setOnClickListener { if (!gravando) aoTocar() }
        }

    /** Fundo arredondado com borda; clareia no toque e acinzenta travado. */
    private fun fundo(cor: Int, borda: Int): Drawable {
        fun forma(c: Int, b: Int) = GradientDrawable().apply {
            setColor(c)
            cornerRadius = dp(14).toFloat()
            setStroke(dp(2), b)
        }
        return StateListDrawable().apply {
            addState(intArrayOf(-android.R.attr.state_enabled), forma(0xFFE5E7EB.toInt(), 0xFFD1D5DB.toInt()))
            addState(intArrayOf(android.R.attr.state_pressed), forma(0xFF7DD3FC.toInt(), borda))
            addState(intArrayOf(), forma(cor, borda))
        }
    }

    private fun travar(sim: Boolean) {
        for (i in 0 until grade.childCount) {
            val row = grade.getChildAt(i) as? LinearLayout ?: continue
            for (k in 0 until row.childCount) row.getChildAt(k).isEnabled = !sim
        }
        maisBtn.isEnabled = !sim
    }

    // ---- gravar ----

    private fun gravar(n: Int) {
        if (gravando) return
        val tk = Session.token(this) ?: return logout()
        val base = Session.servidor(this)
        gravando = true
        erro.visibility = View.GONE
        semBtn.visibility = View.GONE
        dica.text = "Gravando $n ${if (n == 1) "pessoa" else "pessoas"}…"
        travar(true)
        Thread {
            try {
                val r = Api.pessoasGravar(base, tk, numero, n)
                runOnUiThread {
                    if (isFinishing || isDestroyed) return@runOnUiThread
                    gravando = false
                    if (r.optBoolean("ok")) seguir(n)
                    else falhou(r.optString("erro", "").ifBlank { "Não consegui gravar agora." })
                }
            } catch (e: Api.SemSessao) {
                runOnUiThread { logout() }
            } catch (e: Exception) {
                runOnUiThread {
                    if (isFinishing || isDestroyed) return@runOnUiThread
                    gravando = false
                    falhou("Sem resposta do servidor — tente de novo.")
                }
            }
        }.start()
    }

    private fun falhou(msg: String) {
        travar(false)
        dica.text = "Toque no número de novo."
        erro.text = msg
        erro.visibility = View.VISIBLE
        semBtn.visibility = View.VISIBLE
    }

    /** `n` = o que foi gravado; null = seguiu sem informar. */
    private fun seguir(n: Int?) {
        if (corrigir) {
            if (n != null) Toast.makeText(this, "👥 $n ${if (n == 1) "pessoa" else "pessoas"} na mesa $numero", Toast.LENGTH_SHORT).show()
            setResult(if (n != null) RESULT_OK else RESULT_CANCELED)
        } else {
            val i = Intent(this, ContaActivity::class.java)
            i.putExtra("numero", numero)
            startActivity(i)
        }
        finish()
    }

    private fun logout() {
        Session.clear(this)
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    companion object {
        /** mesmo teto do servidor (PESSOAS_MAX) pra equipe */
        const val PESSOAS_MAX = 99
    }
}
