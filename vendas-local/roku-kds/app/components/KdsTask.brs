' Busca a fila no servidor da loja e monta o retrato que a tela desenha.
' A regra e a mesma da tela /tv do vendas-local (funcoes junta, cartao e
' avisosHTML de la) - mexeu la, mexe aqui.

sub init()
    m.top.functionName = "laco"
end sub

sub laco()
    m.porta = CreateObject("roMessagePort")
    m.top.observeField("escolha", m.porta)
    m.top.observeField("prefsom", m.porta)
    m.reg = CreateObject("roRegistrySection", "kds")

    leConfig()
    m.loja = ""
    m.comandade = 0
    m.temconfig = false
    m.vistos = invalid
    m.crit = {}
    m.recs = invalid
    m.alarmeem = 0
    m.inicio = agora()
    m.ultok = 0
    m.sig = ""

    while true
        if not m.temconfig then leLoja()
        espera = 5000
        if m.areas = "" then
            cicloSel()
            espera = 8000
        else
            cicloFila()
        end if
        msg = wait(espera, m.porta)
        if type(msg) = "roSGNodeEvent" then
            campo = msg.getField()
            if campo = "escolha" then
                trocaAreas(txt(msg.getData()))
            else if campo = "prefsom" then
                guarda("som", txt(msg.getData()))
            end if
        end if
    end while
end sub

' ---- configuracao: o endereco do servidor vem no pacote; a praca, do controle ----
sub leConfig()
    m.servidor = ""
    m.areas = ""
    colunas = 0
    j = ParseJson(ReadAsciiFile("pkg:/config.json"))
    if ehMapa(j) then
        m.servidor = txt(j.servidor)
        m.areas = limpaAreas(txt(j.area))
        colunas = inteiro(j.colunas)
    end if
    if m.reg.Exists("area") then m.areas = limpaAreas(m.reg.Read("area"))
    som = true
    if m.reg.Exists("som") then som = (m.reg.Read("som") <> "0")
    a = m.top.args
    if ehMapa(a) then
        if txt(a.servidor) <> "" then m.servidor = txt(a.servidor)
        if txt(a.area) <> "" then
            m.areas = limpaAreas(txt(a.area))
            guarda("area", m.areas)
        end if
        if txt(a.colunas) <> "" then colunas = inteiro(a.colunas)
        if txt(a.som) = "0" then som = false
    end if
    ' barra sobrando no fim do endereco
    while Len(m.servidor) > 0 and Right(m.servidor, 1) = "/"
        m.servidor = Left(m.servidor, Len(m.servidor) - 1)
    end while
    if colunas < 1 or colunas > 6 then colunas = 0
    m.top.colunas = colunas
    m.top.som = som
end sub

' "1, 3" -> "1,3" ; "todas" -> "todas" ; lixo -> ""
function limpaAreas(s as string) as string
    s = LCase(s.Trim())
    if s = "todas" then return s
    saida = ""
    for each p in s.Split(",")
        p = p.Trim()
        if p <> "" then
            n = p.ToInt()
            if n > 0 or p = "0" then
                if saida <> "" then saida = saida + ","
                saida = saida + n.ToStr()
            end if
        end if
    end for
    return saida
end function

sub guarda(chave as string, valor as string)
    if valor = "" then
        if m.reg.Exists(chave) then m.reg.Delete(chave)
    else
        m.reg.Write(chave, valor)
    end if
    m.reg.Flush()
end sub

sub trocaAreas(v as string)
    m.areas = limpaAreas(v)
    guarda("area", m.areas)
    m.vistos = invalid
    m.crit = {}
    m.recs = invalid
    m.sig = ""
end sub

' nome da casa e a partir de que numero e comanda (pra escrever MESA/COMANDA nos avisos)
sub leLoja()
    d = pega(m.servidor + "/api/config")
    if not ehMapa(d) then return
    m.loja = txt(d.loja)
    m.comandade = inteiro(d.comanda_min)
    m.temconfig = true
end sub

' ---- rede ----
function pega(url as string) as dynamic
    x = CreateObject("roUrlTransfer")
    p = CreateObject("roMessagePort")
    x.SetMessagePort(p)
    x.SetUrl(url)
    ' o servidor da loja reconhece a TV por aqui e passa a abrir o KDS nela sozinho
    x.AddHeader("X-Kds-Tv", "roku")
    if not x.AsyncGetToString() then return invalid
    ev = wait(8000, p)
    if type(ev) <> "roUrlEvent" then
        x.AsyncCancel()
        return invalid
    end if
    if ev.GetResponseCode() <> 200 then return invalid
    s = ev.GetString()
    if s = "" then return invalid
    return ParseJson(s)
end function

sub publica(mo as object)
    s = FormatJson(mo)
    if s = m.sig then return
    m.sig = s
    m.top.modelo = mo
end sub

sub falhou()
    base = m.ultok
    if base = 0 then base = m.inicio
    p = agora() - base
    if p < 1 then p = 1
    m.top.parado = p
end sub

' ---- lista de pracas (a TV ainda nao sabe o que mostrar) ----
sub cicloSel()
    mo = { modo: "sel", loja: m.loja, servidor: m.servidor, lista: [], erro: "" }
    d = pega(m.servidor + "/api/areas")
    if not ehMapa(d) then
        mo.erro = "Sem conexão com o servidor da loja (" + m.servidor + ") - tentando de novo..."
        publica(mo)
        return
    end if
    ' ordem fixa (nome): a do servidor muda com o movimento e o botao fugiria do foco
    comuns = []
    orfas = []
    total = 0
    for each a in listaDe(d.areas)
        n = inteiro(a.a_produzir)
        total = total + n
        linha = { codigo: txt(a.codigo), nome: txt(a.nome), n: n }
        if verd(a.orfa) then
            orfas.Push(linha)
        else
            comuns.Push(linha)
        end if
    end for
    comuns.SortBy("nome")
    for each l in comuns
        mo.lista.Push(l)
    end for
    for each l in orfas
        mo.lista.Push(l)
    end for
    mo.lista.Push({ codigo: "todas", nome: "Todas as praças juntas", n: total })
    publica(mo)
end sub

' ---- a fila ----
sub cicloFila()
    todas = (m.areas = "todas")
    cods = []
    if todas then
        ' as pracas com algo a produzir ou parado no passe + a "sem praca",
        ' que tambem traz os cancelados
        d = pega(m.servidor + "/api/areas")
        if not ehMapa(d) then
            falhou()
            return
        end if
        for each a in listaDe(d.areas)
            n = inteiro(a.codigo)
            if num(a.a_produzir) > 0 or num(a.a_entregar) > 0 then
                if not temNum(cods, n) then cods.Push(n)
            end if
        end for
        if not temNum(cods, 0) then cods.Push(0)
    else
        for each p in m.areas.Split(",")
            cods.Push(p.ToInt())
        end for
    end if

    rs = []
    for each c in cods
        r = pega(m.servidor + "/api/kds?area=" + c.ToStr())
        if not ehMapa(r) then
            falhou()
            return
        end if
        rs.Push(r)
    end for

    if not todas then
        if mudouPraca(cods, rs) then return
    end if

    m.ultok = agora()
    m.top.parado = 0
    multi = todas or cods.Count() > 1
    jj = junta(rs, multi)
    sons(jj)
    publica(modeloFila(jj, todas))
end sub

' praca que saiu do cadastro: a TV vai sozinha pra que ficou no lugar (ou pra lista)
function mudouPraca(cods as object, rs as object) as boolean
    mudou = false
    novas = []
    for i = 0 to cods.Count() - 1
        d = rs[i]
        p = cods[i]
        fica = true
        if verd(d.sumiu) then
            mudou = true
            fica = false
        else if d.mudou_para <> invalid then
            if inteiro(d.mudou_para) <> p then
                mudou = true
                p = inteiro(d.mudou_para)
            end if
        end if
        if fica then
            if not temNum(novas, p) then novas.Push(p)
        end if
    end for
    if not mudou then return false
    s = ""
    for each n in novas
        if s <> "" then s = s + ","
        s = s + n.ToStr()
    end for
    trocaAreas(s)
    return true
end function

' Um cartao por PEDIDO (mesa + via). Com mais de uma praca na mesma TV os itens
' vem separados por praca dentro do cartao. Reclamacao e cancelado aparecem uma
' vez so, mesmo que venham na resposta de varias pracas.
function junta(rs as object, multi as boolean) as object
    jj = { lista: [], nitens: 0, esperando: [], recs: [], cans: [], online: true, nomes: [], multi: multi }
    mapa = {}
    recid = {}
    canid = {}
    espid = {}
    for each r in rs
        pn = ""
        if ehMapa(r.area) then pn = txt(r.area.nome)
        jj.nomes.Push(pn)
        jj.nitens = jj.nitens + inteiro(r["nItens"])
        if r.online <> invalid then
            if not verd(r.online) then jj.online = false
        end if

        for each c in listaDe(r.comandas)
            k = txt(c.codigo) + ":" + inteiro(c.rodada).ToStr()
            mm = mapa[k]
            if mm = invalid then
                tp = txt(c.tipo)
                if tp = "" then tp = "mesa"
                mm = {
                    codigo: txt(c.codigo), rodada: inteiro(c.rodada), numero: c.numero, nome: txt(c.nome),
                    tipo: tp, rotulo: txt(c.rotulo), chegada: txt(c.chegada),
                    fechada: verd(c.fechada_em), fechadamin: inteiro(c.fechada_min), paga: verd(c.paga),
                    espera: c.espera_min, prazo: inteiro(c.prazo_min),
                    atrasado: verd(c.atrasado), critico: verd(c.critico), reclamou: verd(c.reclamou),
                    grupos: [], ord: jj.lista.Count()
                }
                mapa[k] = mm
                jj.lista.Push(mm)
            else
                if c.espera_min <> invalid then
                    if mm.espera = invalid then
                        mm.espera = c.espera_min
                    else if num(c.espera_min) > num(mm.espera) then
                        mm.espera = c.espera_min
                    end if
                end if
                ch = txt(c.chegada)
                if ch <> "" then
                    if mm.chegada = "" then
                        mm.chegada = ch
                    else if ch < mm.chegada then
                        mm.chegada = ch
                    end if
                end if
                if verd(c.atrasado) then mm.atrasado = true
                if verd(c.critico) then mm.critico = true
                if verd(c.reclamou) then mm.reclamou = true
            end if
            mm.grupos.Push({ praca: pn, itens: listaDe(c.itens), atrasado: verd(c.atrasado), critico: verd(c.critico) })
        end for

        for each e in listaDe(r.esperando)
            id = txt(e.item_codigo)
            if not espid.DoesExist(id) then
                espid[id] = true
                jj.esperando.Push({ item: txt(e.item), numero: e.numero, praca: txt(e.praca) })
            end if
        end for

        for each x in listaDe(r.cancelados)
            id = txt(x.id)
            if not canid.DoesExist(id) then
                canid[id] = true
                jj.cans.Push({ numero: x.numero, status: txt(x.status_item), nome: txt(x.nome), minatras: inteiro(x.min_atras), motivo: txt(x.motivo) })
            end if
        end for

        ' reclamacao: o servidor conta o que falta DAQUELA praca (producao/passe) -
        ' somando as pracas desta TV da o retrato do que ela enxerga
        for each q in listaDe(r.reclamacoes)
            id = txt(q.id)
            a = recid[id]
            if a = invalid then
                a = { id: id, mesa: q.mesa, texto: txt(q.texto), hamin: inteiro(q.ha_min), temconta: false, producao: 0, passe: 0, passemin: 0 }
                recid[id] = a
                jj.recs.Push(a)
            end if
            if q.producao <> invalid then
                a.temconta = true
                a.producao = a.producao + inteiro(q.producao)
                a.passe = a.passe + inteiro(q.passe)
                if inteiro(q.passe_min) > a.passemin then a.passemin = inteiro(q.passe_min)
            end if
        end for
    end for

    ' uma praca so: a ordem e a do servidor (reclamou primeiro, depois quem chegou
    ' antes). Varias: refaz o mesmo criterio com tudo junto.
    if multi then ordena(jj.lista)
    return jj
end function

sub ordena(l as object)
    n = l.Count()
    for i = 1 to n - 1
        x = l[i]
        k = i - 1
        while k >= 0
            if not vemAntes(x, l[k]) then exit while
            l[k + 1] = l[k]
            k = k - 1
        end while
        l[k + 1] = x
    end for
end sub

function vemAntes(a as object, b as object) as boolean
    ra = 1
    if a.reclamou then ra = 0
    rb = 1
    if b.reclamou then rb = 0
    if ra <> rb then return ra < rb
    ca = a.chegada
    if ca = "" then ca = "9999"
    cb = b.chegada
    if cb = "" then cb = "9999"
    if ca <> cb then return ca < cb
    return a.ord < b.ord
end function

' ---- avisos sonoros: pedido novo apita; prazo estourado e reclamacao alarmam ----
sub sons(jj as object)
    atual = {}
    novo = false
    for each c in jj.lista
        for each g in c.grupos
            for each it in g.itens
                id = txt(it.item_codigo)
                if id <> "" then
                    atual[id] = true
                    if m.vistos <> invalid then
                        if not m.vistos.DoesExist(id) then novo = true
                    end if
                end if
            end for
        end for
    end for
    m.vistos = atual ' primeira carga nao apita
    if novo then m.top.somnovo = m.top.somnovo + 1

    ' estourou o prazo: alarma na hora e repete a cada 45 s enquanto houver
    at = {}
    tem = false
    nova = false
    for each c in jj.lista
        if c.critico then
            k = c.codigo + ":" + c.rodada.ToStr()
            at[k] = true
            tem = true
            if not m.crit.DoesExist(k) then nova = true
        end if
    end for
    m.crit = at
    alarma = false
    if tem then
        if nova then
            alarma = true
        else if agora() - m.alarmeem >= 45 then
            alarma = true
        end if
    end if

    ids = {}
    novarec = false
    for each r in jj.recs
        ids[r.id] = true
        if m.recs <> invalid then
            if not m.recs.DoesExist(r.id) then novarec = true
        end if
    end for
    m.recs = ids
    if novarec then alarma = true

    if alarma then
        m.alarmeem = agora()
        m.top.somalarme = m.top.somalarme + 1
    end if
end sub

' ---- o retrato pra tela: so texto e cor, nada de regra ----
function modeloFila(jj as object, todas as boolean) as object
    mo = { modo: "fila", loja: m.loja, nitens: jj.nitens, npedidos: jj.lista.Count(), online: jj.online }
    if todas then
        mo.titulo = "Todas as praças"
    else
        t = ""
        for each n in jj.nomes
            if t <> "" then t = t + " + "
            t = t + n
        end for
        mo.titulo = t
    end if
    crit = 0
    cart = []
    i = 0
    for each c in jj.lista
        if c.critico then crit = crit + 1
        cart.Push(cartaoDe(c, i, jj))
        i = i + 1
    end for
    mo.ncrit = crit
    mo.cartoes = cart
    mo.avisos = avisosDe(jj)
    return mo
end function

function esperandoNesta(es as object, numero as dynamic) as boolean
    for each e in es
        if inteiro(e.numero) = inteiro(numero) then return true
    end for
    return false
end function

function cartaoDe(c as object, idx as integer, jj as object) as object
    n = idx + 1
    k = { ordem: n.ToStr() + "º", rotulo: c.rotulo, tempo: fmtMin(c.espera), tipo: c.tipo, estado: "norm", recl: c.reclamou, etq: [], linhas: [] }
    if c.critico then
        k.estado = "crit"
    else if c.atrasado then
        k.estado = "atr"
    end if

    if c.nome <> "" then k.etq.Push({ t: c.nome, cor: "cn" })
    if c.tipo = "delivery" then k.etq.Push({ t: "delivery", cor: "dl" })
    ' prazo e por praca: com as pracas juntas no cartao o numero sai da etiqueta
    pz = 0
    if c.grupos.Count() = 1 then pz = c.prazo
    if c.critico then
        s = "ESTOUROU"
        if pz > 0 then s = s + " · prazo " + pz.ToStr() + "min"
        k.etq.Push({ t: s, cor: "cr" })
    else if c.atrasado then
        s = "atrasado"
        if pz > 0 then s = s + " · " + pz.ToStr() + "min"
        k.etq.Push({ t: s, cor: "at" })
    end if
    if c.reclamou then k.etq.Push({ t: "RECLAMOU · adiantar", cor: "cr" })
    if c.fechada then
        s = "conta fechada"
        if c.paga then s = "já pagou"
        if c.fechadamin > 0 then s = s + " · há " + c.fechadamin.ToStr() + "min"
        k.etq.Push({ t: s, cor: "pg" })
    end if
    if esperandoNesta(jj.esperando, c.numero) then k.etq.Push({ t: "sai junto", cor: "jt" })
    if c.rodada > 0 and c.chegada <> "" then
        v = c.rodada + 1
        k.etq.Push({ t: v.ToStr() + "ª via · " + horaDe(c.chegada), cor: "vi" })
    end if

    for each g in c.grupos
        if jj.multi then
            s = g.praca
            cor = "pr"
            if g.critico then
                s = s + " · estourou"
                cor = "prcr"
            else if g.atrasado then
                s = s + " · atrasado"
                cor = "prat"
            end if
            k.linhas.Push({ tipo: "praca", t: s, cor: cor })
        end if
        for each it in g.itens
            linhasDoItem(k.linhas, it)
        end for
    end for
    return k
end function

sub linhasDoItem(ls as object, it as object)
    if inteiro(it.tipo) = 2 then
        ' complemento (molho, acompanhamento): sai junto com o prato de cima
        ls.Push({ tipo: "sub", q: "+", t: txt(it.nome) })
        if verd(it.modificado) then ls.Push({ tipo: "mod", t: txt(it.detalhes) })
        return
    end if
    q = num(it.quantidade)
    if q <= 0 then q = 1
    segura = ehMapa(it.esperando_par)
    fundo = ""
    if segura then fundo = "seg"
    if verd(it.reclamado) then fundo = "rcl"
    ls.Push({ tipo: "item", q: numTexto(q) + "x", t: txt(it.nome), fundo: fundo })
    if verd(it.reclamado) then ls.Push({ tipo: "nota", t: "cliente reclamou", cor: "rc", fundo: fundo })
    if verd(it.modificado) then ls.Push({ tipo: "mod", t: txt(it.detalhes), fundo: fundo })
    if segura then
        ep = it.esperando_par
        s = "O PAR JÁ ESTÁ PRONTO no " + txt(ep.praca)
        if txt(ep.item) <> "" then s = s + " (" + txt(ep.item) + ")"
        s = s + " - este item está segurando"
        ls.Push({ tipo: "nota", t: s, cor: "sg", fundo: fundo })
    else if verd(it.pareado) then
        ls.Push({ tipo: "nota", t: "sai junto com outra praça", cor: "pa", fundo: fundo })
    end if
end sub

function ondeFica(n as dynamic) as string
    v = inteiro(n)
    if m.comandade > 0 and v >= m.comandade then return "COMANDA " + v.ToStr()
    return "MESA " + v.ToStr()
end function

' mesmo criterio do tablet: "adiante" pra quem ja fez nao resolve
function recAcao(r as object) as string
    if not r.temconta then return "adiante o que for dessa mesa."
    if r.producao > 0 then
        s = "adiante o que for dessa mesa"
        if r.passe > 0 then s = s + " (" + r.passe.ToStr() + " já pronto no passe)"
        return s + "."
    end if
    if r.passe > 0 then
        s = "já está pronto, PARADO NO PASSE"
        if r.passemin > 0 then s = s + " há " + r.passemin.ToStr() + " min"
        return s + " - chame quem entrega."
    end if
    return "nada dessa mesa pendente aqui - confira com o garçom."
end function

' no maximo 3 de cada: faixa demais empurra a fila pra fora da tela
function avisosDe(jj as object) as object
    av = []
    cs = jj.cans
    n = cs.Count()
    if n > 3 then n = 3
    for i = 0 to n - 1
        c = cs[i]
        t = ondeFica(c.numero) + " - "
        if c.status = "pedido" then
            t = t + "PEDIDO INTEIRO CANCELADO"
        else
            nome = c.nome
            if nome = "" then nome = "item"
            t = t + "CANCELADO: " + nome
        end if
        s = "agora"
        if c.minatras > 0 then s = "há " + c.minatras.ToStr() + " min"
        if c.motivo <> "" then s = s + " · " + c.motivo
        s = s + " - NÃO produzir - tirar da fila"
        av.Push({ tipo: "can", t: t, s: s })
    end for
    if cs.Count() > n then
        resto = cs.Count() - n
        av.Push({ tipo: "can", t: "", s: "+ " + resto.ToStr() + " cancelado(s) - veja no tablet" })
    end if

    rr = jj.recs
    n = rr.Count()
    if n > 3 then n = 3
    for i = 0 to n - 1
        r = rr[i]
        t = "SEM MESA"
        if verd(r.mesa) then t = ondeFica(r.mesa)
        t = t + " RECLAMOU"
        if r.hamin > 0 then t = t + " · há " + fmtMin(r.hamin)
        s = "Cliente reclamou"
        if r.texto <> "" then s = r.texto
        av.Push({ tipo: "rec", t: t, s: s + " - " + recAcao(r) })
    end for
    if rr.Count() > n then
        resto = rr.Count() - n
        av.Push({ tipo: "rec", t: "", s: "+ " + resto.ToStr() + " reclamação(ões) - veja no tablet" })
    end if

    es = jj.esperando
    if es.Count() > 0 then
        n = es.Count()
        if n > 3 then n = 3
        t = "SAI JUNTO - "
        for i = 0 to n - 1
            e = es[i]
            if i > 0 then t = t + " · "
            onde = "mesa "
            if m.comandade > 0 and inteiro(e.numero) >= m.comandade then onde = "comanda "
            pr = e.praca
            if pr = "" then pr = "outra praça"
            t = t + e.item + " (" + onde + inteiro(e.numero).ToStr() + ") - o par já saiu no " + pr
        end for
        if es.Count() > n then
            resto = es.Count() - n
            t = t + " · + " + resto.ToStr()
        end if
        av.Push({ tipo: "jun", t: t, s: "" })
    end if
    return av
end function
