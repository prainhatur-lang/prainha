' KDS da TV Roku: mostra na TV a fila de producao do vendas-local da loja.
' A TV so desenha - quem manda no pedido continua sendo o servidor da loja
' (a mesma fila do tablet, /api/kds). A baixa segue no tablet.
sub Main(args as dynamic)
    tela = CreateObject("roSGScreen")
    porta = CreateObject("roMessagePort")
    tela.setMessagePort(porta)

    ' o que veio na abertura (o servidor pode abrir o canal ja dizendo a praca)
    a = {}
    if args <> invalid then
        if GetInterface(args, "ifAssociativeArray") <> invalid then
            for each chave in args
                a[LCase(chave)] = args[chave]
            end for
        end if
    end if
    ' abrir com sair=1 fecha o KDS na hora: e como o instalador tira o canal da
    ' tela antes de mandar versao nova (essa TV nao aceita "apertar Home" de fora)
    if txt(a.sair) = "1" then return

    g = tela.getGlobalNode()
    g.addFields({ argumentos: a })

    cena = tela.CreateScene("KdsScene")
    tela.show()
    cena.observeField("sair", porta)

    app = CreateObject("roAppManager")
    while true
        msg = wait(20000, porta)
        t = type(msg)
        if t = "roSGScreenEvent" then
            if msg.isScreenClosed() then return
        else if t = "roSGNodeEvent" then
            if msg.getField() = "sair" then
                tela.close()
                return
            end if
        end if
        ' TV de cozinha: ninguem aperta botao, entao o protetor de tela nao pode entrar
        app.UpdateLastKeyPressTime()
    end while
end sub
