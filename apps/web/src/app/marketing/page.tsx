// /marketing — Instagram e TikTok de cada casa (Bar, Tabuará, Mar): conectar a
// conta, ver perfil, seguidores e os últimos posts com os números de cada um.
// Tudo lido AO VIVO da rede (nada de post é gravado); só a ligação fica no
// banco (lib/marketing/ligacao.ts). Próximas etapas: comentários, Direct pela
// Nina e publicar pelo sistema.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { ligacaoRede } from '@/lib/marketing/ligacao';
import { renovarSePreciso } from '@/lib/marketing/chave';
import {
  instagramConfigurado,
  perfilInstagram,
  postsInstagram,
  type PerfilInstagram,
  type PostInstagram,
} from '@/lib/marketing/instagram';
import {
  perfilTiktok,
  tiktokConfigurado,
  videosTiktok,
  type PerfilTiktok,
  type VideoTiktok,
} from '@/lib/marketing/tiktok';
import { Desconectar } from './desconectar';
import { MandarTiktok } from './mandar-tiktok';
import { BaixarTiktok } from './baixar-tiktok';
import { Publicar, type PostVisto } from './publicar';
import { KitPerfil } from './kit-perfil';
import { db, schema } from '@concilia/db';
import { desc, eq } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';
import { temPublicarInstagram } from '@/lib/marketing/instagram';
import { temRascunhoTiktok } from '@/lib/marketing/tiktok';
import { BUCKET_MARKETING } from '@/lib/marketing/midia-link';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// logo oficial pra baixar no kit do perfil (só a casa que já tem arquivo)
const LOGOS: Record<string, string> = {
  '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9': '/marketing/prainha-bar-logo-1024.png', // 01 Prainha Bar
};

const AVISOS: Record<string, { ok: boolean; texto: string }> = {
  ok: { ok: true, texto: 'Conta conectada.' },
  negado: { ok: false, texto: 'A autorização foi cancelada na rede.' },
  estado: { ok: false, texto: 'O retorno da rede não bateu com o clique (passou de 15 min ou outro usuário). Tente de novo.' },
  erro: { ok: false, texto: 'A rede recusou a conexão. Tente de novo; se repetir, confira o app na Meta/TikTok.' },
  'sem-permissao': { ok: false, texto: 'Você não tem permissão pra conectar contas desta casa.' },
  'falta-env': { ok: false, texto: 'Faltam as chaves do app na Vercel (veja abaixo).' },
};

const fmt = (n: number | null | undefined) => (typeof n === 'number' ? n.toLocaleString('pt-BR') : '—');
const dataBr = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }) : '';

type Leitura<P, I> =
  | { estado: 'sem-app' }
  | { estado: 'desligado' }
  | { estado: 'erro'; usuario: string; erro: string }
  | { estado: 'ok'; perfil: P; itens: I[]; itensErro?: string };

async function lerInstagram(filialId: string): Promise<Leitura<PerfilInstagram, PostInstagram>> {
  if (!instagramConfigurado()) return { estado: 'sem-app' };
  const l0 = await ligacaoRede(filialId, 'instagram');
  if (!l0) return { estado: 'desligado' };
  try {
    const l = await renovarSePreciso(filialId, 'instagram', l0);
    const perfil = await perfilInstagram(l.accessToken);
    try {
      return { estado: 'ok', perfil, itens: await postsInstagram(l.accessToken) };
    } catch (e) {
      return { estado: 'ok', perfil, itens: [], itensErro: e instanceof Error ? e.message : String(e) };
    }
  } catch (e) {
    return { estado: 'erro', usuario: l0.usuario, erro: e instanceof Error ? e.message : String(e) };
  }
}

async function lerTiktok(filialId: string): Promise<Leitura<PerfilTiktok, VideoTiktok>> {
  if (!tiktokConfigurado()) return { estado: 'sem-app' };
  const l0 = await ligacaoRede(filialId, 'tiktok');
  if (!l0) return { estado: 'desligado' };
  try {
    const l = await renovarSePreciso(filialId, 'tiktok', l0);
    const perfil = await perfilTiktok(l.accessToken);
    try {
      return { estado: 'ok', perfil, itens: await videosTiktok(l.accessToken) };
    } catch (e) {
      return { estado: 'ok', perfil, itens: [], itensErro: e instanceof Error ? e.message : String(e) };
    }
  } catch (e) {
    return { estado: 'erro', usuario: l0.usuario, erro: e instanceof Error ? e.message : String(e) };
  }
}

/** Últimos posts feitos pela tela Publicar, com a 1ª foto assinada pra miniatura. */
async function lerPostsPublicar(filialId: string): Promise<PostVisto[]> {
  const T = schema.marketingPost;
  const linhas = await db.select().from(T).where(eq(T.filialId, filialId)).orderBy(desc(T.criadoEm)).limit(20);
  const capas = new Map<string, string>();
  const fotos = linhas.map((l) => l.midias.find((m) => m.tipo === 'foto')?.path).filter((x): x is string => !!x);
  if (fotos.length) {
    try {
      const admin = await createAdminClient();
      const { data } = await admin.storage.from(BUCKET_MARKETING).createSignedUrls(fotos, 3600);
      for (const d of data ?? []) if (d.path && d.signedUrl) capas.set(d.path, d.signedUrl);
    } catch {
      // sem miniatura: a lista mostra o ícone
    }
  }
  return linhas.map((l) => {
    const foto = l.midias.find((m) => m.tipo === 'foto')?.path;
    return {
      id: l.id,
      status: l.status,
      legenda: l.legenda,
      redes: l.redes,
      midias: l.midias.map((m) => ({ tipo: m.tipo, nome: m.nome })),
      capa: foto ? (capas.get(foto) ?? null) : null,
      agendadoPara: l.agendadoPara ? l.agendadoPara.toISOString() : null,
      criadoEm: l.criadoEm.toISOString(),
      publicadoEm: l.publicadoEm ? l.publicadoEm.toISOString() : null,
      erro: l.erro,
      resultado: (l.resultado ?? {}) as PostVisto['resultado'],
    };
  });
}

function Numero({ rotulo, valor }: { rotulo: string; valor: number | null | undefined }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{rotulo}</p>
      <p className="text-lg font-semibold text-slate-900">{fmt(valor)}</p>
    </div>
  );
}

function Conectar({ href, rotulo, cor }: { href: string; rotulo: string; cor: string }) {
  return (
    <a href={href} className={`inline-block rounded-md px-3 py-1.5 text-sm font-medium text-white ${cor}`}>
      {rotulo}
    </a>
  );
}

export default async function MarketingPage(props: {
  searchParams: Promise<{ filialId?: string; aviso?: string; rede?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'atendimento.read');
  const podeConectar = await podeUsuario(user.id, 'atendimento.config');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const escolhida = await escolherFilial(filiais, sp.filialId);
  if (!escolhida) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <section className="mx-auto max-w-3xl px-4 py-10">
          <p className="text-sm text-slate-500">Nenhuma casa disponível.</p>
        </section>
      </main>
    );
  }
  const filial = escolhida;

  const [ig, tt, ligIg, ligTt, postsFeitos] = await Promise.all([
    lerInstagram(filial.id),
    lerTiktok(filial.id),
    podeConectar ? ligacaoRede(filial.id, 'instagram').catch(() => null) : null,
    podeConectar ? ligacaoRede(filial.id, 'tiktok').catch(() => null) : null,
    podeConectar ? lerPostsPublicar(filial.id).catch(() => [] as PostVisto[]) : ([] as PostVisto[]),
  ]);
  const aviso = sp.aviso ? AVISOS[sp.aviso] : null;
  const nomeRede = sp.rede === 'tiktok' ? 'TikTok' : 'Instagram';
  const conectarHref = (rede: string) => `/api/marketing/${rede}/conectar?filialId=${filial.id}`;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Marketing</h1>
            <p className="text-sm text-slate-500">Instagram e TikTok de cada casa, lidos ao vivo.</p>
          </div>
          <nav className="flex flex-wrap gap-1">
            {filiais.map((f) => (
              <a
                key={f.id}
                href={`/marketing?filialId=${f.id}`}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  f.id === filial.id ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                {f.nome}
              </a>
            ))}
          </nav>
        </div>

        {aviso && (
          <p
            className={`mt-4 rounded-md px-3 py-2 text-sm ${
              aviso.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
            }`}
          >
            {nomeRede}: {aviso.texto}
          </p>
        )}

        {podeConectar && (ig.estado === 'ok' || tt.estado === 'ok' || postsFeitos.length > 0) && (
          <Publicar
            filialId={filial.id}
            casa={filial.nome}
            redes={{
              igLigado: ig.estado === 'ok',
              igPodePublicar: !!ligIg && temPublicarInstagram(ligIg.escopos),
              ttLigado: tt.estado === 'ok',
              ttRascunho: !!ligTt && temRascunhoTiktok(ligTt.escopos),
            }}
            posts={postsFeitos}
          />
        )}

        {podeConectar && <KitPerfil filialId={filial.id} casa={filial.nome} logo={LOGOS[filial.id] ?? null} />}

        {/* INSTAGRAM */}
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">📸 Instagram</h2>
            {ig.estado === 'ok' && podeConectar && <Desconectar filialId={filial.id} rede="instagram" nome="Instagram" />}
          </div>

          {ig.estado === 'sem-app' && (
            <p className="mt-2 text-sm text-slate-600">
              O app do Instagram ainda não está ligado ao sistema. Faltam na Vercel: <code>INSTAGRAM_APP_ID</code> e{' '}
              <code>INSTAGRAM_APP_SECRET</code>.
            </p>
          )}
          {ig.estado === 'desligado' && (
            <div className="mt-2 text-sm text-slate-600">
              <p>A conta do Instagram da {filial.nome} não está conectada.</p>
              {podeConectar ? (
                <div className="mt-2">
                  <Conectar href={conectarHref('instagram')} rotulo="Conectar Instagram" cor="bg-pink-600 hover:bg-pink-700" />
                  <p className="mt-1 text-xs text-slate-500">
                    Entre com a conta profissional (Empresa ou Criador) desta casa. Se o navegador abrir em outra conta, troque lá.
                  </p>
                </div>
              ) : (
                <p className="mt-1 text-xs text-slate-500">Peça pra quem configura a Nina conectar.</p>
              )}
            </div>
          )}
          {ig.estado === 'erro' && (
            <div className="mt-2 text-sm text-rose-700">
              <p>
                Não deu pra ler {ig.usuario ? `@${ig.usuario}` : 'a conta'}: {ig.erro}
              </p>
              {podeConectar && (
                <div className="mt-2">
                  <Conectar href={conectarHref('instagram')} rotulo="Conectar de novo" cor="bg-pink-600 hover:bg-pink-700" />
                </div>
              )}
            </div>
          )}
          {ig.estado === 'ok' && (
            <>
              <div className="mt-3 flex items-center gap-3">
                {ig.perfil.foto && <img src={ig.perfil.foto} alt="" className="h-12 w-12 rounded-full object-cover" />}
                <div>
                  <a
                    href={`https://instagram.com/${ig.perfil.usuario}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-slate-900 hover:underline"
                  >
                    @{ig.perfil.usuario}
                  </a>
                  {ig.perfil.nome && <p className="text-xs text-slate-500">{ig.perfil.nome}</p>}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 sm:max-w-md">
                <Numero rotulo="Seguidores" valor={ig.perfil.seguidores} />
                <Numero rotulo="Seguindo" valor={ig.perfil.seguindo} />
                <Numero rotulo="Posts" valor={ig.perfil.posts} />
              </div>
              {ig.itensErro && <p className="mt-3 text-sm text-rose-700">Posts: {ig.itensErro}</p>}
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {ig.itens.map((p) => (
                  <div key={p.id} className="overflow-hidden rounded-lg border border-slate-200 hover:shadow">
                  <a href={p.link} target="_blank" rel="noreferrer" className="block">
                    {p.imagem ? (
                      <img src={p.imagem} alt="" className="aspect-square w-full object-cover" />
                    ) : (
                      <div className="aspect-square w-full bg-slate-100" />
                    )}
                    <div className="p-2 text-xs text-slate-700">
                      <p className="text-slate-500">
                        {dataBr(p.quando)} · {p.produto === 'REELS' ? 'Reels' : p.tipo === 'CAROUSEL_ALBUM' ? 'Carrossel' : p.tipo === 'VIDEO' ? 'Vídeo' : 'Foto'}
                      </p>
                      <p className="mt-0.5 line-clamp-2">{p.legenda || '—'}</p>
                      <p className="mt-1 flex flex-wrap gap-x-2 text-slate-600">
                        <span>❤️ {fmt(p.curtidas)}</span>
                        <span>💬 {fmt(p.comentarios)}</span>
                        {p.views !== null && <span>👁 {fmt(p.views)}</span>}
                        {p.alcance !== null && <span>📣 {fmt(p.alcance)}</span>}
                        {p.salvos !== null && <span>🔖 {fmt(p.salvos)}</span>}
                        {p.compartilhamentos !== null && <span>↗ {fmt(p.compartilhamentos)}</span>}
                      </p>
                    </div>
                  </a>
                  {tt.estado === 'ok' && podeConectar && <MandarTiktok filialId={filial.id} postId={p.id} />}
                  {podeConectar && <BaixarTiktok filialId={filial.id} postId={p.id} />}
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">👁 visualizações · 📣 alcance (pessoas) · 🔖 salvos · ↗ compartilhamentos</p>
              {tt.estado === 'ok' && podeConectar && (
                <p className="mt-1 text-[11px] text-slate-400">
                  🎵 Mandar pro TikTok = vai pro rascunho/caixa de entrada do TikTok desta casa; quem publica é você, pelo app do TikTok.
                </p>
              )}
              {podeConectar && (
                <p className="mt-1 text-[11px] text-slate-400">
                  📲 Baixar pro TikTok = pelo celular, salva a foto no tamanho do TikTok e copia a legenda; no TikTok, toque em +, escolha da galeria e cole a legenda.
                </p>
              )}
            </>
          )}
        </div>

        {/* TIKTOK */}
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">🎵 TikTok</h2>
            {tt.estado === 'ok' && podeConectar && <Desconectar filialId={filial.id} rede="tiktok" nome="TikTok" />}
          </div>

          {tt.estado === 'sem-app' && (
            <p className="mt-2 text-sm text-slate-600">
              O app do TikTok ainda não está ligado ao sistema. Faltam na Vercel: <code>TIKTOK_CLIENT_KEY</code> e{' '}
              <code>TIKTOK_CLIENT_SECRET</code>.
            </p>
          )}
          {tt.estado === 'desligado' && (
            <div className="mt-2 text-sm text-slate-600">
              <p>A conta do TikTok da {filial.nome} não está conectada.</p>
              {podeConectar ? (
                <div className="mt-2">
                  <Conectar href={conectarHref('tiktok')} rotulo="Conectar TikTok" cor="bg-slate-900 hover:bg-black" />
                </div>
              ) : (
                <p className="mt-1 text-xs text-slate-500">Peça pra quem configura a Nina conectar.</p>
              )}
            </div>
          )}
          {tt.estado === 'erro' && (
            <div className="mt-2 text-sm text-rose-700">
              <p>
                Não deu pra ler {tt.usuario ? `@${tt.usuario}` : 'a conta'}: {tt.erro}
              </p>
              {podeConectar && (
                <div className="mt-2">
                  <Conectar href={conectarHref('tiktok')} rotulo="Conectar de novo" cor="bg-slate-900 hover:bg-black" />
                </div>
              )}
            </div>
          )}
          {tt.estado === 'ok' && (
            <>
              <div className="mt-3 flex items-center gap-3">
                {tt.perfil.foto && <img src={tt.perfil.foto} alt="" className="h-12 w-12 rounded-full object-cover" />}
                <div>
                  <a
                    href={tt.perfil.link ?? (tt.perfil.usuario ? `https://www.tiktok.com/@${tt.perfil.usuario}` : '#')}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {tt.perfil.usuario ? `@${tt.perfil.usuario}` : tt.perfil.nome}
                  </a>
                  {tt.perfil.usuario && tt.perfil.nome && <p className="text-xs text-slate-500">{tt.perfil.nome}</p>}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:max-w-xl sm:grid-cols-4">
                <Numero rotulo="Seguidores" valor={tt.perfil.seguidores} />
                <Numero rotulo="Seguindo" valor={tt.perfil.seguindo} />
                <Numero rotulo="Curtidas" valor={tt.perfil.curtidas} />
                <Numero rotulo="Vídeos" valor={tt.perfil.videos} />
              </div>
              {tt.itensErro && <p className="mt-3 text-sm text-rose-700">Vídeos: {tt.itensErro}</p>}
              {!tt.itensErro && tt.itens.length === 0 && (
                <p className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-600">
                  Nenhum vídeo publicado nesta conta do TikTok ainda. O que vai pelo “Mandar pro TikTok” fica no
                  rascunho/caixa de entrada do app do TikTok e só aparece aqui depois que for publicado lá.
                </p>
              )}
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {tt.itens.map((v) => (
                  <a
                    key={v.id}
                    href={v.link}
                    target="_blank"
                    rel="noreferrer"
                    className="overflow-hidden rounded-lg border border-slate-200 hover:shadow"
                  >
                    {v.capa ? (
                      <img src={v.capa} alt="" className="aspect-[9/12] w-full object-cover" />
                    ) : (
                      <div className="aspect-[9/12] w-full bg-slate-100" />
                    )}
                    <div className="p-2 text-xs text-slate-700">
                      <p className="text-slate-500">{dataBr(v.quando)}</p>
                      <p className="mt-0.5 line-clamp-2">{v.titulo || '—'}</p>
                      <p className="mt-1 flex flex-wrap gap-x-2 text-slate-600">
                        <span>👁 {fmt(v.views)}</span>
                        <span>❤️ {fmt(v.curtidas)}</span>
                        <span>💬 {fmt(v.comentarios)}</span>
                        <span>↗ {fmt(v.compartilhamentos)}</span>
                      </p>
                    </div>
                  </a>
                ))}
              </div>
            </>
          )}
        </div>

        <p className="mt-6 text-xs text-slate-400">
          Em breve aqui: responder comentários do Instagram, Direct atendido pela Nina e publicar posts pelo sistema
          (o bloco 📤 Publicar já agenda e manda pro TikTok; no Instagram sai assim que a Meta liberar a permissão de publicar).
          O TikTok não libera comentários nem mensagens pra sistemas de fora.
        </p>
      </section>
    </main>
  );
}
