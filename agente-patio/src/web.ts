// UI LOCAL servida pelo próprio agente (no servidor interno). Funciona offline.
// Páginas:
//   GET /            -> Pátio ao vivo (quem está dentro, foto + placa + tempo)
//   GET /api/sessoes -> JSON das sessões no pátio
//   GET /fotos/<nome>-> serve a foto salva localmente
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { log } from './logger.js';
import type { Store, Sessao } from './store.js';

function tempoDecorrido(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  return `${h}h${String(min % 60).padStart(2, '0')}`;
}

function horaBR(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function cardSessao(s: Sessao): string {
  const fotoG6 = s.entradaFotoG6 ? `/fotos/${s.entradaFotoG6}` : '';
  const fotoFacial = s.entradaFotoFacial ? `/fotos/${s.entradaFotoFacial}` : '';
  const placa = s.placa ?? 'NÃO LIDA';
  const nome = s.nomeCadastro ? `<div class="nome">${s.nomeCadastro}</div>` : '';
  const badge =
    s.status === 'validada'
      ? `<span class="badge ok">validado${s.validacaoTipo === 'cortesia' ? ' · cortesia' : ''}</span>`
      : `<span class="badge wait">aguardando caixa</span>`;
  return `
    <div class="card">
      <div class="fotos">
        ${fotoG6 ? `<img src="${fotoG6}" alt="carro">` : '<div class="semfoto">sem foto</div>'}
        ${fotoFacial ? `<img src="${fotoFacial}" alt="facial" class="facial">` : ''}
      </div>
      <div class="info">
        <div class="placa">${placa}</div>
        ${nome}
        <div class="meta">entrou ${horaBR(s.entradaEm)} · há ${tempoDecorrido(s.entradaEm)}</div>
        ${badge}
      </div>
    </div>`;
}

function paginaPatio(store: Store): string {
  const sessoes = store.noPatio();
  const cards = sessoes.length
    ? sessoes.map(cardSessao).join('')
    : '<div class="vazio">Nenhum carro no pátio agora 🌅</div>';
  return `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="5">
<title>Pátio ao vivo — Prainha</title>
<style>
  :root{--bg:#1a1410;--card:#2a211a;--gold:#e8a24a;--cream:#f5e9d8;--mut:#a8927a}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--cream);font:15px/1.4 system-ui,sans-serif;padding:20px}
  header{display:flex;align-items:baseline;gap:12px;margin-bottom:18px}
  h1{font-size:22px;color:var(--gold);font-weight:700}
  .cont{color:var(--mut);font-size:14px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
  .card{background:var(--card);border-radius:12px;overflow:hidden;border:1px solid #3a2e22}
  .fotos{position:relative;aspect-ratio:16/9;background:#000}
  .fotos img{width:100%;height:100%;object-fit:cover}
  .fotos .facial{position:absolute;right:8px;bottom:8px;width:64px;height:64px;aspect-ratio:1;
    border-radius:8px;border:2px solid var(--gold);object-fit:cover}
  .semfoto{display:flex;align-items:center;justify-content:center;height:100%;color:var(--mut)}
  .info{padding:12px}
  .placa{font-size:22px;font-weight:800;letter-spacing:2px}
  .nome{color:var(--gold);font-size:14px;margin-top:2px}
  .meta{color:var(--mut);font-size:13px;margin:6px 0}
  .badge{display:inline-block;font-size:12px;padding:3px 9px;border-radius:20px}
  .badge.ok{background:#1f3a24;color:#7fd99a}
  .badge.wait{background:#3a2f1a;color:var(--gold)}
  .vazio{grid-column:1/-1;text-align:center;color:var(--mut);padding:60px}
</style></head><body>
<header><h1>Pátio ao vivo</h1><span class="cont">${sessoes.length} no pátio · atualiza a cada 5s</span></header>
<div class="grid">${cards}</div>
</body></html>`;
}

export function startWeb(store: Store, porta: number) {
  const srv = createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/' || url.startsWith('/?')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(paginaPatio(store));
      return;
    }
    if (url === '/api/sessoes') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(store.noPatio()));
      return;
    }
    if (url.startsWith('/fotos/')) {
      const nome = basename(decodeURIComponent(url.slice('/fotos/'.length)));
      const p = resolve(store.fotosPath, nome);
      if (existsSync(p)) {
        res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=86400' });
        res.end(readFileSync(p));
        return;
      }
    }
    res.writeHead(404);
    res.end('not found');
  });
  srv.listen(porta, '0.0.0.0', () => {
    log.info('UI local no ar', { url: `http://0.0.0.0:${porta}` });
  });
  return srv;
}
