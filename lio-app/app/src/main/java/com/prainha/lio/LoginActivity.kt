package com.prainha.lio

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.Spinner
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

// Login do garçom: login do Consumer + PIN próprio (POST /api/garcom/entrar).
// Quem pode entrar é quem tem AcessarComandaMobile (perm 53) no Consumer.
// Primeira vez: o servidor pede a confirmação do PIN (campo pin2 aparece).
// O seletor de servidor escolhe a loja (Prainha/Tabuará) ou uma URL custom
// (ex.: túnel HTTPS usado na certificação da Cielo).
class LoginActivity : AppCompatActivity() {

    private lateinit var servidorSp: Spinner
    private lateinit var servidorCustom: EditText
    private lateinit var loginIn: EditText
    private lateinit var pinIn: EditText
    private lateinit var pin2In: EditText
    private lateinit var pin2Label: TextView
    private lateinit var btn: Button
    private lateinit var erro: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_login)

        servidorSp = findViewById(R.id.servidor)
        servidorCustom = findViewById(R.id.servidorCustom)
        loginIn = findViewById(R.id.login)
        pinIn = findViewById(R.id.pin)
        pin2In = findViewById(R.id.pin2)
        pin2Label = findViewById(R.id.pin2Label)
        btn = findViewById(R.id.entrar)
        erro = findViewById(R.id.erro)
        findViewById<TextView>(R.id.versaoApp).text = "v" + BuildConfig.VERSION_NAME

        val nomes = Session.SERVIDORES.map { it.first } + "Outro servidor…"
        servidorSp.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, nomes)
        servidorSp.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(p: AdapterView<*>?, v: View?, pos: Int, id: Long) {
                servidorCustom.visibility = if (pos >= Session.SERVIDORES.size) View.VISIBLE else View.GONE
            }
            override fun onNothingSelected(p: AdapterView<*>?) {}
        }
        // Restaura a última escolha (conveniência do turno seguinte).
        val salvo = Session.loja(this)
        val idx = Session.SERVIDORES.indexOfFirst { it.first == salvo }
        if (idx >= 0) servidorSp.setSelection(idx) else {
            servidorSp.setSelection(Session.SERVIDORES.size)
            servidorCustom.setText(Session.servidor(this))
        }
        loginIn.setText(Session.login(this) ?: "")

        btn.setOnClickListener { entrar() }
    }

    private fun servidorEscolhido(): Pair<String, String>? {
        val pos = servidorSp.selectedItemPosition
        if (pos < Session.SERVIDORES.size) return Session.SERVIDORES[pos].second to Session.SERVIDORES[pos].first
        val url = servidorCustom.text.toString().trim().trimEnd('/')
        if (url.isBlank() || (!url.startsWith("http://") && !url.startsWith("https://"))) {
            mostrarErro("Informe a URL do servidor (http:// ou https://)")
            return null
        }
        return url to "Servidor custom"
    }

    private fun entrar() {
        val (base, lojaLabel) = servidorEscolhido() ?: return
        val login = loginIn.text.toString().trim().lowercase()
        val pin = pinIn.text.toString().trim()
        val pin2 = pin2In.text.toString().trim().ifBlank { null }
        if (login.isEmpty() || pin.isEmpty()) { mostrarErro("Informe login e PIN"); return }

        erro.visibility = View.GONE
        setLoading(true)
        Thread {
            try {
                val r = Api.entrar(base, login, pin, pin2)
                runOnUiThread {
                    when {
                        r.optBoolean("ok") && !r.optStringOrNull("token").isNullOrBlank() -> {
                            Session.saveServidor(this, base, lojaLabel)
                            Session.save(this, r.optString("token"), login, r.optStringOrNull("nome"), false)
                            // Config da loja (limites de mesa/comanda) — melhor esforço.
                            Thread {
                                val c = Api.config(base)
                                if (c != null) {
                                    Session.saveConfig(this, c)
                                    Session.saveServidor(this, base, c.loja)
                                }
                            }.start()
                            startActivity(Intent(this, MesasActivity::class.java))
                            finish()
                        }
                        r.optBoolean("primeira_vez") -> {
                            setLoading(false)
                            pin2Label.visibility = View.VISIBLE
                            pin2In.visibility = View.VISIBLE
                            pin2In.requestFocus()
                            mostrarErro(r.optStringOrNull("erro")
                                ?: "Primeiro acesso de ${r.optStringOrNull("nome") ?: login}: digite o PIN de novo pra confirmar")
                        }
                        else -> {
                            setLoading(false)
                            mostrarErro(r.optStringOrNull("erro") ?: "Não foi possível entrar")
                        }
                    }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    setLoading(false)
                    mostrarErro(e.message ?: "Servidor da loja fora do ar")
                }
            }
        }.start()
    }

    private fun mostrarErro(msg: String) {
        erro.text = msg
        erro.visibility = View.VISIBLE
    }

    private fun setLoading(loading: Boolean) {
        btn.isEnabled = !loading
        btn.text = if (loading) "Entrando…" else "Entrar"
    }
}
