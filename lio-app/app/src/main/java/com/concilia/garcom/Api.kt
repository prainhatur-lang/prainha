package com.concilia.garcom

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.URLEncoder
import java.net.UnknownHostException
import javax.net.ssl.SSLException

// Camada de rede do app da maquininha. Fala com o VENDAS-LOCAL da loja
// (server.mjs, HTTP :8790 na LAN — cleartext liberado só pros IPs das lojas
// no network_security_config). Auth: header x-garcom (token HMAC do login por
// PIN, POST /api/garcom/entrar). Tudo com HttpURLConnection (sem OkHttp =
// menos superfície de reprovação na certificação). As funções BLOQUEIAM —
// chame-as sempre dentro de uma Thread (as Activities fazem isso).
object Api {

    private const val TIMEOUT = 15000

    /** 401 nas rotas do garçom = token venceu (16h) → volta pro login. */
    class SemSessao : IOException("Sessão expirada — entre de novo")

    /** Traduz uma falha de rede pra mensagem clara em português. O app mostrava
     *  o texto cru do Java ("Unable to resolve host", "failed to connect…") —
     *  incompreensível pro garçom. O caso mais comum é o servidor DESLIGADO:
     *  tem que dizer com todas as letras que não achou o servidor da loja.
     *  `servidor` (a URL/IP escolhido) entra na mensagem quando informado. */
    fun msgErroRede(e: Throwable, servidor: String? = null): String {
        val onde = servidor?.trim()?.takeIf { it.isNotBlank() }?.let { " ($it)" } ?: ""
        val m = (e.message ?: "").lowercase()
        return when {
            e is SemSessao -> "Sessão expirada — entre de novo."
            e is UnknownHostException || m.contains("unable to resolve host") || m.contains("no address associated") ->
                "Não encontrei o servidor da loja$onde. Confira o endereço e se o servidor está ligado."
            e is ConnectException || m.contains("failed to connect") || m.contains("connection refused") || m.contains("econnrefused") ->
                "O servidor da loja$onde não respondeu — pode estar desligado ou em outra rede. Ligue o servidor e tente de novo."
            e is SocketTimeoutException || m.contains("timeout") || m.contains("timed out") ->
                "O servidor da loja$onde demorou demais pra responder. Confira a conexão e se ele está ligado."
            m.contains("cleartext") ->
                "Endereço bloqueado: use https:// (http:// só vale na rede local da loja)."
            e is SSLException ->
                "Falha na conexão segura (HTTPS) com o servidor$onde."
            else ->
                "Não consegui falar com o servidor da loja$onde. Confira o endereço e a conexão."
        }
    }

    // -------- shapes --------

    data class ConfigLoja(
        val loja: String,
        val mesaMax: Int,
        val comandaAtiva: Boolean,
        val comandaMin: Int,
        val comandaMax: Int,
        val numeroMax: Int,
        val taxaServico: Double,
    )

    /** Mesa/comanda aberta na grade (espelho local — rápido). */
    data class Aberta(
        val numero: Int,
        val valorTotal: Double,
        val status: String,          // andamento | atrasada | fechando
        val contaPedida: Boolean,
        val nome: String?,
        val itens: Int,
        val mesa: Int?,              // comanda: a mesa onde está (null = solta)
        val ehComanda: Boolean,
        val chamouGarcom: Boolean = false, // cliente apertou "chamar garçom" → pisca vermelho
    )

    data class ItemConta(val nome: String, val qtd: Double, val valor: Double, val tipo: Int)
    data class PagFeito(val forma: String, val valor: Double, val nsu: String?, val status: String, val criadoEm: String?)

    /** Conta AO VIVO do Firebird (/api/conta) — números reais pra cobrar. */
    data class Conta(
        val numero: Int,
        val mesa: Int?,
        val contaPedida: Boolean,
        val itens: List<ItemConta>,
        val total: Double,           // VALORTOTAL (com serviço/desconto/acréscimo)
        val servico: Double,
        val pago: Double,
        val saldo: Double,
        val pagamentos: List<PagFeito>,
    )

    data class MesaInfo(val comandas: List<Int>, val nomes: Map<String, String>, val contaPedida: Boolean)

    data class Categoria(val nome: String, val n: Int, val disp: Int)

    /** Linha do catálogo — item vendável (codigoPdv != null) ou grupo de variantes. */
    data class Produto(
        val codigoPdv: Int?,
        val produtoCodigo: Int,
        val nome: String,
        val tamanho: String?,
        val preco: Double,
        val precoMax: Double?,
        val grupo: Boolean,
        val semEstoque: Boolean,
        /** quantidade em estoque; null = produto sem controle de estoque */
        val estoque: Double?,
        val variantes: Int,
    )

    data class Opcao(val codigo: Int, val nome: String, val preco: Double)
    data class Pergunta(val codigo: Int, val texto: String, val min: Int, val max: Int, val opcoes: List<Opcao>)

    data class EnviarRes(
        val ok: Boolean,
        val erro: String?,
        val contaPedida: Boolean,
        val precisaCadastro: Boolean,
        val total: Double,
        val nItens: Int,
    )

    data class PagarRes(
        val ok: Boolean,
        val jaRegistrado: Boolean,
        val pago: Double,
        val saldo: Double,
        val quitada: Boolean,
        val erro: String?,
    )

    // -------- HTTP helpers --------

    private fun http(
        method: String,
        urlStr: String,
        token: String? = null,
        body: JSONObject? = null,
        readTimeoutMs: Int = TIMEOUT,
    ): Pair<Int, String> {
        val conn = URL(urlStr).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = TIMEOUT
            conn.readTimeout = readTimeoutMs
            if (token != null) conn.setRequestProperty("x-garcom", token)
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                val out: OutputStream = conn.outputStream
                out.write(body.toString().toByteArray(Charsets.UTF_8)); out.flush(); out.close()
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else (conn.errorStream ?: conn.inputStream)
            val text = BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }
            return Pair(code, text)
        } finally {
            conn.disconnect()
        }
    }

    /** GET que devolve o JSONObject; 401 → SemSessao (rotas do garçom). */
    private fun getJson(url: String, token: String? = null): JSONObject {
        val (code, resp) = http("GET", url, token)
        if (code == 401) throw SemSessao()
        if (code !in 200..299) throw IOException("Servidor respondeu $code")
        return JSONObject(resp)
    }

    private fun postJson(url: String, token: String?, body: JSONObject): JSONObject {
        val (code, resp) = http("POST", url, token, body)
        if (code == 401) throw SemSessao()
        if (code !in 200..299) throw IOException("Servidor respondeu $code")
        return JSONObject(resp)
    }

    private fun enc(v: String): String = URLEncoder.encode(v, "UTF-8")

    // -------- servidor / config --------

    /** Servidor no ar? Devolve o hash de versão do server.mjs. */
    @Throws(IOException::class)
    fun versao(base: String): String = getJson("$base/api/versao").optString("versao")

    /**
     * Config da loja (GET /api/config — rota criada junto com este app).
     * Servidor antigo sem a rota → null (o caller usa defaults da loja).
     */
    fun config(base: String): ConfigLoja? {
        return try {
            val j = getJson("$base/api/config")
            if (!j.optBoolean("ok")) return null
            ConfigLoja(
                loja = j.optString("loja", "Prainha"),
                mesaMax = j.optInt("mesa_max", 299),
                comandaAtiva = j.optBoolean("comanda_ativa", true),
                comandaMin = j.optInt("comanda_min", 300),
                comandaMax = j.optInt("comanda_max", 400),
                numeroMax = j.optInt("numero_max", 400),
                taxaServico = j.optDouble("taxa_servico", 10.0),
            )
        } catch (_: Exception) { null }
    }

    // -------- login do garçom (PIN — permissão 53 no Consumer) --------

    /** Resposta crua do /api/garcom/entrar: {ok, token?, nome?, primeira_vez?, erro?}. */
    @Throws(IOException::class)
    fun entrar(base: String, login: String, pin: String, pin2: String?): JSONObject {
        val body = JSONObject().put("login", login).put("pin", pin)
        if (!pin2.isNullOrBlank()) body.put("pin2", pin2)
        return postJson("$base/api/garcom/entrar", null, body)
    }

    // -------- mesas / conta --------

    /** Grade de mesas e comandas abertas (espelho local, sem auth). */
    @Throws(IOException::class)
    fun abertas(base: String): Pair<List<Aberta>, List<Aberta>> {
        val j = getJson("$base/api/venda/abertas")
        fun parse(arr: JSONArray?, ehComanda: Boolean): List<Aberta> {
            if (arr == null) return emptyList()
            return (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                Aberta(
                    numero = o.optInt("numero"),
                    valorTotal = o.optDouble("valor_total", 0.0),
                    status = o.optString("status", "andamento"),
                    contaPedida = o.optBoolean("conta_pedida", false),
                    nome = o.optStringOrNull("nome"),
                    itens = o.optInt("itens", 0),
                    mesa = if (o.isNull("mesa")) null else o.optInt("mesa"),
                    ehComanda = ehComanda,
                    chamouGarcom = o.optBoolean("chamou_garcom", false),
                )
            }
        }
        return Pair(parse(j.optJSONArray("mesas"), false), parse(j.optJSONArray("comandas"), true))
    }

    /**
     * Conta AO VIVO (GET /api/conta — lê o Firebird). Mesa vazia (sem conta
     * aberta) devolve null — não é erro: o primeiro enviar abre a conta.
     */
    @Throws(IOException::class)
    fun conta(base: String, numero: Int): Conta? {
        val j = getJson("$base/api/conta?n=$numero")
        if (!j.optBoolean("ok")) {
            val erro = j.optString("erro", "")
            if (erro.contains("não há conta aberta")) return null
            throw IOException(erro.ifBlank { "Erro ao carregar a conta" })
        }
        val itens = j.optJSONArray("itens") ?: JSONArray()
        val pags = j.optJSONArray("pagamentos") ?: JSONArray()
        return Conta(
            numero = j.optInt("numero"),
            mesa = if (j.isNull("mesa")) null else j.optInt("mesa"),
            contaPedida = j.optBoolean("conta_pedida", false),
            itens = (0 until itens.length()).mapNotNull { i ->
                val o = itens.optJSONObject(i) ?: return@mapNotNull null
                ItemConta(o.optString("nome"), o.optDouble("qtd", 1.0), o.optDouble("valor", 0.0), o.optInt("tipo", 1))
            },
            total = j.optDouble("total", 0.0),
            servico = j.optDouble("servico", 0.0),
            pago = j.optDouble("pago", 0.0),
            saldo = j.optDouble("saldo", 0.0),
            pagamentos = (0 until pags.length()).mapNotNull { i ->
                val o = pags.optJSONObject(i) ?: return@mapNotNull null
                PagFeito(o.optString("forma"), o.optDouble("valor", 0.0), o.optStringOrNull("nsu"),
                    o.optString("status"), o.optStringOrNull("criado_em"))
            },
        )
    }

    /** Comandas penduradas na mesa (chips) + nomes. */
    @Throws(IOException::class)
    fun mesaInfo(base: String, mesa: Int): MesaInfo {
        val j = getJson("$base/api/venda/mesa?n=$mesa")
        val arr = j.optJSONArray("comandas") ?: JSONArray()
        val nomesObj = j.optJSONObject("nomes") ?: JSONObject()
        val nomes = mutableMapOf<String, String>()
        nomesObj.keys().forEach { k -> nomes[k] = nomesObj.optString(k) }
        return MesaInfo(
            comandas = (0 until arr.length()).map { arr.optInt(it) },
            nomes = nomes,
            contaPedida = j.optBoolean("conta_pedida", false),
        )
    }

    /** Cupom 80mm (GET /api/conta/texto) — devolve o JSON cru pro Cupom montar. */
    @Throws(IOException::class)
    fun contaTexto(base: String, numero: Int): JSONObject {
        val j = getJson("$base/api/conta/texto?n=$numero")
        if (!j.optBoolean("ok")) throw IOException(j.optString("erro", "Erro ao montar a conta"))
        return j
    }

    /** imprimir | fechar | reabrir (POST /api/venda/conta — exige garçom). */
    @Throws(IOException::class)
    fun acaoConta(base: String, token: String, numero: Int, acao: String): JSONObject =
        postJson("$base/api/venda/conta", token, JSONObject().put("numero", numero).put("acao", acao))

    // -------- catálogo (espelho local, sem auth — SEM cliente=1: garçom vê tudo) --------

    @Throws(IOException::class)
    fun categorias(base: String): List<Categoria> {
        val arr = getJson("$base/api/venda/categorias").optJSONArray("categorias") ?: JSONArray()
        return (0 until arr.length()).mapNotNull { i ->
            val o = arr.optJSONObject(i) ?: return@mapNotNull null
            Categoria(o.optString("categoria"), o.optInt("n"), o.optInt("disp"))
        }
    }

    @Throws(IOException::class)
    fun categoria(base: String, nome: String): List<Produto> =
        parseProdutos(getJson("$base/api/venda/categoria?c=${enc(nome)}").optJSONArray("produtos"))

    @Throws(IOException::class)
    fun busca(base: String, termo: String): List<Produto> =
        parseProdutos(getJson("$base/api/venda/busca?q=${enc(termo)}").optJSONArray("produtos"))

    /** Variantes de um grupo (dose/garrafa, tamanhos) — todas vendáveis. */
    @Throws(IOException::class)
    fun variantes(base: String, produtoCodigo: Int): List<Produto> {
        val j = getJson("$base/api/venda/variantes?p=$produtoCodigo")
        if (!j.optBoolean("ok")) throw IOException(j.optString("erro", "Produto inválido"))
        return parseProdutos(j.optJSONArray("produtos"))
    }

    private fun parseProdutos(arr: JSONArray?): List<Produto> {
        if (arr == null) return emptyList()
        return (0 until arr.length()).mapNotNull { i ->
            val o = arr.optJSONObject(i) ?: return@mapNotNull null
            val grupo = o.optBoolean("grupo", false)
            Produto(
                codigoPdv = if (grupo || o.isNull("codigo_pdv")) null else o.optInt("codigo_pdv"),
                produtoCodigo = o.optInt("produto_codigo"),
                nome = o.optString("nome"),
                tamanho = o.optStringOrNull("tamanho"),
                preco = o.optDouble("preco", 0.0),
                precoMax = if (o.isNull("preco_max")) null else o.optDouble("preco_max"),
                grupo = grupo,
                semEstoque = o.optBoolean("sem_estoque", false),
                estoque = if (o.isNull("estoque")) null else o.optDouble("estoque"),
                variantes = o.optInt("variantes", 1),
            )
        }
    }

    /** Wizard do Consumer (ponto da carne etc.) — respostas viram item-filho. */
    @Throws(IOException::class)
    fun perguntas(base: String, codigoPdv: Int): List<Pergunta> {
        val j = getJson("$base/api/venda/perguntas?pdv=$codigoPdv")
        if (!j.optBoolean("ok")) return emptyList()
        val arr = j.optJSONArray("perguntas") ?: JSONArray()
        return (0 until arr.length()).mapNotNull { i ->
            val p = arr.optJSONObject(i) ?: return@mapNotNull null
            val ops = p.optJSONArray("opcoes") ?: JSONArray()
            Pergunta(
                codigo = p.optInt("codigo"),
                texto = p.optString("texto", "Escolha"),
                min = p.optInt("min", 0),
                max = p.optInt("max", 0),
                opcoes = (0 until ops.length()).mapNotNull { k ->
                    val o = ops.optJSONObject(k) ?: return@mapNotNull null
                    Opcao(o.optInt("codigo"), o.optString("nome"), o.optDouble("preco", 0.0))
                },
            )
        }
    }

    /** Sugestões de observação do grupo do produto ("sem cebola", "ao ponto"...). */
    fun observacoes(base: String, codigoPdv: Int): List<String> {
        return try {
            val arr = getJson("$base/api/observacoes?p=$codigoPdv").optJSONArray("sugestoes") ?: return emptyList()
            (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
        } catch (_: Exception) { emptyList() }
    }

    // -------- lançar (POST /api/venda/enviar — abre a conta se não existir) --------

    /** itens: [{codigo_pdv, qtd, obs?, respostas?[]}] — preço é SEMPRE o do servidor. */
    @Throws(IOException::class)
    fun enviar(base: String, token: String, numero: Int, itens: JSONArray): EnviarRes {
        val j = postJson("$base/api/venda/enviar", token, JSONObject().put("numero", numero).put("itens", itens))
        return EnviarRes(
            ok = j.optBoolean("ok", false),
            erro = j.optStringOrNull("erro"),
            contaPedida = j.optBoolean("conta_pedida", false),
            precisaCadastro = j.optBoolean("precisa_cadastro", false),
            total = j.optDouble("total", 0.0),
            nItens = j.optInt("n_itens", 0),
        )
    }

    // -------- baixa do pagamento feito NO terminal (POST /api/lio/pagar) --------

    /**
     * Registra no vendas-local o que a maquininha JÁ cobrou. O servidor grava
     * no PAGAMENTOS do Consumer com NSU/autorização/bandeira (conciliação
     * nível 1 com o EDI da Cielo) e deduplica pelo NSU — reenviar é seguro.
     */
    @Throws(IOException::class)
    fun lioPagar(base: String, token: String, body: JSONObject): PagarRes {
        val j = try {
            postJson("$base/api/lio/pagar", token, body)
        } catch (e: IOException) {
            // 404 = servidor da loja de versão antiga, sem a rota — não é rede.
            if ((e.message ?: "").contains("404"))
                throw IOException("Servidor da loja desatualizado (sem /api/lio/pagar) — rode a atualização do vendas-local")
            throw e
        }
        if (!j.optBoolean("ok") && j.optBoolean("sem_sessao")) throw SemSessao()
        return PagarRes(
            ok = j.optBoolean("ok", false),
            jaRegistrado = j.optBoolean("ja_registrado", false),
            pago = j.optDouble("pago", 0.0),
            saldo = j.optDouble("saldo", 0.0),
            quitada = j.optBoolean("quitada", false),
            erro = j.optStringOrNull("erro"),
        )
    }

    // -------- ações da mesa: transferir / vincular comanda / identificar --------

    /** Junta/move: comanda→mesa muda só o vínculo; mesa→mesa move TODOS os
     *  itens no Consumer (e as comandas penduradas vão junto). */
    @Throws(IOException::class)
    fun transferir(base: String, token: String, de: Int, para: Int, por: String?): JSONObject =
        postJson("$base/api/venda/transferir", token,
            JSONObject().put("de", de).put("para", para).put("por", por ?: ""))

    /** Pendura a comanda na mesa. Na CRIAÇÃO o servidor exige dono
     *  (nome + CPF ou WhatsApp); comanda existente só muda de mesa. */
    @Throws(IOException::class)
    fun vincular(base: String, token: String, mesa: Int, comanda: Int, nome: String?, cpf: String?, telefone: String?, contatoFb: Int?): JSONObject {
        val b = JSONObject().put("mesa", mesa).put("comanda", comanda)
        if (!nome.isNullOrBlank()) b.put("nome", nome)
        if (!cpf.isNullOrBlank()) b.put("cpf", cpf)
        if (!telefone.isNullOrBlank()) b.put("telefone", telefone)
        if (contatoFb != null) b.put("contato_fb", contatoFb)
        return postJson("$base/api/venda/vincular", token, b)
    }

    /** Passe de saída (exige conta ZERADA — o servidor valida e diz o que
     *  falta): 1 token com N passagens de pessoa na catraca + placas pra
     *  cancela LPR. O QR impresso carrega o próprio token. */
    @Throws(IOException::class)
    fun saidaGerar(base: String, numero: Int, adultos: Int, criancas: Int, placas: List<String>): JSONObject {
        val b = JSONObject().put("mesa", numero).put("adultos", adultos)
            .put("criancas", criancas).put("origem", "lio")
        if (placas.isNotEmpty()) b.put("placas", JSONArray(placas))
        return postJson("$base/api/saida/gerar", null, b)
    }

    /** Libera o número da comanda (zerada/paga). O servidor barra se tiver saldo. */
    @Throws(IOException::class)
    fun comandaBaixa(base: String, token: String, comanda: Int): JSONObject =
        postJson("$base/api/venda/comanda-baixa", token, JSONObject().put("comanda", comanda))

    /** Fecha a conta QUITADA (ato final do caixa: pedido fecha no Consumer e a
     *  mesa/comanda some da grade). O servidor barra se ainda faltar dinheiro. */
    @Throws(IOException::class)
    fun lioFechar(base: String, token: String, numero: Int): JSONObject =
        postJson("$base/api/lio/fechar", token, JSONObject().put("numero", numero))

    /** Fechamento do dia: o que o app registrou HOJE (qtd/total/por forma,
     *  com os NSUs) — a tela compara com as vendas do próprio terminal. */
    @Throws(IOException::class)
    fun lioResumoDia(base: String, token: String): JSONObject =
        getJson("$base/api/lio/resumo-dia", token)

    // -------- NFC-e (nota fiscal oferecida ao fechar a conta) --------

    data class NfceInfo(
        val emitida: Boolean,
        val notaNumero: Int?,
        val documentoSugerido: String?,
        val homologacao: Boolean,
    )

    /** NFC-e ligada pra esta loja? Já tem nota? CPF do cadastro? null =
     *  desligada/servidor antigo/fora do ar → o app simplesmente não pergunta. */
    fun nfceInfo(base: String, token: String, numero: Int): NfceInfo? = try {
        val j = getJson("$base/api/nfce/info?n=$numero", token)
        if (!j.optBoolean("ok") || !j.optBoolean("ativo") || j.optBoolean("sem_pedido")) null
        else NfceInfo(
            emitida = j.optBoolean("emitida"),
            notaNumero = j.optJSONObject("nota")?.optInt("numero"),
            documentoSugerido = j.optStringOrNull("documento_sugerido"),
            homologacao = j.optInt("ambiente", 2) == 2,
        )
    } catch (_: Exception) { null }

    data class NfceResultado(
        val ok: Boolean,
        val erro: String?,
        /** SEFAZ/central fora do ar: a nota ficou na FILA da loja e sai sozinha
         *  (imprime na térmica do caixa quando autorizar). Não é erro. */
        val pendente: Boolean,
        val notaNumero: Int?,
        val blocos: List<Lio.Bloco>,
    )

    /** Emite (ou reimprime — o servidor é idempotente por pedido) e devolve o
     *  DANFE em blocos pra sair na impressora da própria maquininha. Timeout
     *  longo: a cadeia loja → central → SEFAZ pode levar vários segundos. */
    @Throws(IOException::class)
    fun nfceEmitir(base: String, token: String, numero: Int, documento: String?): NfceResultado {
        val b = JSONObject().put("numero", numero).put("destino", "lio")
        if (!documento.isNullOrBlank()) b.put("documento", documento)
        val (code, resp) = http("POST", "$base/api/nfce/emitir", token, b, readTimeoutMs = 60000)
        if (code == 401) throw SemSessao()
        if (code !in 200..299) throw IOException("Servidor respondeu $code")
        val j = JSONObject(resp)
        val arr = j.optJSONArray("blocos")
        val blocos = mutableListOf<Lio.Bloco>()
        if (arr != null) for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val qr = o.optStringOrNull("qr")
            if (qr != null) blocos.add(Lio.Bloco(qr = qr))
            else blocos.add(Lio.Bloco(
                texto = o.optString("texto", ""),
                negrito = o.optBoolean("negrito", false),
                tamanho = o.optInt("tamanho", 18),
            ))
        }
        return NfceResultado(
            ok = j.optBoolean("ok"),
            erro = j.optStringOrNull("erro"),
            pendente = j.optBoolean("pendente"),
            notaNumero = j.optJSONObject("nota")?.let { if (it.isNull("numero")) null else it.optInt("numero") },
            blocos = blocos,
        )
    }

    /** Nome pelo CPF/telefone (cadastro da casa → já-atendidos → grupo → SPC). */
    fun identificarBuscar(base: String, cpf: String?, tel: String?): JSONObject? = try {
        getJson("$base/api/venda/identificar?cpf=${enc(cpf ?: "")}&tel=${enc(tel ?: "")}")
    } catch (_: Exception) { null }

    /** Carimba quem está na mesa/comanda. Mesmo body da tela do celular:
     *  contato_fb quando a consulta achou na casa; senão cadastrar=true
     *  (vira cliente no Consumer pra próxima visita). */
    @Throws(IOException::class)
    fun identificarSalvar(base: String, numero: Int, nome: String, cpf: String?, telefone: String?, contatoFb: Int?, cadastrar: Boolean): JSONObject {
        val b = JSONObject().put("numero", numero).put("nome", nome)
        if (!cpf.isNullOrBlank()) b.put("cpf", cpf)
        if (!telefone.isNullOrBlank()) b.put("telefone", telefone)
        if (contatoFb != null) b.put("contato_fb", contatoFb) else if (cadastrar) b.put("cadastrar", true)
        return postJson("$base/api/venda/identificar", null, b)
    }

    /** Body do /api/lio/pagar a partir de um pagamento aprovado no terminal. */
    fun bodyPagamento(numero: Int, p: Lio.PagamentoLio): JSONObject = JSONObject()
        .put("numero", numero)
        .put("forma", p.forma)
        .put("valor", p.valorCentavos / 100.0)
        .put("nsu", p.nsu)
        .put("autorizacao", p.autorizacao)
        .put("bandeira", p.bandeira)
}

// optString que devolve null (o padrão do org.json devolve "" ou "null").
internal fun JSONObject.optStringOrNull(key: String): String? {
    if (!has(key) || isNull(key)) return null
    val v = optString(key, "")
    return if (v.isBlank()) null else v
}
