// Empacota o agente para Windows usando NODE.JS PORTATIL (sem pkg).
// Mais robusto: erros aparecem normalmente, atualizacoes mais leves.
//
// Saida: release/concilia-agente-windows.zip com:
//   - node.exe              (Node.js LTS portatil)
//   - agente.cjs            (bundle CJS com tudo dentro)
//   - run.cmd               (wrapper que chama node.exe agente.cjs)
//   - nssm.exe
//   - install-service.bat
//   - uninstall-service.bat
//   - config.example.json
//   - README.txt

import { execSync } from 'node:child_process';
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';

const NODE_VERSION = 'v22.13.0';
const root = resolve(import.meta.dirname, '..');
const releaseDir = resolve(root, 'release');
const stageDir = resolve(releaseDir, 'concilia-agente');
const cacheDir = resolve(root, '.cache');
const bundlePath = resolve(root, 'build', 'index.cjs');

if (!existsSync(bundlePath)) {
  console.error('build/index.cjs nao existe. Rode `pnpm bundle` primeiro.');
  process.exit(1);
}

mkdirSync(cacheDir, { recursive: true });
rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });

// 1. Baixar Node.js Windows portatil
async function ensureNodeExe(): Promise<string> {
  const out = resolve(cacheDir, `node-${NODE_VERSION}-win-x64.exe`);
  if (existsSync(out)) return out;
  const url = `https://nodejs.org/dist/${NODE_VERSION}/win-x64/node.exe`;
  console.log(`[Node] baixando ${url}...`);
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`falha ao baixar Node: ${r.status}`);
  const w = createWriteStream(out);
  await finished(Readable.fromWeb(r.body as never).pipe(w));
  return out;
}

// 2. NSSM
async function ensureNssm(): Promise<string> {
  const out = resolve(cacheDir, 'nssm.exe');
  if (existsSync(out)) return out;
  const url = 'https://nssm.cc/release/nssm-2.24.zip';
  const zip = resolve(cacheDir, 'nssm.zip');
  console.log(`[NSSM] baixando ${url}...`);
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`falha ao baixar NSSM: ${r.status}`);
  const w = createWriteStream(zip);
  await finished(Readable.fromWeb(r.body as never).pipe(w));
  console.log('[NSSM] extraindo...');
  execSync(`cd ${cacheDir} && unzip -o nssm.zip`, { stdio: 'inherit' });
  const x64 = resolve(cacheDir, 'nssm-2.24', 'win64', 'nssm.exe');
  if (!existsSync(x64)) throw new Error(`nssm.exe x64 nao encontrado em ${x64}`);
  copyFileSync(x64, out);
  return out;
}

console.log('[1/4] Garantindo binarios...');
const [nodePath, nssmPath] = await Promise.all([ensureNodeExe(), ensureNssm()]);

console.log('[2/4] Montando stage...');
copyFileSync(nodePath, resolve(stageDir, 'node.exe'));
copyFileSync(nssmPath, resolve(stageDir, 'nssm.exe'));
copyFileSync(bundlePath, resolve(stageDir, 'agente.cjs'));
copyFileSync(resolve(root, 'config.example.json'), resolve(stageDir, 'config.example.json'));

// run.cmd: wrapper com auto-restart (se node.exe sair por qualquer motivo,
// reinicia em 5s). Resolve crashes silenciosos do node-firebird sem perder
// o agente.
writeFileSync(
  resolve(stageDir, 'run.cmd'),
  `@echo off
cd /d %~dp0
:loop
"%~dp0node.exe" "%~dp0agente.cjs"
echo [run.cmd] node.exe encerrou em %DATE% %TIME% com exit code %ERRORLEVEL%, reiniciando em 5s...
timeout /t 5 /nobreak >nul
goto loop
`,
  'utf8',
);

writeFileSync(
  resolve(stageDir, 'install-service.bat'),
  `@echo off
REM Instala o concilia-agente como Windows Service.
REM Roda este arquivo como Administrador.

setlocal
set NAME=ConciliaAgente
set DIR=%~dp0
set NODE=%DIR%node.exe
set SCRIPT=%DIR%agente.cjs

if not exist "%DIR%nssm.exe" (
  echo Erro: nssm.exe nao encontrado em %DIR%
  pause
  exit /b 1
)
if not exist "%NODE%" (
  echo Erro: node.exe nao encontrado em %DIR%
  pause
  exit /b 1
)
if not exist "%SCRIPT%" (
  echo Erro: agente.cjs nao encontrado em %DIR%
  pause
  exit /b 1
)
if not exist "%DIR%config.json" (
  echo Erro: config.json nao encontrado em %DIR%
  echo Copie config.example.json para config.json e edite com seus dados.
  pause
  exit /b 1
)

REM Remove servico existente (se houver) para reinstalar limpo
"%DIR%nssm.exe" stop %NAME% 2>nul
"%DIR%nssm.exe" remove %NAME% confirm 2>nul

echo Instalando servico %NAME%...
"%DIR%nssm.exe" install %NAME% "%NODE%" "%SCRIPT%"
"%DIR%nssm.exe" set %NAME% AppDirectory "%DIR%"
"%DIR%nssm.exe" set %NAME% DisplayName "Concilia Agente Local"
"%DIR%nssm.exe" set %NAME% Description "Sincroniza pagamentos do Consumer (Firebird) com o concilia"
"%DIR%nssm.exe" set %NAME% Start SERVICE_AUTO_START
"%DIR%nssm.exe" set %NAME% AppStdout "%DIR%logs\\stdout.log"
"%DIR%nssm.exe" set %NAME% AppStderr "%DIR%logs\\stderr.log"
"%DIR%nssm.exe" set %NAME% AppRotateFiles 1
"%DIR%nssm.exe" set %NAME% AppRotateBytes 10485760

if not exist "%DIR%logs" mkdir "%DIR%logs"

echo Iniciando servico...
"%DIR%nssm.exe" start %NAME%

echo.
echo Pronto! Servico %NAME% instalado e iniciado.
echo Logs em %DIR%logs\\
echo.
pause
endlocal
`,
  'utf8',
);

writeFileSync(
  resolve(stageDir, 'uninstall-service.bat'),
  `@echo off
setlocal
set NAME=ConciliaAgente
set DIR=%~dp0

echo Parando servico %NAME%...
"%DIR%nssm.exe" stop %NAME%
echo Removendo servico...
"%DIR%nssm.exe" remove %NAME% confirm

echo.
echo Servico removido.
pause
endlocal
`,
  'utf8',
);

writeFileSync(
  resolve(stageDir, 'README.txt'),
  `concilia - Agente Local Windows
================================

Pacote contem Node.js portatil + agente, sem precisar instalar nada
externamente.

INSTALACAO RAPIDA
-----------------

1. Extraia tudo numa pasta, por exemplo: C:\\concilia-agente

2. Copie 'config.example.json' para 'config.json' e edite:
   - api.token: copie do painel concilia (Sincronizacao -> filial -> Token)
     SEM aspas extras, SEM <>, exemplo:
     "token": "agt_nQgg7WiAMHWOCW5JnKrDHxsPnA6afv28560ei4390Ug"
   - firebird.host: deixe 'localhost' (agente roda na mesma maquina do FB)
   - firebird.database: caminho completo do consumer.fdb NESTA maquina
     IMPORTANTE: use barras DUPLAS no JSON, ex:
     "database": "C:\\\\Users\\\\User\\\\AppData\\\\Local\\\\RAL Tecnologia\\\\CreateInstall\\\\CONSUMER.FDB"
   - firebird.password: senha do SYSDBA

3. (Opcional) Teste manual antes de instalar como service:
   run.cmd
   (deve mostrar logs INFO no console; Ctrl+C para parar)

4. Clique direito em 'install-service.bat' -> Executar como Administrador.
   O servico sera instalado e iniciado automaticamente.

5. Verifique no painel concilia (https://app.prainhabar.com/sync):
   apos ~15 min a filial deve aparecer com 'online'.

LOGS
----

logs\\stdout.log         - saida do agente (NSSM redireciona)
logs\\stderr.log         - erros
logs\\agente-YYYY-MM-DD.log - log estruturado por dia

REINSTALAR / ATUALIZAR
----------------------

Basta substituir 'agente.cjs' pela versao nova e:
  nssm restart ConciliaAgente

DESINSTALAR
-----------

Execute 'uninstall-service.bat' como administrador.

DEBUG
-----

Se o servico nao inicia, rode 'run.cmd' manualmente no CMD admin -
o erro vai aparecer na tela.
`,
  'utf8',
);

console.log('[3/4] Criando ZIP...');
const zipPath = resolve(releaseDir, 'concilia-agente-windows.zip');
rmSync(zipPath, { force: true });
execSync(`cd ${releaseDir} && zip -r concilia-agente-windows.zip concilia-agente`, {
  stdio: 'inherit',
});

console.log('[4/4] OK');
const stats = readFileSync(zipPath);
console.log(`\nPacote: release/concilia-agente-windows.zip (${(stats.length / 1024 / 1024).toFixed(1)} MB)`);
