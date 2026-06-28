// UI LOCAL servida pelo próprio agente (no servidor interno). Funciona offline.
// Páginas:
//   GET  /             -> Pátio ao vivo (quem está dentro)
//   GET  /caixa        -> Validar estacionamento (acha pela foto/horário)
//   POST /caixa/validar-> marca a sessão como validada (cortesia | pago)
//   GET  /api/sessoes  -> JSON das sessões no pátio
//   GET  /fotos/<nome> -> serve a foto salva localmente
import { createServer, type IncomingMessage } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { log } from './logger.js';
import type { Store, Sessao } from './store.js';

export interface WebOpts {
  porta: number;
  toleranciaSaidaMin: number;
  tarifaPadraoCentavos: number;
}

function tempoDecorrido(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 60) return `${min}min`;
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}
function horaBR(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function reais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const ESTILO = `
  :root{--bg:#1a1410;--card:#2a211a;--gold:#e8a24a;--cream:#f5e9d8;--mut:#a8927a;--ok:#7fd99a}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--cream);font:15px/1.4 system-ui,sans-serif;padding:20px}
  header{display:flex;align-items:center;gap:16px;margin-bottom:18px;flex-wrap:wrap}
  h1{font-size:22px;color:var(--gold);font-weight:700}
  nav a{color:var(--mut);text-decoration:none;font-size:14px;margin-right:14px}
  nav a.on{color:var(--gold)}
  .cont{color:var(--mut);font-size:14px;margin-left:auto}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
  .card{background:var(--card);border-radius:12px;overflow:hidden;border:1px solid #3a2e22}
  .fotos{position:relative;aspect-ratio:16/9;background:#000}
  .fotos img{width:100%;height:100%;object-fit:cover}
  .fotos .facial{position:absolute;right:8px;bottom:8px;width:64px;height:64px;border-radius:8px;border:2px solid var(--gold);object-fit:cover}
  .semfoto{display:flex;align-items:center;justify-content:center;height:100%;color:var(--mut)}
  .info{padding:12px}
  .placa{font-size:22px;font-weight:800;letter-spacing:2px}
  .nome{color:var(--gold);font-size:14px;margin-top:2px}
  .meta{color:var(--mut);font-size:13px;margin:6px 0}
  .badge{display:inline-block;font-size:12px;padding:3px 9px;border-radius:20px}
  .badge.ok{background:#1f3a24;color:var(--ok)}
  .badge.wait{background:#3a2f1a;color:var(--gold)}
  form{display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap}
  button{background:var(--gold);color:#2a1a08;border:0;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer;font-size:14px}
  button.alt{background:transparent;color:var(--cream);border:1px solid #4a3c2c}
  input[type=number]{width:90px;background:#1a1410;border:1px solid #4a3c2c;color:var(--cream);border-radius:8px;padding:7px;font-size:14px}
  .vazio{grid-column:1/-1;text-align:center;color:var(--mut);padding:60px}
`;

function fotosHtml(s: Sessao): string {
  const g6 = s.entradaFotoG6 ? `/fotos/${s.entradaFotoG6}` : '';
  const fac = s.entradaFotoFacial ? `/fotos/${s.entradaFotoFacial}` : '';
  return `<div class="fotos">${
    g6 ? `<img src="${g6}" alt="carro">` : '<div class="semfoto">sem foto</div>'
  }${fac ? `<img src="${fac}" class="facial" alt="facial">` : ''}</div>`;
}

function pagina(titulo: string, navAtivo: 'patio' | 'caixa', cont: string, corpo: string): string {
  return `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo} — Prainha</title><style>${ESTILO}</style></head><body>
<header><h1>Pátio</h1><nav>
  <a href="/" class="${navAtivo === 'patio' ? 'on' : ''}">Ao vivo</a>
  <a href="/caixa" class="${navAtivo === 'caixa' ? 'on' : ''}">Validar (caixa)</a>
</nav><span class="cont">${cont}</span></header>
${corpo}</body></html>`;
}

function paginaPatio(store: Store): string {
  const ss = store.noPatio();
  const cards = ss.length
    ? ss
        .map((s) => {
          const badge =
            s.status === 'validada'
              ? `<span class="badge ok">validado${s.validacaoTipo === 'cortesia' ? ' · cortesia' : ''}</span>`
              : `<span class="badge wait">aguardando caixa</span>`;
          return `<div class="card">${fotosHtml(s)}<div class="info">
            <div class="placa">${s.placa ?? 'NÃO LIDA'}</div>
            ${s.nomeCadastro ? `<div class="nome">${s.nomeCadastro}</div>` : ''}
            <div class="meta">entrou ${horaBR(s.entradaEm)} · há ${tempoDecorrido(s.entradaEm)}</div>
            ${badge}</div></div>`;
        })
        .join('')
    : '<div class="vazio">Nenhum carro no pátio agora.</div>';
  return pagina('Pátio ao vivo', 'patio', `${ss.length} no pátio · atualiza a cada 5s`,
    `<meta http-equiv="refresh" content="5"><div class="grid">${cards}</div>`);
}

function paginaCaixa(store: Store, opts: WebOpts): string {
  // Só as que ainda não foram validadas (aguardando caixa).
  const ss = store.noPatio().filter((s) => s.status === 'aberta');
  const tarifa = (opts.tarifaPadraoCentavos / 100).toFixed(2);
  const cards = ss.length
    ? ss
        .map(
          (s) => `<div class="card">${fotosHtml(s)}<div class="info">
        <div class="placa">${s.placa ?? 'NÃO LIDA'}</div>
        ${s.nomeCadastro ? `<div class="nome">${s.nomeCadastro}</div>` : ''}
        <div class="meta">entrou ${horaBR(s.entradaEm)} · há ${tempoDecorrido(s.entradaEm)}</div>
        <form method="post" action="/caixa/validar">
          <input type="hidden" name="id" value="${s.id}">
          <button name="tipo" value="cortesia">Cortesia</button>
          <input type="number" step="0.50" min="0" name="valor" value="${tarifa}">
          <button class="alt" name="tipo" value="pago">Cobrar</button>
        </form></div></div>`,
        )
        .join('')
    : '<div class="vazio">Nenhum carro aguardando validação.</div>';
  return pagina('Validar estacionamento', 'caixa',
    `${ss.length} aguardando · tolerância de saída ${opts.toleranciaSaidaMin}min`,
    `<div class="grid">${cards}</div>`);
}

function lerBody(req: IncomingMessage): Promise<URLSearchParams> {
  return new Promise((res) => {
    let b = '';
    req.on('data', (c) => {
      b += c;
      if (b.length > 10000) req.destroy();
    });
    req.on('end', () => res(new URLSearchParams(b)));
  });
}

export function startWeb(store: Store, opts: WebOpts) {
  const srv = createServer(async (req, res) => {
    const url = req.url ?? '/';

    if (req.method === 'POST' && url === '/caixa/validar') {
      const body = await lerBody(req);
      const id = body.get('id') ?? '';
      const tipo = body.get('tipo') === 'cortesia' ? 'cortesia' : 'pago';
      const valorReais = parseFloat((body.get('valor') ?? '0').replace(',', '.')) || 0;
      const valorCobradoCentavos = tipo === 'cortesia' ? 0 : Math.round(valorReais * 100);
      const ate = new Date(Date.now() + opts.toleranciaSaidaMin * 60000).toISOString();
      const s = store.atualizar(id, {
        status: 'validada',
        validadaEm: new Date().toISOString(),
        validacaoTipo: tipo,
        valorCobradoCentavos,
        toleranciaSaidaAte: ate,
      });
      log.info('sessao validada no caixa', { id, tipo, valorCobradoCentavos, ok: !!s });
      res.writeHead(303, { location: '/caixa' });
      res.end();
      return;
    }

    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end();
      return;
    }

    if (url === '/' || url.startsWith('/?')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(paginaPatio(store));
      return;
    }
    if (url === '/caixa') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(paginaCaixa(store, opts));
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
  srv.listen(opts.porta, '0.0.0.0', () => {
    log.info('UI local no ar', { url: `http://0.0.0.0:${opts.porta}` });
  });
  return srv;
}
