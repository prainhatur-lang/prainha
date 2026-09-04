package com.concilia.garcom

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
//
// O servidor da loja é DESCOBERTO sozinho: varredura da sub-rede local na
// porta 8790 (Descoberta.kt) — cada servidor achado entra no seletor com o
// nome que a própria loja reporta (/api/config) e o primeiro é pré-escolhido.
// A lista fixa fica de reserva pra quando a varredura não achar nada (VPN,
// rede errada), e "Outro servidor…" aceita URL manual (https pra túnel de
// certificação; http só pra IP de rede local).
class LoginActivity : AppCompatActivity() {

    private lateinit var servidorSp: Spinner
    private lateinit var servidorCustom: EditText
    private lateinit var codigoEmpresaIn: EditText
    private lateinit var buscarFiliaisBtn: Button
    private lateinit var descobertaStatus: TextView
    private lateinit var loginIn: EditText
    private lateinit var pinIn: EditText
    private lateinit var pin2In: EditText
    private lateinit var pin2Label: TextView
    private lateinit var btn: Button
    private lateinit var erro: TextView

    /** (rótulo, base) — base vazia = "Outro servidor…" (URL manual). */
    private val opcoes = mutableListOf<Pair<String, String>>()
    private val descobertos = mutableListOf<Descoberta.Servidor>()
    /** Filiais vindas do Concilia pelo CÓDIGO DA EMPRESA (túnel de cada uma) —
     *  entram no topo do seletor. É o jeito "sem digitar URL". */
    private val nuvem = mutableListOf<Api.FilialNuvem>()
    private var escolhaUsuario = false   // usuário mexeu no seletor — não sobrescrever
    private var ajustando = false        // setSelection programático em andamento

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_login)

        servidorSp = findViewById(R.id.servidor)
        servidorCustom = findViewById(R.id.servidorCustom)
        descobertaStatus = findViewById(R.id.descobertaStatus)
        loginIn = findViewById(R.id.login)
        pinIn = findViewById(R.id.pin)
        pin2In = findViewById(R.id.pin2)
        pin2Label = findViewById(R.id.pin2Label)
        btn = findViewById(R.id.entrar)
        erro = findViewById(R.id.erro)
        findViewById<TextView>(R.id.versaoApp).text = "v" + BuildConfig.VERSION_NAME
        codigoEmpresaIn = findViewById(R.id.codigoEmpresa)
        buscarFiliaisBtn = findViewById(R.id.buscarFiliais)
        codigoEmpresaIn.setText(Session.codigoEmpresa(this) ?: "")
        buscarFiliaisBtn.setOnClickListener { buscarFiliais(manual = true) }
        codigoEmpresaIn.setOnEditorActionListener { _, _, _ -> buscarFiliais(manual = true); true }
        // Já tem código de outra vez: refaz a busca em silêncio, pra lista vir pronta.
        if (!Session.codigoEmpresa(this).isNullOrBlank()) buscarFiliais(manual = false)

        servidorSp.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(p: AdapterView<*>?, v: View?, pos: Int, id: Long) {
                if (!ajustando) escolhaUsuario = true
                servidorCustom.visibility =
                    if (opcoes.getOrNull(pos)?.second == "") View.VISIBLE else View.GONE
            }
            override fun onNothingSelected(p: AdapterView<*>?) {}
        }
        loginIn.setText(Session.login(this) ?: "")
        btn.setOnClickListener { entrar() }

        montarOpcoes(selecionarBase = Session.servidor(this))
        descobrirServidores()
    }

    // ---- seletor de servidor ----

    /** Reconstrói o seletor: descobertos → fixos de reserva → "Outro…". */
    private fun montarOpcoes(selecionarBase: String? = null) {
        val atual = opcoes.getOrNull(servidorSp.selectedItemPosition)?.second
        opcoes.clear()
        nuvem.forEach { f -> opcoes.add(Pair("${f.nome} — nuvem", f.url)) }
        descobertos.forEach { s ->
            if (opcoes.none { it.second == s.base }) opcoes.add(Pair("${s.nome} — ${s.base.removePrefix("http://")}", s.base))
        }
        Session.SERVIDORES.forEach { (nome, base) ->
            if (opcoes.none { it.second == base }) opcoes.add(Pair(nome, base))
        }
        opcoes.add(Pair("Outro servidor…", ""))

        val labels = opcoes.map { it.first }
        servidorSp.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, labels)

        val alvo = when {
            escolhaUsuario && atual != null -> atual
            selecionarBase != null -> selecionarBase
            else -> atual
        }
        val idx = opcoes.indexOfFirst { it.second == alvo && !alvo.isNullOrBlank() }
        ajustando = true
        servidorSp.setSelection(if (idx >= 0) idx else 0)
        servidorSp.post { ajustando = false }
    }

    /** Pergunta ao Concilia as filiais (e o túnel) do código da empresa e põe no
     *  seletor. `manual` = a pessoa tocou Buscar (mostra erro); silencioso no
     *  arranque quando já havia código salvo. */
    private fun buscarFiliais(manual: Boolean) {
        val codigo = codigoEmpresaIn.text.toString().trim().lowercase()
        if (codigo.length < 3) { if (manual) mostrarErro("Digite o código da empresa (ex.: prainha)"); return }
        if (manual) { descobertaStatus.visibility = View.VISIBLE; descobertaStatus.text = "☁️ Buscando filiais de \"$codigo\"…" }
        Thread {
            try {
                val (empresa, lista) = Api.filiaisDaEmpresa(codigo)
                runOnUiThread {
                    Session.saveCodigoEmpresa(this, codigo)
                    nuvem.clear(); nuvem.addAll(lista)
                    // A 1ª filial da nuvem vira a escolha, a menos que a pessoa já tenha mexido.
                    val preferido = if (!escolhaUsuario && lista.isNotEmpty()) lista.first().url else null
                    montarOpcoes(selecionarBase = preferido ?: Session.servidor(this))
                    descobertaStatus.visibility = View.VISIBLE
                    descobertaStatus.text = if (lista.isEmpty()) "$empresa: nenhuma filial com túnel cadastrado"
                        else "☁️ $empresa: " + lista.joinToString(" · ") { it.nome }
                    if (manual) erro.visibility = View.GONE
                }
            } catch (e: Exception) {
                runOnUiThread {
                    if (manual) mostrarErro("Não achei a empresa \"$codigo\": " + (e.message ?: "sem resposta do Concilia"))
                    else descobertaStatus.text = "Sem internet pra buscar as filiais — usando a última escolha"
                }
            }
        }.start()
    }

    /** Varre a rede local e vai adicionando cada servidor achado no topo. */
    private fun descobrirServidores() {
        descobertaStatus.visibility = View.VISIBLE
        descobertaStatus.text = "🔎 Procurando o servidor da loja na rede…"
        val extras = Session.SERVIDORES.map { it.second.removePrefix("http://").substringBefore(':') } +
            listOfNotNull(Session.servidor(this).takeIf { it.startsWith("http://") }
                ?.removePrefix("http://")?.substringBefore(':'))
        Descoberta.procurar(
            extras = extras.distinct(),
            onAchado = { s ->
                runOnUiThread {
                    if (descobertos.none { it.base == s.base }) {
                        descobertos.add(s)
                        // Pré-escolhe o primeiro achado, a menos que o usuário já tenha mexido.
                        val preferido = if (!escolhaUsuario) s.base else null
                        montarOpcoes(selecionarBase = preferido)
                        descobertaStatus.text = "✓ Na rede: " + descobertos.joinToString(" · ") { it.nome }
                    }
                }
            },
            onFim = {
                runOnUiThread {
                    if (descobertos.isEmpty()) {
                        descobertaStatus.text = "Nenhum servidor na rede — escolha manual abaixo"
                    }
                }
            }
        )
    }

    /** (base, rótulo) escolhidos — valida URL manual (http só em rede local). */
    private fun servidorEscolhido(): Pair<String, String>? {
        val pos = servidorSp.selectedItemPosition
        val op = opcoes.getOrNull(pos) ?: return null
        if (op.second.isNotBlank()) return op.second to op.first.substringBefore(" — ")
        val url = servidorCustom.text.toString().trim().trimEnd('/')
        if (url.isBlank() || (!url.startsWith("http://") && !url.startsWith("https://"))) {
            mostrarErro("Informe a URL do servidor (http:// ou https://)")
            return null
        }
        if (url.startsWith("http://")) {
            val host = url.removePrefix("http://").substringBefore('/').substringBefore(':')
            if (!Descoberta.ipPrivado(host)) {
                mostrarErro("http:// só pra IP da rede local (10.x / 172.16-31.x / 192.168.x). Na internet, use https://")
                return null
            }
        }
        return url to "Servidor custom"
    }

    // ---- login ----

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
                            // Config da loja (nome real + limites de mesa/comanda).
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
                    // Servidor desligado/inalcançável = mensagem CLARA ("não
                    // encontrei o servidor"), não o texto técnico do Java.
                    mostrarErro(Api.msgErroRede(e, base))
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
