' Desenha a fila na TV. Nenhuma regra de pedido mora aqui: o que escrever e
' de que cor ja vem pronto da KdsTask. Aqui e so tamanho, lugar e controle.

sub init()
    m.top.backgroundURI = ""
    m.top.backgroundColor = "0x0b0d12FF"

    m.fontes = {}
    m.fila = m.top.findNode("fila")
    m.avisos = m.top.findNode("avisos")
    m.cab = m.top.findNode("cab")
    m.sel = m.top.findNode("sel")
    m.toast = m.top.findNode("toast")
    m.audio = m.top.findNode("audio")
    m.fxnovo = m.top.findNode("fxnovo")
    m.fxalarme = m.top.findNode("fxalarme")
    m.tarefa = m.top.findNode("tarefa")
    m.tique = m.top.findNode("tique")

    m.modelo = invalid
    m.cartoes = []
    m.pag = 0
    m.paginas = 1
    m.pagresta = 12
    m.som = true
    m.paradodesde = 0
    m.semcon = false
    m.semconrot = invalid
    m.focod = ""
    m.toastresta = 0
    m.sairresta = 0
    m.audiofalhou = false
    m.ultimosom = ""
    m.hora = ""

    montaCab()
    montaToast()

    a = {}
    if m.global.argumentos <> invalid then a = m.global.argumentos
    m.tarefa.args = a
    m.tarefa.observeField("modelo", "aoModelo")
    m.tarefa.observeField("parado", "aoParado")
    m.tarefa.observeField("somnovo", "aoSomNovo")
    m.tarefa.observeField("somalarme", "aoSomAlarme")
    m.tarefa.observeField("som", "aoPrefSom")
    m.tarefa.control = "RUN"

    ' abrir com teste=novo ou teste=alarme toca o som 3 s depois: da pra conferir
    ' o volume da TV sem o controle na mao
    m.testesom = txt(a.teste)
    m.testeresta = 3

    m.audio.observeField("state", "aoAudio")
    m.tique.observeField("fire", "aoTique")
    m.tique.control = "start"

    m.top.setFocus(true)
    desenha()
    aoTique()
end sub

' ---- ferramentas de desenho ----
function fonte(tam as float, negrito as boolean) as object
    t = Int(tam + 0.5)
    if t < 10 then t = 10
    chave = "m" + t.ToStr()
    if negrito then chave = "b" + t.ToStr()
    f = m.fontes[chave]
    if f = invalid then
        f = CreateObject("roSGNode", "Font")
        if negrito then
            f.uri = "font:BoldSystemFontFile"
        else
            f.uri = "font:MediumSystemFontFile"
        end if
        f.size = t
        m.fontes[chave] = f
    end if
    return f
end function

function rotulo(pai as object, texto as string, tam as float, negrito as boolean, cor as string) as object
    lb = pai.createChild("Label")
    lb.font = fonte(tam, negrito)
    lb.color = cor
    lb.text = texto
    return lb
end function

function caixa(pai as object, cor as string, larg as float, alt as float) as object
    r = pai.createChild("Rectangle")
    r.color = cor
    r.width = larg
    r.height = alt
    return r
end function

' quebra o texto na largura dada (ate "linhas" linhas)
sub quebra(lb as object, larg as float, linhas as integer, entre as float)
    lb.width = larg
    lb.wrap = true
    lb.maxLines = linhas
    lb.lineSpacing = entre
end sub

' Tamanho que o texto ocupa. Se a TV nao disser (devolver zero), estima pelo
' numero de letras - melhor sobrar um pouco que encavalar.
function mede(lb as object, tam as float, larg as float) as object
    r = lb.boundingRect()
    w = r.width
    h = r.height
    n = Len(lb.text)
    if larg > 0 then
        if h < tam then
            linhas = Int((n * tam * 0.56) / larg) + 1
            h = linhas * tam * 1.3
        end if
        w = larg
    else
        if w < 1 then w = n * tam * 0.56
        if h < tam then h = tam * 1.3
    end if
    return { w: w, h: h }
end function

sub limpa(g as object)
    n = g.getChildCount()
    if n > 0 then g.removeChildrenIndex(n, 0)
end sub

' ---- cabecalho ----
sub montaCab()
    caixa(m.cab, "0x151922FF", 1280, 56)
    r = caixa(m.cab, "0x2a3040FF", 1280, 2)
    r.translation = [0, 56]

    m.cloja = rotulo(m.cab, "", 18, false, "0x8f98adFF")
    m.ctit = rotulo(m.cab, "", 26, true, "0xf4f5f7FF")
    m.ccont = rotulo(m.cab, "", 22, true, "0xcfd5e2FF")
    m.ccritf = caixa(m.cab, "0xb91c1cFF", 10, 30)
    m.ccrit = rotulo(m.cab, "", 18, true, "0xffffffFF")
    m.cpagf = caixa(m.cab, "0xffd24aFF", 10, 30)
    m.cpag = rotulo(m.cab, "", 18, true, "0x1b1400FF")
    for each lb in [m.cloja, m.ctit, m.ccont, m.ccrit, m.cpag]
        lb.height = 56
        lb.vertAlign = "center"
    end for

    m.cponto = m.cab.createChild("Poster")
    m.cponto.uri = "pkg:/images/ponto.png"
    m.cponto.width = 14
    m.cponto.height = 14
    m.cponto.translation = [1066, 21]
    m.cponto.blendColor = "0x22c55eFF"
    m.cvivo = rotulo(m.cab, "", 18, false, "0xcfd5e2FF")
    m.cvivo.height = 56
    m.cvivo.vertAlign = "center"
    m.cvivo.translation = [1086, 0]
    m.chora = rotulo(m.cab, "", 26, true, "0xf4f5f7FF")
    m.chora.width = 96
    m.chora.height = 56
    m.chora.horizAlign = "right"
    m.chora.vertAlign = "center"
    m.chora.translation = [1166, 0]
end sub

' escreve o cabecalho da esquerda pra direita; se nao couber, o nome da casa cede a vez
sub cabecalho(loja as string, titulo as string, cont as string, crit as string, pag as string)
    limite = 1050
    for tentativa = 0 to 1
        x = 18
        if tentativa = 1 then loja = ""
        m.cloja.text = loja
        if loja <> "" then
            m.cloja.translation = [x, 0]
            x = x + mede(m.cloja, 18, 0).w + 12
        end if
        m.ctit.text = titulo
        m.ctit.translation = [x, 0]
        if titulo <> "" then x = x + mede(m.ctit, 26, 0).w + 16
        m.ccont.text = cont
        m.ccont.translation = [x, 0]
        if cont <> "" then x = x + mede(m.ccont, 22, 0).w + 14
        m.ccrit.text = crit
        m.ccritf.visible = (crit <> "")
        if crit <> "" then
            w = mede(m.ccrit, 18, 0).w
            m.ccritf.width = w + 20
            m.ccritf.translation = [x, 13]
            m.ccrit.translation = [x + 10, 0]
            x = x + w + 20 + 8
        end if
        m.cpag.text = pag
        m.cpagf.visible = (pag <> "")
        if pag <> "" then
            w = mede(m.cpag, 18, 0).w
            m.cpagf.width = w + 20
            m.cpagf.translation = [x, 13]
            m.cpag.translation = [x + 10, 0]
            x = x + w + 20 + 8
        end if
        if x <= limite then exit for
    end for
end sub

sub vivo()
    ok = (m.paradodesde = 0)
    mo = m.modelo
    if mo <> invalid then
        if mo.modo = "fila" then
            if mo.online = false then ok = false
        else if txt(mo.erro) <> "" then
            ok = false
        end if
    end if
    if ok then
        m.cponto.blendColor = "0x22c55eFF"
        m.cvivo.text = "ao vivo"
    else
        m.cponto.blendColor = "0xef4444FF"
        m.cvivo.text = "offline"
    end if
end sub

' ---- aviso rapido no pe da tela ----
sub montaToast()
    m.toastf = caixa(m.toast, "0xffd24aFF", 10, 54)
    m.toastl = rotulo(m.toast, "", 24, true, "0x1b1400FF")
    m.toastl.height = 54
    m.toastl.vertAlign = "center"
end sub

sub mostraToast(texto as string, seg as integer)
    m.toastl.text = texto
    w = mede(m.toastl, 24, 0).w
    m.toastf.width = w + 40
    m.toastl.translation = [20, 0]
    m.toast.translation = [Int((1280 - w - 40) / 2), 640]
    m.toast.visible = true
    m.toastresta = seg
end sub

' ---- o que chega da tarefa ----
sub aoModelo()
    m.modelo = m.tarefa.modelo
    desenha()
end sub

sub aoPrefSom()
    m.som = m.tarefa.som
end sub

sub aoParado()
    p = m.tarefa.parado
    if p > 0 then
        m.paradodesde = agora() - p
    else
        m.paradodesde = 0
    end if
    sem = (p >= 25)
    if sem <> m.semcon then
        m.semcon = sem
        desenha()
    else
        vivo()
    end if
end sub

function textoSemCon() as string
    s = agora() - m.paradodesde
    if s < 0 then s = 0
    ha = s.ToStr() + " s"
    if s >= 90 then
        mi = Int(s / 60)
        ha = mi.ToStr() + " min"
    end if
    return "SEM CONEXÃO com o servidor da loja há " + ha + " - a fila abaixo pode estar desatualizada"
end function

sub aoTique()
    h = horaAgora()
    if h <> m.hora then
        m.hora = h
        m.chora.text = h
    end if
    if m.toastresta > 0 then
        m.toastresta = m.toastresta - 1
        if m.toastresta = 0 then m.toast.visible = false
    end if
    if m.sairresta > 0 then m.sairresta = m.sairresta - 1
    if m.testesom <> "" then
        m.testeresta = m.testeresta - 1
        if m.testeresta <= 0 then
            qual = "novo"
            if m.testesom = "alarme" then qual = "alarme"
            m.testesom = ""
            toca(qual)
        end if
    end if
    if m.paginas > 1 then
        m.pagresta = m.pagresta - 1
        if m.pagresta <= 0 then vira(1)
    end if
    if m.paradodesde > 0 then
        if not m.semcon then
            if agora() - m.paradodesde >= 25 then
                m.semcon = true
                desenha()
            end if
        else if m.semconrot <> invalid then
            m.semconrot.text = textoSemCon()
        end if
    end if
end sub

' ---- som ----
sub aoSomNovo()
    toca("novo")
end sub

sub aoSomAlarme()
    toca("alarme")
end sub

sub toca(qual as string)
    if not m.som then return
    m.ultimosom = qual
    if m.audiofalhou then
        efeito(qual)
        return
    end if
    c = CreateObject("roSGNode", "ContentNode")
    c.url = "pkg:/sounds/" + qual + ".mp3"
    c.streamformat = "mp3"
    m.audio.control = "stop"
    m.audio.content = c
    m.audio.control = "play"
end sub

sub efeito(qual as string)
    if qual = "alarme" then
        m.fxalarme.control = "play"
    else
        m.fxnovo.control = "play"
    end if
end sub

' se o tocador da TV recusar o arquivo, cai pro som de efeito (o dos menus)
sub aoAudio()
    print "audio: "; m.audio.state
    if m.audio.state = "error" then
        print "audio: erro - passando pro som de efeito"
        m.audiofalhou = true
        if m.ultimosom <> "" then efeito(m.ultimosom)
    end if
end sub

' ---- desenho ----
sub desenha()
    limpa(m.fila)
    limpa(m.avisos)
    limpa(m.sel)
    m.cartoes = []
    m.semconrot = invalid
    mo = m.modelo
    vivo()
    if mo = invalid then
        m.paginas = 1
        cabecalho("", "KDS", "", "", "")
        y = faixaSemCon(58)
        lb = rotulo(m.fila, "Procurando o servidor da loja...", 34, true, "0x5b6478FF")
        lb.width = 1280
        lb.horizAlign = "center"
        lb.translation = [0, 330]
        return
    end if
    if mo.modo = "sel" then
        m.paginas = 1
        desenhaSel(mo)
        return
    end if
    desenhaFila(mo)
end sub

function faixaSemCon(y as integer) as integer
    if not m.semcon then return y
    f = caixa(m.avisos, "0x7f1d1dFF", 1280, 40)
    f.translation = [0, y]
    lb = rotulo(m.avisos, textoSemCon(), 22, true, "0xffffffFF")
    lb.width = 1244
    lb.height = 40
    lb.vertAlign = "center"
    lb.translation = [18, y]
    m.semconrot = lb
    return y + 42
end function

function desenhaAvisos(lista as object, y as integer) as integer
    for each a in lista
        corf = "0x7f1d1dFF"
        cort = "0xffffffFF"
        if a.tipo = "rec" then
            corf = "0xdc2626FF"
        else if a.tipo = "jun" then
            corf = "0x0c4a6eFF"
            cort = "0xe0f2feFF"
        end if
        f = caixa(m.avisos, corf, 1280, 10)
        f.translation = [0, y]
        x = 18
        h = 0
        t = txt(a.t)
        s = txt(a.s)
        if t <> "" then
            lt = rotulo(m.avisos, t, 24, true, cort)
            lt.translation = [x, y + 6]
            if s = "" then
                quebra(lt, 1244, 2, 2)
                h = mede(lt, 24, 1244).h
            else
                r = mede(lt, 24, 0)
                if r.w > 700 then
                    lt.width = 700
                    r.w = 700
                end if
                h = r.h
                x = x + r.w + 14
            end if
        end if
        if s <> "" then
            ls = rotulo(m.avisos, s, 20, false, cort)
            larg = 1262 - x
            quebra(ls, larg, 2, 2)
            ls.translation = [x, y + 9]
            hs = mede(ls, 20, larg).h + 3
            if hs > h then h = hs
        end if
        alt = Int(h) + 12
        f.height = alt
        y = y + alt + 2
    end for
    return y
end function

sub desenhaFila(mo as object)
    y = faixaSemCon(58)
    y = desenhaAvisos(listaDe(mo.avisos), y)
    topo = y + 8
    disp = 720 - topo - 10
    cart = listaDe(mo.cartoes)

    if cart.Count() = 0 then
        m.paginas = 1
        m.pag = 0
        meio = topo + Int(disp / 2)
        l1 = rotulo(m.fila, "Nada a produzir agora", 46, true, "0x5b6478FF")
        l1.width = 1280
        l1.horizAlign = "center"
        l1.translation = [0, meio - 50]
        l2 = rotulo(m.fila, "os pedidos aparecem aqui sozinhos", 24, false, "0x5b6478FF")
        l2.width = 1280
        l2.horizAlign = "center"
        l2.translation = [0, meio + 16]
        escreveCab()
        return
    end if

    ' 3 colunas (letra maior); nao coube tudo, 4; ainda nao, o resto vira pagina
    tenta = [3, 4]
    fixo = m.tarefa.colunas
    if fixo > 0 then tenta = [fixo]
    for i = 0 to tenta.Count() - 1
        ultima = (i = tenta.Count() - 1)
        if monta(cart, tenta[i], topo, disp, not ultima) then exit for
    end for
    if m.paginas <= 1 then
        m.pag = 0
    else if m.pag >= m.paginas then
        m.pag = 0
        m.pagresta = 12
    end if
    mostraPagina()
end sub

' devolve se coube tudo numa tela so; com "desiste" para no primeiro que sobrar
function monta(cart as object, n as integer, topo as integer, disp as integer, desiste as boolean) as boolean
    limpa(m.fila)
    m.cartoes = []
    margem = 12
    vao = 10
    e = 3.0 / n
    larg = Int((1280 - 2 * margem - vao * (n - 1)) / n)
    col = 0
    pagina = 0
    y = 0
    for each k in cart
        r = fazCartao(k, larg, e, disp)
        if y > 0 and y + r.h > disp then
            col = col + 1
            y = 0
            if col >= n then
                if desiste then return false
                col = 0
                pagina = pagina + 1
            end if
        end if
        r.no.translation = [margem + col * (larg + vao), topo + y]
        m.cartoes.Push({ no: r.no, pagina: pagina })
        y = y + r.h + vao
    end for
    m.paginas = pagina + 1
    return (pagina = 0)
end function

sub mostraPagina()
    for each c in m.cartoes
        c.no.visible = (c.pagina = m.pag)
    end for
    escreveCab()
end sub

sub escreveCab()
    mo = m.modelo
    if mo = invalid then return
    ni = inteiro(mo.nitens)
    np = inteiro(mo.npedidos)
    cont = ni.ToStr() + " a produzir · " + np.ToStr() + " pedido"
    if np <> 1 then cont = cont + "s"
    crit = ""
    nc = inteiro(mo.ncrit)
    if nc = 1 then crit = "1 estourou o prazo"
    if nc > 1 then crit = nc.ToStr() + " estouraram o prazo"
    pag = ""
    if m.paginas > 1 then
        p = m.pag + 1
        pag = "página " + p.ToStr() + " de " + m.paginas.ToStr()
    end if
    cabecalho(txt(mo.loja), txt(mo.titulo), cont, crit, pag)
end sub

sub vira(passo as integer)
    if m.paginas <= 1 then return
    p = m.pag + passo
    if p >= m.paginas then p = 0
    if p < 0 then p = m.paginas - 1
    m.pag = p
    ' a primeira pagina (os mais antigos) fica mais tempo na tela
    m.pagresta = 8
    if p = 0 then m.pagresta = 12
    mostraPagina()
end sub

' ---- um cartao (um pedido) ----
function fazCartao(k as object, larg as integer, e as float, altmax as integer) as object
    b = 2
    if k.recl = true then b = 4
    corborda = "0x39415aFF"
    corcab = "0x2d3654FF"
    if k.tipo = "delivery" then corcab = "0x1d4ed8FF"
    if k.tipo = "balcao" then corcab = "0x6d28d9FF"
    if k.estado = "atr" then
        corborda = "0xf97316FF"
        corcab = "0xc2410cFF"
    else if k.estado = "crit" then
        corborda = "0xef4444FF"
        corcab = "0xb91c1cFF"
    end if
    if k.recl = true then corborda = "0xef4444FF"

    g = m.fila.createChild("Group")
    fora = caixa(g, corborda, larg, 10)
    li = larg - 2 * b
    dentro = caixa(g, "0x1b2030FF", li, 10)
    dentro.translation = [b, b]
    pad = Int(8 * e)

    ' cabecalho: posicao na fila, mesa, tempo de espera
    hc = Int(50 * e)
    cb = caixa(g, corcab, li, hc)
    cb.translation = [b, b]
    x = b + pad
    lo = rotulo(g, txt(k.ordem), 20 * e, false, "0xf4f5f7BB")
    lo.height = hc
    lo.vertAlign = "center"
    lo.translation = [x, b]
    x = x + mede(lo, 20 * e, 0).w + Int(8 * e)
    wt = 0
    tempo = txt(k.tempo)
    if tempo <> "" then
        lt = rotulo(g, tempo, 30 * e, true, "0xffffffFF")
        wt = mede(lt, 30 * e, 0).w
        lt.height = hc
        lt.vertAlign = "center"
        lt.translation = [larg - b - pad - wt, b]
    end if
    lr = rotulo(g, txt(k.rotulo), 34 * e, true, "0xffffffFF")
    lr.width = larg - b - pad - wt - Int(10 * e) - x
    lr.height = hc
    lr.vertAlign = "center"
    lr.translation = [x, b]
    y = b + hc + Int(6 * e)

    ' etiquetas
    etq = listaDe(k.etq)
    if etq.Count() > 0 then
        he = Int(19 * e * 1.3) + Int(4 * e)
        px = Int(7 * e)
        x = b + pad
        fim = larg - b - pad
        for each q in etq
            corf = "0x39415aFF"
            cort = "0xffffffFF"
            c = txt(q.cor)
            if c = "cr" then
                corf = "0xdc2626FF"
            else if c = "at" then
                corf = "0xea580cFF"
            else if c = "pg" then
                corf = "0x7c3aedFF"
            else if c = "jt" then
                corf = "0x0369a1FF"
            else if c = "dl" then
                corf = "0x1d4ed8FF"
            else if c = "vi" then
                corf = "0x475569FF"
            else if c = "cn" then
                corf = ""
                cort = "0xaab2c5FF"
            end if
            f = invalid
            if corf <> "" then f = caixa(g, corf, 10, he)
            lb = rotulo(g, txt(q.t), 19 * e, true, cort)
            w = mede(lb, 19 * e, 0).w
            folga = px
            if corf = "" then folga = 0
            if w + 2 * folga > fim - b - pad then
                w = fim - b - pad - 2 * folga
                lb.width = w
            end if
            wc = w + 2 * folga
            if x > b + pad and x + wc > fim then
                x = b + pad
                y = y + he + Int(4 * e)
            end if
            if f <> invalid then
                f.width = wc
                f.translation = [x, y]
            end if
            lb.height = he
            lb.vertAlign = "center"
            lb.translation = [x + folga, y]
            x = x + wc + Int(6 * e)
        end for
        y = y + he + Int(6 * e)
    end if

    ' itens; o que nao couber na altura da tela vira "+ N - veja no tablet"
    linhas = listaDe(k.linhas)
    limite = altmax - b - Int(4 * e)
    hmais = Int(20 * e * 1.3) + Int(6 * e)
    feitas = []
    cortou = false
    primeiro = true
    for each ln in linhas
        r = fazLinha(g, ln, li, e, primeiro)
        if y + r.h > limite then
            g.removeChild(r.no)
            cortou = true
            exit for
        end if
        r.no.translation = [b, y]
        feitas.Push({ no: r.no, y: y })
        y = y + r.h
        primeiro = (ln.tipo = "praca")
    end for
    if cortou then
        while feitas.Count() > 0 and y + hmais > limite
            u = feitas.Pop()
            g.removeChild(u.no)
            y = u.y
        end while
        falta = 0
        for i = feitas.Count() to linhas.Count() - 1
            if linhas[i].tipo = "item" then falta = falta + 1
        end for
        s = "+ continua - veja no tablet"
        if falta = 1 then s = "+ 1 item - veja no tablet"
        if falta > 1 then s = "+ " + falta.ToStr() + " itens - veja no tablet"
        lm = rotulo(g, s, 20 * e, true, "0xffd24aFF")
        lm.width = li - 2 * pad
        lm.height = hmais
        lm.vertAlign = "center"
        lm.translation = [b + pad, y]
        y = y + hmais
    end if

    y = y + Int(4 * e)
    alt = y + b
    fora.height = alt
    dentro.height = alt - 2 * b
    return { no: g, h: alt }
end function

' uma linha do cartao (praca, item, complemento, observacao ou nota)
function fazLinha(g as object, ln as object, li as integer, e as float, primeiro as boolean) as object
    lg = g.createChild("Group")
    pad = Int(8 * e)
    qw = Int(54 * e)
    tx = pad + qw
    tw = li - tx - pad
    entre = Int(2 * e)
    t = txt(ln.tipo)

    if t = "praca" then
        h = Int(18 * e * 1.3) + Int(8 * e)
        caixa(lg, "0x11162aFF", li, h)
        cor = "0xaab4ffFF"
        if ln.cor = "prat" then cor = "0xfdba74FF"
        if ln.cor = "prcr" then cor = "0xfca5a5FF"
        lb = rotulo(lg, UCase(txt(ln.t)), 18 * e, true, cor)
        lb.width = li - 2 * pad
        lb.height = h
        lb.vertAlign = "center"
        lb.translation = [pad, 0]
        return { no: lg, h: h }
    end if

    fd = invalid
    fundo = txt(ln.fundo)
    if fundo = "seg" then fd = caixa(lg, "0x3b2a0aFF", li, 10)
    if fundo = "rcl" then fd = caixa(lg, "0x3f1217FF", li, 10)

    h = 0
    if t = "item" then
        if not primeiro then
            s = caixa(lg, "0x2a3040FF", li - 2 * pad, 1)
            s.translation = [pad, 0]
        end if
        cima = Int(5 * e)
        lq = rotulo(lg, txt(ln.q), 28 * e, true, "0xffd24aFF")
        lq.translation = [pad, cima]
        l2 = rotulo(lg, txt(ln.t), 28 * e, true, "0xf4f5f7FF")
        quebra(l2, tw, 3, entre)
        l2.translation = [tx, cima]
        h = cima + Int(mede(l2, 28 * e, tw).h) + Int(3 * e)
    else if t = "sub" then
        lq = rotulo(lg, "+", 22 * e, true, "0x8f98adFF")
        lq.translation = [pad + Int(qw * 0.5), 0]
        l2 = rotulo(lg, txt(ln.t), 22 * e, false, "0xcfd5e2FF")
        quebra(l2, tw, 2, entre)
        l2.translation = [tx, 0]
        h = Int(mede(l2, 22 * e, tw).h) + Int(3 * e)
    else if t = "mod" then
        dx = Int(6 * e)
        dy = Int(3 * e)
        cx = caixa(lg, "0xffd24aFF", tw, 10)
        cx.translation = [tx, Int(2 * e)]
        l2 = rotulo(lg, txt(ln.t), 22 * e, true, "0x1b1400FF")
        quebra(l2, tw - 2 * dx, 4, entre)
        l2.translation = [tx + dx, Int(2 * e) + dy]
        hh = Int(mede(l2, 22 * e, tw - 2 * dx).h) + 2 * dy
        cx.height = hh
        h = hh + Int(2 * e) + Int(4 * e)
    else
        cor = "0x7dd3fcFF"
        if ln.cor = "rc" then cor = "0xfca5a5FF"
        if ln.cor = "sg" then cor = "0xfdba74FF"
        l2 = rotulo(lg, txt(ln.t), 18 * e, true, cor)
        quebra(l2, tw, 3, entre)
        l2.translation = [tx, 0]
        h = Int(mede(l2, 18 * e, tw).h) + Int(4 * e)
    end if
    if fd <> invalid then fd.height = h
    return { no: lg, h: h }
end function

' ---- escolha da praca (primeira vez, ou pelo botao * do controle) ----
sub desenhaSel(mo as object)
    cabecalho(txt(mo.loja), "KDS da TV", "", "", "")
    y = faixaSemCon(58)
    lista = listaDe(mo.lista)

    lt = rotulo(m.sel, "Qual praça esta TV vai mostrar?", 34, true, "0xf4f5f7FF")
    lt.translation = [60, y + 22]

    erro = txt(mo.erro)
    if erro <> "" then
        le = rotulo(m.sel, erro, 24, true, "0xfca5a5FF")
        quebra(le, 1160, 3, 4)
        le.translation = [60, y + 90]
    end if

    total = lista.Count()
    if total > 0 then
        foco = 0
        for i = 0 to total - 1
            if lista[i].codigo = m.focod then foco = i
        end for
        m.focod = lista[foco].codigo

        ' cabem 9 linhas; com mais que isso a lista acompanha o foco
        cabem = 9
        ini = 0
        if total > cabem then
            ini = foco - 4
            if ini < 0 then ini = 0
            if ini > total - cabem then ini = total - cabem
        end if
        fim = ini + cabem - 1
        if fim > total - 1 then fim = total - 1
        ly = y + 86
        for i = ini to fim
            a = lista[i]
            corf = "0x1b2030FF"
            if i = foco then corf = "0x2d3654FF"
            f = caixa(m.sel, corf, 760, 52)
            f.translation = [60, ly]
            if i = foco then
                bar = caixa(m.sel, "0xffd24aFF", 8, 52)
                bar.translation = [60, ly]
            end if
            ln = rotulo(m.sel, txt(a.nome), 28, true, "0xf4f5f7FF")
            ln.width = 480
            ln.height = 52
            ln.vertAlign = "center"
            ln.translation = [84, ly]
            n = inteiro(a.n)
            cor = "0x8f98adFF"
            if n > 0 then cor = "0xffd24aFF"
            lq = rotulo(m.sel, n.ToStr() + " a produzir", 22, true, cor)
            lq.width = 220
            lq.height = 52
            lq.horizAlign = "right"
            lq.vertAlign = "center"
            lq.translation = [580, ly]
            ly = ly + 58
        end for
    end if

    pe = "Cima e baixo escolhem · OK confirma"
    if txt(mo.servidor) <> "" then pe = pe + " · servidor da loja: " + txt(mo.servidor)
    lp = rotulo(m.sel, pe, 20, false, "0x8f98adFF")
    lp.translation = [60, 684]
end sub

sub moveFoco(passo as integer)
    mo = m.modelo
    lista = listaDe(mo.lista)
    total = lista.Count()
    if total = 0 then return
    foco = 0
    for i = 0 to total - 1
        if lista[i].codigo = m.focod then foco = i
    end for
    foco = foco + passo
    if foco < 0 then foco = total - 1
    if foco >= total then foco = 0
    m.focod = lista[foco].codigo
    limpa(m.sel)
    limpa(m.avisos)
    desenhaSel(mo)
end sub

sub escolhe()
    mo = m.modelo
    lista = listaDe(mo.lista)
    for each a in lista
        if a.codigo = m.focod then
            mostraToast("Abrindo " + txt(a.nome) + "...", 3)
            m.pag = 0
            m.pagresta = 12
            m.tarefa.escolha = txt(a.codigo)
            return
        end if
    end for
end sub

' ---- controle remoto ----
function onKeyEvent(tecla as string, apertou as boolean) as boolean
    ' Voltar so sai no segundo aperto: TV de cozinha nao pode sair do KDS num esbarrao
    if tecla = "back" then
        if apertou then
            if m.sairresta > 0 then
                m.top.sair = true
            else
                m.sairresta = 4
                mostraToast("Aperte Voltar de novo para sair do KDS", 4)
            end if
        end if
        return true
    end if
    if not apertou then return false

    mo = m.modelo
    if mo = invalid then return false

    if mo.modo = "sel" then
        if tecla = "up" then
            moveFoco(-1)
        else if tecla = "down" then
            moveFoco(1)
        else if tecla = "OK" then
            escolhe()
        else
            return false
        end if
        return true
    end if

    if tecla = "left" or tecla = "rewind" then
        vira(-1)
    else if tecla = "right" or tecla = "fastforward" then
        vira(1)
    else if tecla = "options" then
        mostraToast("Voltando pra lista de praças...", 3)
        m.tarefa.escolha = ""
    else if tecla = "OK" then
        m.som = not m.som
        if m.som then
            m.tarefa.prefsom = "1"
            mostraToast("Som LIGADO", 3)
            toca("novo")
        else
            m.tarefa.prefsom = "0"
            mostraToast("Som DESLIGADO (OK liga de novo)", 3)
        end if
    else
        return false
    end if
    return true
end function
