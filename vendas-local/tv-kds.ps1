# tv-kds.ps1 - KDS da TV aberto pelo PROPRIO SERVIDOR da loja.
# ARQUIVO 100% ASCII (mesma regra do auto-update.ps1: o PowerShell 5.1 le
# arquivo sem BOM como ANSI e acento vira lixo).
#
# Ideia do dono (04/10/2026): em vez de depender do navegador da TV, a TV vira
# uma SEGUNDA TELA do servidor (cabo HDMI, ou tela sem fio pelo Windows + K) em
# modo ESTENDER, e o servidor abre nela o KDS /tv em tela cheia.
#
# Por que nao e o server.mjs que abre a janela: ele roda na tarefa
# PrainhaVendas como SYSTEM (sessao 0), que nao tem area de trabalho. Janela so
# nasce na sessao de quem esta logado - por isso isto aqui entra pelo atalho da
# pasta Inicializar do usuario do Windows.
#
# Uso, NO SERVIDOR DA LOJA, PowerShell NORMAL (nao precisa ser administrador),
# com o usuario que fica logado no servidor:
#     irm https://app.prainhabar.com/agente-release/tv-kds.ps1 | iex
# Rodar de novo troca a praca/tela ou DESLIGA. Nao mexe no vendas-local.
#
# O que ele deixa na maquina (tudo dentro do perfil do usuario):
#   %LOCALAPPDATA%\PrainhaTV\tv-kds.ps1   este arquivo
#   %LOCALAPPDATA%\PrainhaTV\tv-kds.cfg   uma linha por TV: tela|praca|som
#   %LOCALAPPDATA%\PrainhaTV\tv-kds.log   o que o vigia fez
#   %LOCALAPPDATA%\PrainhaTV\perfil-N     perfil do navegador so dessa janela
#   Inicializar\Prainha TV KDS.lnk        liga o vigia quando o usuario entra
#
# O VIGIA (-Vigia) fica rodando escondido e, de 5 em 5 s:
#   - TV apareceu e o servidor responde  -> abre o KDS nela (modo quiosque)
#   - alguem fechou a janela             -> abre de novo
#   - TV sumiu (desligou, cabo, Win+P)   -> FECHA a janela, pra tela cheia do
#     KDS nunca cair em cima da tela do caixa
#   - a janela foi parar na tela errada  -> empurra de volta; se nao for, fecha
#     e espera 10 min (nunca fica reabrindo em cima do caixa)
#
# Coordenadas: este processo NAO e DPI-aware de proposito. As posicoes que o
# Windows entrega assim (virtualizadas) sao as mesmas que o Chrome/Edge espera
# no --window-position. Nao chamar SetProcessDPIAware aqui.
param([switch]$Vigia)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$Origem = 'https://app.prainhabar.com/agente-release/tv-kds.ps1'
$Base   = 'http://localhost:8790'
$Dir    = Join-Path $env:LOCALAPPDATA 'PrainhaTV'
$Eu     = Join-Path $Dir 'tv-kds.ps1'
$Cfg    = Join-Path $Dir 'tv-kds.cfg'
$Log    = Join-Path $Dir 'tv-kds.log'
$Atalho = Join-Path ([Environment]::GetFolderPath('Startup')) 'Prainha TV KDS.lnk'
if (-not (Test-Path $Dir)) { New-Item -ItemType Directory -Path $Dir -Force | Out-Null }

function Reg($m) { try { Add-Content -Path $Log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' - ' + $m) } catch {} }

# --- telas e janelas direto da API do Windows --------------------------------
# (o [System.Windows.Forms.Screen] guarda a lista em cache e, dentro do
# PowerShell, nao percebe TV ligada depois - por isso a consulta e direta)
$Fonte = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class PrainhaTela {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int L; public int T; public int R; public int B; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct MONITORINFOEX {
    public int cbSize;
    public RECT rcMonitor;
    public RECT rcWork;
    public uint dwFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
    public string szDevice;
  }
  public delegate bool MonitorEnumProc(IntPtr hMon, IntPtr hdc, IntPtr rc, IntPtr data);
  [DllImport("user32.dll")]
  static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc cb, IntPtr data);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetMonitorInfoW")]
  static extern bool GetMonitorInfo(IntPtr hMon, ref MONITORINFOEX mi);
  [DllImport("user32.dll")]
  static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")]
  static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")]
  static extern bool IsWindow(IntPtr hwnd);

  static string Linha(IntPtr hMon) {
    MONITORINFOEX mi = new MONITORINFOEX();
    mi.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX));
    if (!GetMonitorInfo(hMon, ref mi)) return "";
    return mi.szDevice + "|" + mi.rcMonitor.L + "|" + mi.rcMonitor.T + "|"
      + (mi.rcMonitor.R - mi.rcMonitor.L) + "|" + (mi.rcMonitor.B - mi.rcMonitor.T) + "|"
      + (((mi.dwFlags & 1) != 0) ? "1" : "0");
  }
  // uma linha por tela: nome|x|y|largura|altura|principal
  public static string Telas() {
    StringBuilder sb = new StringBuilder();
    MonitorEnumProc cb = delegate(IntPtr hMon, IntPtr hdc, IntPtr rc, IntPtr data) {
      string l = Linha(hMon);
      if (l.Length > 0) sb.Append(l).Append("\n");
      return true;
    };
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, cb, IntPtr.Zero);
    GC.KeepAlive(cb);
    return sb.ToString();
  }
  // nome da tela onde a janela esta ("" se a janela nao existe)
  public static string TelaDaJanela(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return "";
    IntPtr m = MonitorFromWindow(hwnd, 2);
    if (m == IntPtr.Zero) return "";
    string l = Linha(m);
    int i = l.IndexOf('|');
    return i > 0 ? l.Substring(0, i) : "";
  }
  public static bool Mover(IntPtr hwnd, int x, int y, int w, int h) {
    if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return false;
    return SetWindowPos(hwnd, IntPtr.Zero, x, y, w, h, 0x0014);
  }
}
'@
$TemApi = $false
try {
  if (-not ('PrainhaTela' -as [type])) { Add-Type -TypeDefinition $Fonte -Language CSharp -IgnoreWarnings -ErrorAction Stop }
  $TemApi = [bool]('PrainhaTela' -as [type])
} catch { Reg ('Add-Type falhou: ' + $_.Exception.Message) }

# Quem chama embrulha em @( ) - as funcoes soltam um item por vez.
function Telas {
  $txt = ''
  try { $txt = [PrainhaTela]::Telas() } catch { return }
  foreach ($l in ($txt -split "`n")) {
    $p = ([string]$l).Trim() -split '\|'
    if ($p.Count -lt 6) { continue }
    New-Object PSObject -Property @{ Nome = $p[0]; X = [int]$p[1]; Y = [int]$p[2]; W = [int]$p[3]; H = [int]$p[4]; Principal = ($p[5] -eq '1') }
  }
}

function LerCfg {
  if (-not (Test-Path $Cfg)) { return }
  $n = 0
  foreach ($l in @(Get-Content $Cfg)) {
    $t = ([string]$l).Trim()
    if ($t -eq '' -or $t.StartsWith('#')) { continue }
    $p = $t -split '\|'
    if ($p.Count -lt 2) { continue }
    if ($p[1] -notmatch '^(todas|\d+(,\d+)*)$') { continue }
    $som = '1'
    if ($p.Count -ge 3 -and $p[2] -eq '0') { $som = '0' }
    $n++
    New-Object PSObject -Property @{ N = $n; Tela = $p[0]; Area = $p[1]; Som = $som }
  }
}

function PerfilDe($e) { return (Join-Path $Dir ('perfil-' + $e.N)) }

function UrlDe($e) {
  $u = $Base + '/tv?area=' + $e.Area
  if ($e.Som -eq '0') { $u += '&som=0' }
  return $u
}

function Navegador {
  $c = @(
    ($env:ProgramFiles + '\Google\Chrome\Application\chrome.exe'),
    (${env:ProgramFiles(x86)} + '\Google\Chrome\Application\chrome.exe'),
    ($env:LOCALAPPDATA + '\Google\Chrome\Application\chrome.exe'),
    (${env:ProgramFiles(x86)} + '\Microsoft\Edge\Application\msedge.exe'),
    ($env:ProgramFiles + '\Microsoft\Edge\Application\msedge.exe')
  )
  foreach ($x in $c) { if ($x -and (Test-Path $x)) { return $x } }
  return $null
}

function ServidorNoAr {
  try {
    $r = Invoke-WebRequest -UseBasicParsing ($Base + '/api/versao') -TimeoutSec 4
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

# processos de navegador que usam um perfil nosso (o caminho aparece na linha
# de comando do navegador e dos filhos dele)
function ProcsDoPerfil($perfil) {
  try {
    Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" -ErrorAction Stop |
      Where-Object { $_.CommandLine -and ($_.CommandLine.IndexOf($perfil, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) }
  } catch {}
}

function MatarPerfil($perfil) {
  $achou = $false
  foreach ($c in @(ProcsDoPerfil $perfil)) {
    $achou = $true
    try { Stop-Process -Id $c.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
  }
  if ($achou) { Start-Sleep -Milliseconds 800 }
}

function MatarVigias {
  try {
    Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction Stop |
      Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and ($_.CommandLine -like '*tv-kds.ps1*') -and ($_.CommandLine -like '*-Vigia*') } |
      ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }
  } catch {}
}

# em que tela a TV desta linha do cfg esta agora ($null = nao esta ligada)
#   auto  = a primeira tela que NAO e a principal (caso normal: 1 TV)
#   unica = a principal (servidor sem monitor, so pro KDS)
#   \\.\DISPLAYn = aquela tela, desde que nao seja a principal
function AlvoDe($e, $telas) {
  if ($e.Tela -eq 'unica') { foreach ($t in $telas) { if ($t.Principal) { return $t } }; return $null }
  if ($e.Tela -eq 'auto')  { foreach ($t in $telas) { if (-not $t.Principal) { return $t } }; return $null }
  foreach ($t in $telas) { if (($t.Nome -eq $e.Tela) -and (-not $t.Principal)) { return $t } }
  return $null
}

function Vivo($e, $st) {
  if (-not $st.Proc) { return $false }
  $saiu = $true
  try { $saiu = $st.Proc.HasExited } catch {}
  if (-not $saiu) { return $true }
  $st.Proc = $null
  # o processo que eu abri saiu: o navegador pode ter passado a janela pra outro
  foreach ($c in @(ProcsDoPerfil (PerfilDe $e))) {
    if ($c.CommandLine -notlike '*--type=*') {
      try { $st.Proc = Get-Process -Id $c.ProcessId -ErrorAction Stop; return $true } catch {}
    }
  }
  return $false
}

function Fechar($e, $st) {
  try { if ($st.Proc -and (-not $st.Proc.HasExited)) { Stop-Process -Id $st.Proc.Id -Force -ErrorAction SilentlyContinue } } catch {}
  MatarPerfil (PerfilDe $e)
  $st.Proc = $null
  $st.Desde = [datetime]::MinValue
}

function Abrir($e, $st, $alvo) {
  $perfil = PerfilDe $e
  MatarPerfil $perfil
  if (-not (Test-Path $perfil)) { New-Item -ItemType Directory -Path $perfil -Force | Out-Null }
  $url = UrlDe $e
  $a = '--kiosk "' + $url + '"'
  if ($Nav -like '*msedge.exe') { $a += ' --edge-kiosk-type=fullscreen' }
  $a += ' --user-data-dir="' + $perfil + '"'
  $a += ' --window-position=' + $alvo.X + ',' + $alvo.Y
  $a += ' --no-first-run --no-default-browser-check --disable-session-crashed-bubble --hide-crash-restore-bubble'
  $a += ' --autoplay-policy=no-user-gesture-required --disable-features=Translate,TranslateUI'
  try {
    $st.Proc = Start-Process -FilePath $Nav -ArgumentList $a -PassThru
    $st.Desde = Get-Date
    $st.Fora = 0
    Reg ('TV ' + $e.N + ': abri ' + $url + ' na tela ' + $alvo.Nome + ' (' + $alvo.W + 'x' + $alvo.H + ' em ' + $alvo.X + ',' + $alvo.Y + ')')
  } catch {
    $st.Proc = $null
    $st.Espera = (Get-Date).AddMinutes(2)
    Reg ('TV ' + $e.N + ': nao consegui abrir o navegador - ' + $_.Exception.Message)
  }
}

# =============================================================================
#  VIGIA - roda escondido enquanto o usuario estiver logado
# =============================================================================
if ($Vigia) {
  $mtx = New-Object System.Threading.Mutex($false, 'Local\PrainhaTvKds')
  $meu = $false
  try { $meu = $mtx.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $meu = $true } catch {}
  if (-not $meu) { exit 0 }

  try {
    if ((Test-Path $Log) -and ((Get-Item $Log).Length -gt 300000)) {
      $u = Get-Content $Log -Tail 200
      Set-Content -Path $Log -Value $u -Encoding ASCII
    }
  } catch {}

  if (-not $TemApi) { Reg 'vigia: sem a API de telas (Add-Type) - nao da pra achar a TV. Saindo.'; exit 1 }
  $Nav = Navegador
  if (-not $Nav) { Reg 'vigia: nao achei Chrome nem Edge. Saindo.'; exit 1 }
  $Entradas = @(LerCfg)
  if ($Entradas.Count -eq 0) { Reg 'vigia: tv-kds.cfg vazio. Saindo.'; exit 1 }

  $Estado = @{}
  foreach ($e in $Entradas) {
    $Estado[$e.N] = @{ Proc = $null; Desde = [datetime]::MinValue; Espera = [datetime]::MinValue; Falhas = 0; Fora = 0; SemTela = $false; SemSrv = $false }
  }
  Reg ('vigia ligado - ' + $Entradas.Count + ' TV(s), navegador ' + $Nav)

  while ($true) {
    $telas = @(Telas)
    foreach ($e in $Entradas) {
      $st = $Estado[$e.N]
      $alvo = AlvoDe $e $telas
      $vivo = Vivo $e $st

      if (-not $alvo) {
        if ($vivo) {
          Reg ('TV ' + $e.N + ': a tela sumiu - fechei o KDS pra nao cair em cima do caixa')
          Fechar $e $st
        } elseif (-not $st.SemTela) {
          Reg ('TV ' + $e.N + ': esperando a tela aparecer (' + $e.Tela + '; o Windows ve ' + $telas.Count + ' tela(s))')
        }
        $st.SemTela = $true
        $st.Desde = [datetime]::MinValue
        continue
      }
      $st.SemTela = $false

      if ($vivo) {
        # a janela esta na TV? (o Windows joga janela de um lado pro outro
        # quando liga/desliga tela)
        $h = [IntPtr]::Zero
        try { $st.Proc.Refresh(); $h = $st.Proc.MainWindowHandle } catch {}
        if ($h -ne [IntPtr]::Zero) {
          $onde = ''
          try { $onde = [PrainhaTela]::TelaDaJanela($h) } catch {}
          if (($onde -ne '') -and ($onde -ne $alvo.Nome)) {
            $st.Fora++
            if ($st.Fora -ge 4) {
              Reg ('TV ' + $e.N + ': nao consegui manter a janela na TV (ficou em ' + $onde + ') - fechei e espero 10 min')
              Fechar $e $st
              $st.Fora = 0
              $st.Espera = (Get-Date).AddMinutes(10)
            } else {
              Reg ('TV ' + $e.N + ': janela em ' + $onde + ' - empurrando pra ' + $alvo.Nome)
              try { [void][PrainhaTela]::Mover($h, $alvo.X, $alvo.Y, $alvo.W, $alvo.H) } catch {}
            }
          } else {
            $st.Fora = 0
          }
        }
        continue
      }

      $agora = Get-Date
      if ($st.Desde -ne [datetime]::MinValue) {
        # tinha aberto e a janela fechou
        if (($agora - $st.Desde).TotalSeconds -lt 40) { $st.Falhas++ } else { $st.Falhas = 0 }
        $st.Desde = [datetime]::MinValue
        if ($st.Falhas -ge 3) {
          $st.Falhas = 0
          $st.Espera = $agora.AddMinutes(10)
          Reg ('TV ' + $e.N + ': a janela fechou 3 vezes seguidas logo depois de abrir - espero 10 min')
        } else {
          $st.Espera = $agora.AddSeconds(5)
          Reg ('TV ' + $e.N + ': a janela fechou - abro de novo')
        }
      }
      if ($agora -lt $st.Espera) { continue }
      if (-not (ServidorNoAr)) {
        if (-not $st.SemSrv) { Reg ('TV ' + $e.N + ': o servidor da loja ainda nao respondeu - esperando') }
        $st.SemSrv = $true
        continue
      }
      $st.SemSrv = $false
      Abrir $e $st $alvo
    }
    Start-Sleep -Seconds 5
  }
  exit 0
}

# =============================================================================
#  INSTALAR / RECONFIGURAR / DESLIGAR - e o que roda no  irm ... | iex
# =============================================================================
function Dizer($t, $cor) { if ($cor) { Write-Host $t -ForegroundColor $cor } else { Write-Host $t } }

Dizer ''
Dizer '=== KDS na TV pelo servidor da loja ===' 'Cyan'

# o atalho e os arquivos vao pro perfil de QUEM RODA; tem que ser o usuario que
# fica logado no servidor (PowerShell "como administrador" com outra conta
# instalaria no lugar errado)
$logado = ''
try { $logado = [string](Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).UserName } catch {}
$quem = [Environment]::UserName
if ($logado -and ($logado.Split('\')[-1] -ne $quem)) {
  Dizer ('  [!] Este PowerShell esta como "' + $quem + '", mas o usuario logado na tela do servidor chama "' + $logado + '".') 'Yellow'
  Dizer '      O certo: abrir o PowerShell NORMAL (sem "executar como administrador") com o usuario da tela.'
  $r = Read-Host '  [Enter] = parar aqui     C = continuar mesmo assim'
  if ($r -notmatch '^\s*[cC]') { return }
}

if (-not $TemApi) {
  Dizer '  [X] O Windows nao deixou preparar a consulta das telas (Add-Type).' 'Red'
  Dizer ('      Detalhe em ' + $Log) 'Yellow'
  return
}

if (-not (ServidorNoAr)) {
  Dizer ('  [X] O vendas-local nao respondeu em ' + $Base + '.') 'Red'
  Dizer '      Rode isto NO SERVIDOR da loja (a maquina onde roda o vendas-local).' 'Yellow'
  return
}
Dizer '  [ok] servidor da loja respondendo' 'Green'

$Nav = Navegador
if (-not $Nav) { Dizer '  [X] Nao achei Chrome nem Edge nesta maquina.' 'Red'; return }
Dizer ('  [ok] navegador: ' + $Nav) 'Green'

if ((Test-Path $Cfg) -or (Test-Path $Atalho)) {
  Dizer ''
  Dizer '  O KDS na TV ja esta ligado neste servidor.' 'Yellow'
  $r = Read-Host '  [Enter] = configurar de novo     D = DESLIGAR (tirar o KDS da TV)'
  if ($r -match '^\s*[dD]') {
    MatarVigias
    MatarPerfil (Join-Path $Dir 'perfil-')
    Remove-Item $Atalho -Force -ErrorAction SilentlyContinue
    Remove-Item $Cfg -Force -ErrorAction SilentlyContinue
    Dizer '  [ok] desligado. A TV volta a ser so uma segunda tela do Windows.' 'Green'
    return
  }
}

# --- pracas da loja ----------------------------------------------------------
$Pracas = @()
try {
  $wc = New-Object System.Net.WebClient
  $wc.Encoding = [System.Text.Encoding]::UTF8
  $lista = ConvertFrom-Json ($wc.DownloadString($Base + '/api/areas'))
  foreach ($x in $lista) { if ($x -and ($x.codigo -ne $null)) { $Pracas += $x } }
} catch {}
if ($Pracas.Count -eq 0) { Dizer '  [!] Nao consegui ler as pracas da loja - vai dar pra escolher so "todas".' 'Yellow' }

# devolve '1' | '1,4' | 'todas' | $null (pulou)
function PerguntaPraca($rotulo, $podePular) {
  Dizer ''
  Dizer ('  Que praca aparece n' + $rotulo + '?') 'Cyan'
  foreach ($x in $Pracas) { Dizer ('     ' + $x.codigo + ' = ' + $x.nome) }
  Dizer '     T = todas juntas'
  if ($Pracas.Count -ge 2) { Dizer '     (da pra juntar duas com virgula, tipo 1,4)' }
  if ($podePular) { Dizer '     N = nenhuma (pular esta tela)' }
  for ($i = 0; $i -lt 4; $i++) {
    $r = ([string](Read-Host '  Digite e aperte Enter')).Trim().Replace(' ', '')
    if ($r -eq '' -or $r -match '^[tT]') { return 'todas' }
    if ($podePular -and ($r -match '^[nN]')) { return $null }
    if ($r -match '^\d+(,\d+)*$') {
      $ok = $true
      foreach ($c in ($r -split ',')) {
        $tem = $false
        foreach ($x in $Pracas) { if ([string]$x.codigo -eq $c) { $tem = $true } }
        if (-not $tem) { $ok = $false }
      }
      if ($ok) { return $r }
    }
    Dizer '  Nao entendi. Digite o numero da praca (ou T).' 'Yellow'
  }
  return 'todas'
}

# --- telas -------------------------------------------------------------------
$telas = @(Telas)
$tvs = @($telas | Where-Object { -not $_.Principal })
Dizer ''
Dizer '  Telas que o Windows esta vendo agora:'
foreach ($t in $telas) {
  $q = 'segunda tela'
  if ($t.Principal) { $q = 'PRINCIPAL (a do servidor)' }
  Dizer ('     ' + $t.Nome + '   ' + $t.W + 'x' + $t.H + '   posicao ' + $t.X + ',' + $t.Y + '   ' + $q)
}

$linhas = @()
if ($tvs.Count -eq 0) {
  Dizer ''
  Dizer '  [!] So achei UMA tela. Pra TV virar segunda tela do servidor:' 'Yellow'
  Dizer '      1) ligue a TV no servidor pelo cabo HDMI (ou sem fio: tecla Windows + K)'
  Dizer '      2) aperte Windows + P e escolha ESTENDER (nao "Duplicar")'
  Dizer ''
  $r = Read-Host '  [Enter] = deixar pronto (o KDS abre sozinho quando a TV aparecer)     U = usar ESTA tela mesmo (servidor so pro KDS)'
  $modo = 'auto'
  if ($r -match '^\s*[uU]') { $modo = 'unica' }
  $a = PerguntaPraca 'a TV' $false
  $linhas += ($modo + '|' + $a)
} elseif ($tvs.Count -eq 1) {
  $a = PerguntaPraca ('a TV (' + $tvs[0].Nome + ', ' + $tvs[0].W + 'x' + $tvs[0].H + ')') $false
  $linhas += ('auto|' + $a)
} else {
  foreach ($t in $tvs) {
    $a = PerguntaPraca ('a tela ' + $t.Nome + ' (' + $t.W + 'x' + $t.H + ', posicao ' + $t.X + ',' + $t.Y + ')') $true
    if ($a) { $linhas += ($t.Nome + '|' + $a) }
  }
  if ($linhas.Count -eq 0) { Dizer '  Nenhuma tela escolhida. Nada foi mudado.' 'Yellow'; return }
}

Dizer ''
$r = Read-Host '  Apito quando entra pedido novo? [Enter] = sim     N = nao'
$som = '1'
if ($r -match '^\s*[nN]') { $som = '0' }
$grava = @()
foreach ($l in $linhas) { $grava += ($l + '|' + $som) }

# --- grava, copia este arquivo pro disco, cria o atalho e liga o vigia -------
MatarVigias
MatarPerfil (Join-Path $Dir 'perfil-')
Set-Content -Path $Cfg -Value $grava -Encoding ASCII

$ok = $false
try {
  if ($PSCommandPath -and ((Split-Path $PSCommandPath -Leaf) -eq 'tv-kds.ps1') -and (Test-Path $PSCommandPath)) {
    if ($PSCommandPath -ne $Eu) { Copy-Item $PSCommandPath $Eu -Force }
    $ok = $true
  } else {
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
    $tmp = $Eu + '.novo'
    Invoke-WebRequest -UseBasicParsing $Origem -OutFile $tmp -TimeoutSec 30
    if ((Get-Item $tmp).Length -gt 2000) { Move-Item $tmp $Eu -Force; $ok = $true }
  }
} catch {}
if ((-not $ok) -or (-not (Test-Path $Eu))) {
  Dizer ('  [X] Nao consegui salvar o script em ' + $Eu + ' (sem internet?). Nada foi ligado.') 'Red'
  return
}

$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$psArgs = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $Eu + '" -Vigia'
try {
  $ws = New-Object -ComObject WScript.Shell
  $s = $ws.CreateShortcut($Atalho)
  $s.TargetPath = $psExe
  $s.Arguments = $psArgs
  $s.WorkingDirectory = $Dir
  $s.WindowStyle = 7
  $s.Description = 'KDS na TV (Prainha)'
  $s.Save()
  Dizer '  [ok] vai ligar sozinho toda vez que este usuario entrar no Windows' 'Green'
} catch {
  Dizer ('  [!] Nao consegui criar o atalho de inicializacao: ' + $_.Exception.Message) 'Yellow'
}

Start-Process -FilePath $psExe -ArgumentList $psArgs -WindowStyle Hidden
Dizer '  ligando o KDS na TV...'
Start-Sleep -Seconds 12

Dizer ''
Dizer '  O que o vigia fez ate agora:'
try { Get-Content $Log -Tail 6 | ForEach-Object { Dizer ('     ' + $_) } } catch {}
Dizer ''
Dizer '  Pronto. Se a TV ja esta ligada no servidor como segunda tela, o KDS abriu nela.' 'Green'
Dizer '  - Se a TV desligar ou o cabo sair, a janela FECHA sozinha e volta quando a TV voltar.'
Dizer '  - Trocar a praca ou DESLIGAR: rode este mesmo comando de novo.'
Dizer ('  - Historico: ' + $Log)
