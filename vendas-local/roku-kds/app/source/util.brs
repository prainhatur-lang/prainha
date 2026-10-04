' Ajudas comuns (a resposta do servidor vem com numero as vezes em texto,
' campo que falta, verdadeiro/falso misturado - aqui tudo vira um tipo so).

function ehTexto(x as dynamic) as boolean
    if x = invalid then return false
    return GetInterface(x, "ifString") <> invalid
end function

function ehLista(x as dynamic) as boolean
    if x = invalid then return false
    return GetInterface(x, "ifArray") <> invalid
end function

function ehMapa(x as dynamic) as boolean
    if x = invalid then return false
    return GetInterface(x, "ifAssociativeArray") <> invalid
end function

function listaDe(x as dynamic) as object
    if ehLista(x) then return x
    return []
end function

function txt(x as dynamic) as string
    if x = invalid then return ""
    if GetInterface(x, "ifString") <> invalid then return x
    if GetInterface(x, "ifBoolean") <> invalid then
        if x then return "1"
        return "0"
    end if
    if GetInterface(x, "ifInt") <> invalid then return x.ToStr()
    if GetInterface(x, "ifLongInt") <> invalid then return x.ToStr()
    if GetInterface(x, "ifFloat") <> invalid then return numTexto(x)
    if GetInterface(x, "ifDouble") <> invalid then return numTexto(x)
    return ""
end function

function num(x as dynamic) as float
    if x = invalid then return 0
    if GetInterface(x, "ifString") <> invalid then return Val(x)
    if GetInterface(x, "ifBoolean") <> invalid then
        if x then return 1
        return 0
    end if
    if GetInterface(x, "ifInt") <> invalid then return x * 1.0
    if GetInterface(x, "ifFloat") <> invalid then return x * 1.0
    if GetInterface(x, "ifDouble") <> invalid then return x * 1.0
    if GetInterface(x, "ifLongInt") <> invalid then return x * 1.0
    return 0
end function

function inteiro(x as dynamic) as integer
    return Int(num(x))
end function

' 2 -> "2", 0.5 -> "0.5"
function numTexto(x as dynamic) as string
    v = num(x)
    i = Int(v)
    if v = i then return i.ToStr()
    s = Str(v)
    return s.Trim()
end function

' o "se (x)" do JavaScript
function verd(x as dynamic) as boolean
    if x = invalid then return false
    if GetInterface(x, "ifBoolean") <> invalid then return x
    if GetInterface(x, "ifString") <> invalid then return x <> ""
    if GetInterface(x, "ifInt") <> invalid then return x <> 0
    if GetInterface(x, "ifFloat") <> invalid then return x <> 0
    if GetInterface(x, "ifDouble") <> invalid then return x <> 0
    return true
end function

function dois(n as integer) as string
    if n < 10 then return "0" + n.ToStr()
    return n.ToStr()
end function

function fmtMin(x as dynamic) as string
    if x = invalid then return ""
    v = inteiro(x)
    if v < 60 then return v.ToStr() + " min"
    h = Int(v / 60)
    return h.ToStr() + "h" + dois(v mod 60)
end function

function agora() as integer
    d = CreateObject("roDateTime")
    return d.AsSeconds()
end function

function horaAgora() as string
    d = CreateObject("roDateTime")
    d.ToLocalTime()
    return dois(d.GetHours()) + ":" + dois(d.GetMinutes())
end function

' "2026-10-04T15:55:23.157Z" -> "12:55" (hora da TV)
function horaDe(iso as dynamic) as string
    if not ehTexto(iso) then return ""
    if Len(iso) < 19 then return ""
    d = CreateObject("roDateTime")
    d.FromISO8601String(Left(iso, 19))
    d.ToLocalTime()
    return dois(d.GetHours()) + ":" + dois(d.GetMinutes())
end function

function temNum(l as object, n as integer) as boolean
    for each v in l
        if v = n then return true
    end for
    return false
end function
