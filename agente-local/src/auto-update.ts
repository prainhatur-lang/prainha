// Auto-update do agente. A cada 5min consulta GitHub Releases; se detectar
// nova versao baixa o ZIP, escreve um updater.bat em %TEMP% e dispara ele
// destacado. O updater para o servico via NSSM, copia os arquivos novos
// preservando config.json/logs/checkpoint.json e reinicia o servico.
//
// Pre-requisitos para funcionar:
//   - Plataforma Windows
//   - Bundle de producao (constante __AGENT_VERSION__ injetada via esbuild)
//   - Existencia de nssm.exe + agente.cjs no diretorio do executavel

import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { log } from './logger';

declare const __AGENT_VERSION__: string;
const AGENT_VERSION: string =
  typeof __AGENT_VERSION__ === 'string' ? __AGENT_VERSION__ : '0.0.0-dev';

const REPO = 'prainhatur-lang/prainha';
const ASSET_NAME = 'concilia-agente-windows.zip';
const SERVICE_NAME = 'ConciliaAgente';
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 60 * 1000;

interface GitHubRelease {
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

function appDir(): string {
  return dirname(process.execPath);
}

function isProductionInstall(): boolean {
  if (process.platform !== 'win32') return false;
  if (typeof __AGENT_VERSION__ === 'undefined') return false;
  const dir = appDir();
  return existsSync(resolve(dir, 'agente.cjs')) && existsSync(resolve(dir, 'nssm.exe'));
}

async function fetchLatestRelease(): Promise<GitHubRelease | null> {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: {
        'User-Agent': `concilia-agente/${AGENT_VERSION}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (!r.ok) {
      log.warn('auto-update: GitHub API falhou', { status: r.status });
      return null;
    }
    return (await r.json()) as GitHubRelease;
  } catch (e) {
    log.warn('auto-update: erro buscando release', { err: (e as Error).message });
    return null;
  }
}

function tagToVersion(tag: string): string {
  return tag.startsWith('v') ? tag.slice(1) : tag;
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const r = await fetch(url, {
    headers: { 'User-Agent': `concilia-agente/${AGENT_VERSION}` },
    redirect: 'follow',
  });
  if (!r.ok || !r.body) throw new Error(`download falhou: HTTP ${r.status}`);
  await finished(Readable.fromWeb(r.body as never).pipe(createWriteStream(dest)));
}

function extractZip(zipPath: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  const psCmd = `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`;
  const r = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCmd],
    { stdio: 'pipe' },
  );
  if (r.status !== 0) {
    const err = r.stderr?.toString() ?? '';
    throw new Error(`Expand-Archive falhou (${r.status}): ${err}`);
  }
}

function writeUpdaterBat(workDir: string, sourceDir: string, targetDir: string): string {
  const batPath = resolve(workDir, 'updater.bat');
  // Notas:
  // - Usa o nssm.exe da pasta SOURCE (pacote novo) para nao locar o nssm.exe
  //   do TARGET enquanto copia.
  // - status SERVICE_STOPPED e independente de locale.
  // - taskkill node.exe e fallback se servico travar; e brutal mas o
  //   checkpoint cobre o restart.
  const content = `@echo off
setlocal
set NAME=${SERVICE_NAME}
set SOURCE=${sourceDir}
set TARGET=${targetDir}
set NSSM=%SOURCE%\\nssm.exe
set LOG=%~dp0updater.log

echo [%DATE% %TIME%] updater iniciado >> "%LOG%"
echo SOURCE=%SOURCE% >> "%LOG%"
echo TARGET=%TARGET% >> "%LOG%"

REM Espera o agente atual finalizar (process.exit chamado logo apos o spawn)
timeout /t 5 /nobreak >nul

echo [%DATE% %TIME%] parando servico %NAME%... >> "%LOG%"
"%NSSM%" stop %NAME% >> "%LOG%" 2>&1

set count=0
:waitloop
"%NSSM%" status %NAME% | find "SERVICE_STOPPED" >nul
if %errorlevel%==0 goto stopped
set /a count+=1
if %count% geq 30 goto force
timeout /t 2 /nobreak >nul
goto waitloop

:force
echo [%DATE% %TIME%] servico nao parou em 60s, taskkill node.exe >> "%LOG%"
taskkill /F /IM node.exe >> "%LOG%" 2>&1
timeout /t 3 /nobreak >nul

:stopped
echo [%DATE% %TIME%] copiando arquivos novos >> "%LOG%"
copy /Y "%SOURCE%\\node.exe" "%TARGET%\\node.exe" >> "%LOG%" 2>&1
copy /Y "%SOURCE%\\agente.cjs" "%TARGET%\\agente.cjs" >> "%LOG%" 2>&1
copy /Y "%SOURCE%\\nssm.exe" "%TARGET%\\nssm.exe" >> "%LOG%" 2>&1
copy /Y "%SOURCE%\\run.cmd" "%TARGET%\\run.cmd" >> "%LOG%" 2>&1
copy /Y "%SOURCE%\\install-service.bat" "%TARGET%\\install-service.bat" >> "%LOG%" 2>&1
copy /Y "%SOURCE%\\uninstall-service.bat" "%TARGET%\\uninstall-service.bat" >> "%LOG%" 2>&1
copy /Y "%SOURCE%\\README.txt" "%TARGET%\\README.txt" >> "%LOG%" 2>&1
copy /Y "%SOURCE%\\config.example.json" "%TARGET%\\config.example.json" >> "%LOG%" 2>&1

echo [%DATE% %TIME%] iniciando servico... >> "%LOG%"
"%TARGET%\\nssm.exe" start %NAME% >> "%LOG%" 2>&1

echo [%DATE% %TIME%] update concluido >> "%LOG%"
endlocal
`;
  writeFileSync(batPath, content, 'utf8');
  return batPath;
}

async function performUpdate(release: GitHubRelease): Promise<void> {
  const asset = release.assets.find((a) => a.name === ASSET_NAME);
  if (!asset) {
    log.warn('auto-update: asset nao encontrado na release', { tag: release.tag_name });
    return;
  }
  const ts = Date.now();
  const workDir = resolve(tmpdir(), `concilia-update-${ts}`);
  mkdirSync(workDir, { recursive: true });

  const zipPath = resolve(workDir, ASSET_NAME);
  log.info('auto-update: baixando', {
    tag: release.tag_name,
    url: asset.browser_download_url,
  });
  await downloadFile(asset.browser_download_url, zipPath);

  log.info('auto-update: extraindo');
  const extractDir = resolve(workDir, 'extracted');
  extractZip(zipPath, extractDir);

  // ZIP empacotado tem subpasta concilia-agente/
  const sourceDir = resolve(extractDir, 'concilia-agente');
  if (!existsSync(resolve(sourceDir, 'agente.cjs'))) {
    log.warn('auto-update: estrutura inesperada no ZIP, abortando', { sourceDir });
    return;
  }

  const target = appDir();
  const batPath = writeUpdaterBat(workDir, sourceDir, target);

  log.info('auto-update: lancando updater e saindo', { bat: batPath });
  // start /B desanexa do console; detached: true desanexa do processo node
  const child = spawn('cmd.exe', ['/c', 'start', '""', '/MIN', batPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  // Da tempo do spawn iniciar antes do node sair
  setTimeout(() => process.exit(0), 2000);
}

let updateInProgress = false;

async function checkAndUpdate(): Promise<void> {
  if (updateInProgress) return;
  const release = await fetchLatestRelease();
  if (!release) return;
  const remoteVersion = tagToVersion(release.tag_name);
  if (remoteVersion === AGENT_VERSION) return;

  log.info('auto-update: nova versao detectada', {
    atual: AGENT_VERSION,
    remota: remoteVersion,
  });
  updateInProgress = true;
  try {
    await performUpdate(release);
  } catch (e) {
    updateInProgress = false;
    log.error('auto-update: falhou', { err: (e as Error).message });
  }
}

export function startAutoUpdate(): void {
  if (!isProductionInstall()) {
    log.info('auto-update: desativado (nao e instalacao Windows/NSSM)', {
      version: AGENT_VERSION,
    });
    return;
  }
  log.info('auto-update: ativo', { versao: AGENT_VERSION, intervalo: '5min' });
  setTimeout(() => {
    void checkAndUpdate();
    setInterval(() => void checkAndUpdate(), CHECK_INTERVAL_MS);
  }, FIRST_CHECK_DELAY_MS);
}

export const __agentVersion = AGENT_VERSION;
