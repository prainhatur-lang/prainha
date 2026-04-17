// Empacota o agente em ZIP para distribuicao no Windows.
// Pre-requisito: rodar `pnpm bundle` antes (gera build/index.cjs)
//
// Saida: release/concilia-agente-windows.zip com:
//   - concilia-agente.exe   (binario standalone Node + bundle)
//   - nssm.exe              (Windows Service manager)
//   - install-service.bat   (instala como Windows Service)
//   - uninstall-service.bat (remove o service)
//   - config.example.json
//   - README.txt

import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';

const root = resolve(import.meta.dirname, '..');
const releaseDir = resolve(root, 'release');
const stageDir = resolve(releaseDir, 'concilia-agente');
const bundlePath = resolve(root, 'build', 'index.cjs');
const cacheDir = resolve(root, '.cache');

if (!existsSync(bundlePath)) {
  console.error('build/index.cjs nao existe. Rode `pnpm bundle` primeiro.');
  process.exit(1);
}

mkdirSync(cacheDir, { recursive: true });

// Baixa NSSM se ainda nao tiver em cache
async function ensureNssm(): Promise<string> {
  const out = resolve(cacheDir, 'nssm.exe');
  if (existsSync(out)) return out;
  const NSSM_URL = 'https://nssm.cc/release/nssm-2.24.zip';
  const zip = resolve(cacheDir, 'nssm.zip');
  console.log(`[NSSM] baixando ${NSSM_URL}...`);
  const r = await fetch(NSSM_URL);
  if (!r.ok || !r.body) throw new Error(`falha ao baixar NSSM: ${r.status}`);
  const w = createWriteStream(zip);
  await finished(Readable.fromWeb(r.body as never).pipe(w));
  console.log('[NSSM] extraindo...');
  // Usa unzip do sistema
  execSync(`cd ${cacheDir} && unzip -o nssm.zip`, { stdio: 'inherit' });
  // Copia o exe x64
  const x64 = resolve(cacheDir, 'nssm-2.24', 'win64', 'nssm.exe');
  if (!existsSync(x64)) throw new Error(`nssm.exe x64 nao encontrado em ${x64}`);
  copyFileSync(x64, out);
  return out;
}

// 1. Limpa stage
rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });

// 2. Gera EXE com pkg (sai em release/concilia-agente-win.exe)
console.log('[1/4] Gerando concilia-agente.exe (Node 22 + bundle)...');
execSync('pnpm exec pkg . --output release/concilia-agente.exe --compress GZip', {
  cwd: root,
  stdio: 'inherit',
});

// pkg pode adicionar sufixo no nome — vou normalizar
const exeAlts = ['concilia-agente.exe', 'concilia-agente-win.exe', 'concilia-agente-win-x64.exe'];
const exeFile = exeAlts.map((n) => resolve(releaseDir, n)).find((p) => existsSync(p));
if (!exeFile) {
  throw new Error('EXE gerado nao encontrado em release/');
}

// 3. Move tudo para stage
console.log('[2/4] Montando pacote...');
copyFileSync(exeFile, resolve(stageDir, 'concilia-agente.exe'));
copyFileSync(resolve(root, 'config.example.json'), resolve(stageDir, 'config.example.json'));

// Adiciona nssm.exe
const nssmPath = await ensureNssm();
copyFileSync(nssmPath, resolve(stageDir, 'nssm.exe'));

writeFileSync(
  resolve(stageDir, 'install-service.bat'),
  `@echo off
REM Instala o concilia-agente como Windows Service usando NSSM.
REM Roda este arquivo como Administrador.

setlocal
set NAME=ConciliaAgente
set DIR=%~dp0
set EXE=%DIR%concilia-agente.exe

if not exist "%DIR%nssm.exe" (
  echo Erro: nssm.exe nao encontrado em %DIR%
  echo Baixe em https://nssm.cc/download e coloque nssm.exe na mesma pasta.
  pause
  exit /b 1
)

if not exist "%DIR%config.json" (
  echo Erro: config.json nao encontrado em %DIR%
  echo Copie config.example.json para config.json e edite com seus dados.
  pause
  exit /b 1
)

echo Instalando servico %NAME%...
"%DIR%nssm.exe" install %NAME% "%EXE%"
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
REM Remove o concilia-agente do Windows Services.
REM Roda este arquivo como Administrador.

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

Este pacote contem o agente que roda na maquina do restaurante e
sincroniza pagamentos do Consumer (Firebird) com o concilia na nuvem.

INSTALACAO RAPIDA
-----------------

1. Extraia tudo numa pasta, por exemplo: C:\\concilia-agente
   (concilia-agente.exe, nssm.exe, .bat e config.example.json
   ja vem dentro do ZIP)

2. Copie 'config.example.json' para 'config.json' e edite:
   - api.token: copie do painel concilia (Sincronizacao -> sua filial -> Token)
   - firebird.host: deixe 'localhost' (agente roda na mesma maquina do Firebird)
   - firebird.database: caminho completo do consumer.fdb NESTA maquina
     (ex: C:\\Users\\User\\AppData\\Local\\RAL Tecnologia\\CreateInstall\\CONSUMER.FDB)
     IMPORTANTE: as barras devem ser duplas (\\\\) no JSON
   - firebird.password: senha do SYSDBA

3. Clique com botao direito em 'install-service.bat' -> Executar como
   administrador. O servico sera instalado e iniciado automaticamente.

4. Verifique no painel concilia (https://app.prainhabar.com/sync):
   apos ~15 min a filial deve aparecer com 'online'.

LOGS
----

Logs ficam em:
  - logs\\stdout.log         (saida do agente)
  - logs\\stderr.log         (erros)
  - logs\\agente-YYYY-MM-DD.log (log estruturado por dia)

DESINSTALAR
-----------

Execute 'uninstall-service.bat' como administrador.

REINICIAR APOS MUDAR config.json
--------------------------------

services.msc -> ConciliaAgente -> Restart

OU pelo CMD admin:
  nssm restart ConciliaAgente

EM CASO DE PROBLEMAS
--------------------

- Verifique logs\\stderr.log
- Confira se o Firebird esta acessivel:
  telnet 192.168.0.10 3050
- Confira se a internet esta funcionando:
  ping app.prainhabar.com
- Suporte: contate o administrador do concilia
`,
  'utf8',
);

// 4. Cria ZIP
console.log('[3/4] Criando ZIP...');
const zipPath = resolve(releaseDir, 'concilia-agente-windows.zip');
rmSync(zipPath, { force: true });
execSync(`cd ${releaseDir} && zip -r concilia-agente-windows.zip concilia-agente`, {
  stdio: 'inherit',
});

// 5. Limpa intermediarios
console.log('[4/4] Limpando arquivos intermediarios...');
for (const alt of exeAlts) {
  const p = resolve(releaseDir, alt);
  if (existsSync(p)) rmSync(p);
}

const zipStats = readFileSync(zipPath);
console.log(`\nPacote final: release/concilia-agente-windows.zip (${(zipStats.length / 1024 / 1024).toFixed(1)} MB)`);
console.log('Tudo dentro do ZIP: concilia-agente.exe, nssm.exe, scripts .bat, README.txt');
