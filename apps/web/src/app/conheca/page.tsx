// /conheca — site público do Concilia como sistema (SaaS) — 02/11/2026.
// Porta de entrada de quem baixou o Concilia na maquininha e quer saber o
// resto: o que o sistema faz, a consultoria, os planos e o "Quero começar"
// (grava em saas_interessado). O app da demo abre aqui por QR (?origem=app_demo).
// Preços = tabela de partida de 02/11 (artifact Mu27fJJNRHd7qC4RadaHmQ), sem a
// parte de custo/margem que é interna.

import type { Metadata } from 'next';
import QRCode from 'qrcode-svg';
import { FormComecar } from './form';
import { FormCadastro } from './form-cadastro';
import { MontePlano } from './monte-plano';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Concilia — ERP completo para restaurantes',
  description:
    'ERP completo para restaurantes: maquininha, cozinha, nota fiscal, estoque, compras, financeiro, RH (ponto, escala e folha), clientes e a infraestrutura da loja num lugar só. Comece grátis pela maquininha e conte com consultoria de quem opera restaurante.',
  openGraph: {
    title: 'Concilia — ERP completo para restaurantes',
    description: 'Comece grátis pela maquininha. Planos a partir de R$ 199/mês.',
    type: 'website',
    locale: 'pt_BR',
    siteName: 'Concilia',
  },
};

const MODULOS: { titulo: string; preco: string; itens: string[]; base?: boolean }[] = [
  {
    titulo: 'Vendas e cozinha',
    preco: 'na base',
    base: true,
    itens: [
      'Garçom lança mesa e comanda na maquininha',
      'Pedido cai na tela da cozinha e do bar (KDS)',
      'Receber, dividir e fechar conta na mesa',
      'Caixa no navegador e cardápio no QR com Pix',
    ],
  },
  {
    titulo: 'Fiscal',
    preco: 'R$ 99',
    itens: [
      'NFC-e e NF-e',
      'Nota de compra pela SEFAZ, lendo a chave pelo celular',
      'XML e arquivos prontos pro contador',
    ],
  },
  {
    titulo: 'Retaguarda',
    preco: 'R$ 149',
    itens: [
      'Estoque por setor e contagem',
      'Cotação com fornecedor pelo WhatsApp',
      'Ficha técnica e custo do prato (CMV)',
    ],
  },
  {
    titulo: 'Financeiro',
    preco: 'R$ 149',
    itens: [
      'Contas a pagar e a receber',
      'Conciliação de cartão e banco: mostra o que não entrou',
      'Caixa, boletos, Pix e fechamento do mês',
    ],
  },
  {
    titulo: 'Delivery',
    preco: 'R$ 99',
    itens: ['iFood integrado, pedido direto na cozinha', 'Site de delivery próprio em 5 idiomas'],
  },
  {
    titulo: 'Relacionamento',
    preco: 'R$ 129',
    itens: [
      'Reservas com confirmação no WhatsApp',
      'Cliente VIP com cartão na carteira do celular',
      'Avaliações do Google e TripAdvisor, vale-presente',
    ],
  },
  {
    titulo: 'Equipe (RH)',
    preco: 'R$ 99 + R$ 5/func.',
    itens: [
      'Escala do mês e banco de horas',
      'Ponto pelo celular com GPS e selfie',
      'Folha, vale-transporte e atestado',
    ],
  },
  {
    titulo: 'Atendimento virtual',
    preco: 'R$ 249',
    itens: [
      'Atendente no WhatsApp com o nome que você escolher',
      'Responde, tira dúvida, faz reserva e vende vale-presente',
      '500 conversas por mês (+ R$ 0,40 a extra)',
    ],
  },
];

const PACOTES = [
  { nome: 'Essencial', inclui: 'Base + Fiscal', precos: ['279', '429', '629'] },
  { nome: 'Gestão', inclui: 'Base + Fiscal + Retaguarda + Financeiro', precos: ['499', '649', '849'], destaque: true },
  { nome: 'Completo', inclui: 'Base + todos os módulos (RH cobra R$ 5 por funcionário)', precos: ['699', '849', '1.049'] },
];

const CONSULTORIA = [
  { t: 'Implantação assistida', d: 'Cadastro do cardápio, certificado digital, nota na SEFAZ e treinamento da equipe. R$ 500, uma vez.' },
  { t: 'Custo do prato e cardápio', d: 'Ficha técnica, CMV e preço de venda que fecha a conta.' },
  { t: 'Escala e equipe', d: 'Escala pelo movimento real, banco de horas e folha sem surpresa.' },
  { t: 'Dinheiro que não entrou', d: 'Conferência de cartão, Pix e caixa contra o banco, todo dia.' },
];

// Restaurante de exemplo (vendas-local da demo, Fly). Login do garçom de teste.
const DEMO = (process.env.SAAS_DEMO_URL || 'https://concilia-demo.fly.dev').replace(/\/$/, '');

const TELAS_DEMO: { emoji: string; t: string; d: string; path: string; login?: boolean }[] = [
  { emoji: '🧑‍🍳', t: 'Tela da cozinha (KDS)', d: 'Escolha a praça e deixe aberta. O pedido aparece aqui.', path: '/tv' },
  { emoji: '📱', t: 'Garçom', d: 'Abra uma mesa, lance os itens e mande pra cozinha.', path: '/venda', login: true },
  { emoji: '🍽️', t: 'Cardápio do cliente', d: 'O que o cliente vê no QR da mesa: pede, chama o garçom e paga no Pix.', path: '/mesa' },
  { emoji: '🍹', t: 'Totem de autoatendimento', d: 'Cliente pede sozinho e retira no balcão.', path: '/totem' },
  { emoji: '💵', t: 'Caixa', d: 'Mesas abertas, receber, dividir e fechar conta.', path: '/caixa', login: true },
  { emoji: '📊', t: 'Painel do gerente', d: 'Venda do dia e o que está acontecendo no salão.', path: '/gerente', login: true },
];

const PERGUNTAS = [
  {
    p: 'A demonstração é só minha?',
    r: 'Não. A demonstração é um restaurante de exemplo aberto pra todo mundo: o que você lança, outros visitantes também podem ver, e ela é zerada de tempos em tempos. Não coloque dados reais nela. Quando você começa (grátis ou pago), recebe a sua loja, separada, só com os seus dados.',
  },
  {
    p: 'Como coloco os dados do meu restaurante?',
    r: 'Preencha o "Comece grátis". A gente cria a sua loja, separada de todas as outras, e te ajuda a subir o cardápio (pode mandar foto ou planilha do cardápio que a gente cadastra). Depois é baixar o app na maquininha, entrar com o código da sua loja e vender. Se quiser tudo feito por nós, inclusive nota fiscal e treinamento da equipe, tem a implantação assistida.',
  },
  {
    p: 'O Concilia é só conciliação financeira?',
    r: 'Não. O nome vem de onde ele começou, mas hoje é um ERP completo de restaurante: vendas na maquininha e no caixa, cozinha (KDS), nota fiscal, estoque e compras, contas a pagar e receber, conciliação de cartão e banco, RH (ponto facial ou pelo celular, escala, banco de horas e folha), clientes e fidelidade, delivery, atendimento virtual no WhatsApp e a infraestrutura da loja (servidor local, impressoras e rede).',
  },
  {
    p: 'Preciso de computador na loja?',
    r: 'Não. O Concilia roda na internet: maquininha, tela da cozinha e caixa no navegador. O computador na loja (Estação local) só entra se você quiser impressora na cozinha, cupom na térmica, ponto facial ou vender com a internet fora.',
  },
  {
    p: 'Com qual maquininha funciona?',
    r: 'Com a Cielo LIO. O app Concilia é baixado na própria maquininha.',
  },
  {
    p: 'Posso testar antes?',
    r: 'Pode, agora, pelo celular: veja "Veja a cozinha recebendo o pedido" no começo da página (login teste, PIN 1234). Na maquininha, abra o Concilia, digite o código demo e venda à vontade num restaurante de exemplo. O plano Grátis serve pra uma maquininha até R$ 20 mil por mês.',
  },
  {
    p: 'Emite nota fiscal?',
    r: 'Sim, com o módulo Fiscal (ou qualquer pacote): NFC-e e NF-e. A nota vai por QR, WhatsApp ou sai na bobina da maquininha.',
  },
  {
    p: 'Como faço pra contratar?',
    r: 'Crie sua conta aqui embaixo com CPF ou CNPJ: são 15 dias com todos os módulos, sem cartão. No fim do teste, se quiser continuar, paga a mensalidade por Pix. Prefere conversar antes? Abra "Prefere que a gente te chame?" e a gente monta o plano com você.',
  },
];

export default async function ConhecaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const origem = typeof sp.origem === 'string' ? sp.origem.slice(0, 40) : 'site';
  const zap = (process.env.SAAS_WHATSAPP || '').replace(/\D/g, '');
  const plano = typeof sp.plano === 'string' ? sp.plano.slice(0, 20) : undefined;

  return (
    <main className="min-h-screen bg-[#f6f4ef] text-[#1b2430]">
      {/* Topo */}
      <header className="bg-[#0f2a33] text-white">
        <div className="mx-auto max-w-5xl px-4 pb-14 pt-8 sm:pb-20">
          <div className="flex items-center justify-between">
            <span className="text-lg font-bold tracking-tight">Concilia</span>
            <a href="#comecar" className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20">
              Quero começar
            </a>
          </div>
          <p className="mt-12 text-sm font-semibold uppercase tracking-widest text-[#f2b134]">
            ERP completo para restaurantes
          </p>
          <h1 className="mt-3 max-w-3xl text-4xl font-bold leading-tight sm:text-5xl">
            O sistema que roda o restaurante inteiro, da maquininha ao fechamento do mês.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-white/80">
            Muito mais que conciliação: vendas, cozinha, nota fiscal, estoque e compras, financeiro, RH com ponto,
            escala e folha, clientes e a infraestrutura da loja num lugar só. Feito dentro de restaurantes em
            operação, com consultoria de quem vive o dia a dia do salão.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="?plano=gratis#comecar"
              className="rounded-lg bg-[#f2b134] px-5 py-3 font-semibold text-[#1b2430] hover:bg-[#f5c158]"
            >
              Começar grátis
            </a>
            <a href="#testar" className="rounded-lg bg-white px-5 py-3 font-semibold text-[#0f2a33] hover:bg-white/90">
              Testar agora no celular
            </a>
            <a href="#planos" className="rounded-lg border border-white/30 px-5 py-3 font-semibold hover:bg-white/10">
              Ver planos
            </a>
          </div>
          <p className="mt-4 text-sm text-white/70">
            R$ 0 em 1 maquininha · sem cartão de crédito · teste sem cadastro
          </p>
        </div>
      </header>

      {/* Teste agora no celular */}
      <section id="testar" className="scroll-mt-4 bg-[#fdf3dc]">
        <div className="mx-auto max-w-5xl px-4 py-14">
          <p className="text-sm font-semibold uppercase tracking-widest text-[#b7791f]">Sem cadastro, agora</p>
          <h2 className="mt-2 text-2xl font-bold sm:text-3xl">Veja a cozinha recebendo o pedido</h2>
          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_260px]">
            <ol className="space-y-3">
              {[
                <>
                  Abra a <b>tela da cozinha</b> no computador ou num celular e escolha uma praça (Cozinha, Bar…).
                </>,
                <>
                  No celular, abra o <b>garçom</b> e entre com login <b className="font-mono">teste</b> e PIN{' '}
                  <b className="font-mono">1234</b>.
                </>,
                <>Abra uma mesa, lance um prato e uma bebida e toque em enviar.</>,
                <>Em segundos o pedido aparece na tela da cozinha. Dê a baixa quando ficar pronto.</>,
              ].map((passo, i) => (
                <li key={i} className="flex gap-3 rounded-xl bg-white p-4 ring-1 ring-black/5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0f2a33] text-sm font-bold text-white">
                    {i + 1}
                  </span>
                  <span className="text-[15px] text-[#3d4a58]">{passo}</span>
                </li>
              ))}
            </ol>
            <div className="hidden rounded-xl bg-white p-5 text-center ring-1 ring-black/5 lg:block">
              <div
                className="mx-auto w-[168px]"
                dangerouslySetInnerHTML={{
                  __html: new QRCode({
                    content: `${DEMO}/venda`,
                    padding: 2,
                    width: 168,
                    height: 168,
                    color: '#0f2a33',
                    background: '#ffffff',
                    ecl: 'M',
                    join: true,
                  }).svg(),
                }}
              />
              <p className="mt-3 text-sm font-semibold">Aponte a câmera do celular</p>
              <p className="mt-1 text-xs text-[#5a6878]">abre o garçom · login teste · PIN 1234</p>
              <a
                href={`${DEMO}/tv`}
                target="_blank"
                rel="noopener"
                className="mt-4 block rounded-lg bg-[#0f2a33] px-4 py-2.5 text-sm font-semibold text-white"
              >
                Abrir a cozinha aqui
              </a>
            </div>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TELAS_DEMO.map((t) => (
              <a
                key={t.path}
                href={`${DEMO}${t.path}`}
                target="_blank"
                rel="noopener"
                className="group flex gap-3 rounded-xl bg-white p-4 ring-1 ring-black/5 hover:ring-[#0b7a83]/50"
              >
                <span className="text-2xl" aria-hidden>
                  {t.emoji}
                </span>
                <span className="flex-1">
                  <span className="flex items-center justify-between gap-2 font-semibold">
                    {t.t}
                    <span className="text-[#0b7a83] transition group-hover:translate-x-0.5">→</span>
                  </span>
                  <span className="mt-0.5 block text-[13px] text-[#5a6878]">{t.d}</span>
                  {t.login && <span className="mt-1 block text-xs text-[#b7791f]">login teste · PIN 1234</span>}
                </span>
              </a>
            ))}
          </div>
          <p className="mt-4 text-sm text-[#5a6878]">
            É um restaurante de exemplo aberto pra todo mundo e zerado de tempos em tempos. Não coloque dados reais.
            Quer o seu, só com os seus dados?{' '}
            <a href="?plano=gratis#comecar" className="font-semibold text-[#0b7a83] underline">
              Comece grátis
            </a>
            .
          </p>
        </div>
      </section>

      {/* Testar */}
      <section className="mx-auto max-w-5xl px-4 py-14">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { n: '1', t: 'Teste na maquininha', d: 'Abra o Concilia na Cielo LIO, digite o código demo e venda num restaurante de exemplo.' },
            { n: '2', t: 'Comece grátis', d: 'Uma maquininha, até R$ 20 mil por mês, com cozinha e cardápio no QR. Sem nota fiscal.' },
            { n: '3', t: 'Cresça por módulo', d: 'Some nota, estoque, financeiro, delivery, equipe e atendimento quando precisar.' },
          ].map((s) => (
            <div key={s.n} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-black/5">
              <span className="text-sm font-bold text-[#0b7a83]">{s.n}</span>
              <h3 className="mt-1 text-lg font-bold">{s.t}</h3>
              <p className="mt-2 text-[15px] text-[#5a6878]">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Módulos */}
      <section className="mx-auto max-w-5xl px-4 pb-14">
        <h2 className="text-2xl font-bold sm:text-3xl">O que o Concilia faz</h2>
        <p className="mt-2 max-w-2xl text-[#5a6878]">
          Contrate só o que precisa. A base vem em todo plano. Os módulos você soma quando quiser, avulsos ou em
          pacote com desconto, e tira quando não usar mais.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {MODULOS.map((m) => (
            <div
              key={m.titulo}
              className={`flex flex-col rounded-xl p-5 ring-1 ${m.base ? 'bg-[#e2f2f3] ring-[#0b7a83]/40' : 'bg-white ring-black/5'}`}
            >
              <h3 className="font-bold">{m.titulo}</h3>
              <span className="mt-1 text-sm font-semibold text-[#0b7a83]">
                {m.base ? 'Incluso na base' : `${m.preco}/mês`}
              </span>
              <ul className="mt-3 space-y-1.5 text-[14px] text-[#3d4a58]">
                {m.itens.map((i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-[#0b7a83]">•</span>
                    <span>{i}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Consultoria */}
      <section className="bg-[#0f2a33] text-white">
        <div className="mx-auto max-w-5xl px-4 py-14">
          <h2 className="text-2xl font-bold sm:text-3xl">Consultoria para restaurantes</h2>
          <p className="mt-2 max-w-2xl text-white/75">
            O sistema nasceu de problemas reais de restaurante. A consultoria leva junto o que a gente aprendeu
            resolvendo cada um deles.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {CONSULTORIA.map((c) => (
              <div key={c.t} className="rounded-xl bg-white/5 p-5 ring-1 ring-white/10">
                <h3 className="font-bold text-[#f2b134]">{c.t}</h3>
                <p className="mt-2 text-[15px] text-white/80">{c.d}</p>
              </div>
            ))}
          </div>
          <a href="#comecar" className="mt-6 inline-block rounded-lg bg-[#f2b134] px-5 py-3 font-semibold text-[#1b2430]">
            Quero conversar sobre consultoria
          </a>
        </div>
      </section>

      {/* Planos */}
      <section id="planos" className="mx-auto max-w-5xl scroll-mt-4 px-4 py-14">
        <h2 className="text-2xl font-bold sm:text-3xl">Monte o seu plano</h2>
        <p className="mt-2 max-w-2xl text-[#5a6878]">
          Marque os módulos e veja quanto fica. Se um pacote sair mais barato, a conta já mostra.
        </p>
        <MontePlano />

        <h2 className="mt-14 text-2xl font-bold sm:text-3xl">Planos</h2>
        <p className="mt-2 max-w-2xl text-[#5a6878]">
          Preço por loja, por mês. A faixa é o número de maquininhas. Cozinha (KDS), caixa e cardápio no QR vêm em
          todos.
        </p>

        <div className="mt-6 rounded-xl border border-[#f2b134] bg-[#fdf3dc] p-5">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-3xl font-bold">R$ 0</span>
            <span className="font-semibold">Plano Grátis</span>
          </div>
          <p className="mt-2 text-[15px] text-[#3d4a58]">
            1 maquininha, até R$ 20 mil vendidos por mês. Lançar, receber, dividir e fechar conta, cozinha na tela e
            cardápio no QR. Sem nota fiscal. Passou do limite, o sistema avisa e não trava o serviço.
          </p>
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
          <table className="w-full min-w-[560px] text-left text-[15px]">
            <thead className="bg-[#f6f4ef] text-xs uppercase tracking-wide text-[#5a6878]">
              <tr>
                <th className="px-4 py-3">Plano</th>
                <th className="px-4 py-3 text-right">Até 5 maquininhas</th>
                <th className="px-4 py-3 text-right">6 a 10</th>
                <th className="px-4 py-3 text-right">11 a 20</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-black/5">
                <td className="px-4 py-3">
                  <b>Base</b>
                  <span className="block text-sm text-[#5a6878]">Vendas e cozinha</span>
                </td>
                {['199', '349', '549'].map((p) => (
                  <td key={p} className="px-4 py-3 text-right font-bold tabular-nums">R$ {p}</td>
                ))}
              </tr>
              {PACOTES.map((p) => (
                <tr key={p.nome} className={`border-t border-black/5 ${p.destaque ? 'bg-[#e2f2f3]/60' : ''}`}>
                  <td className="px-4 py-3">
                    <b>{p.nome}</b>
                    {p.destaque && (
                      <span className="ml-2 rounded-full bg-[#0b7a83] px-2 py-0.5 text-xs font-semibold text-white">
                        mais escolhido
                      </span>
                    )}
                    <span className="block text-sm text-[#5a6878]">{p.inclui}</span>
                  </td>
                  {p.precos.map((v) => (
                    <td key={v} className="px-4 py-3 text-right font-bold tabular-nums">R$ {v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-[#5a6878]">Mais de 20 maquininhas: sob consulta.</p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl bg-white p-5 ring-1 ring-black/5">
            <h3 className="font-bold">Estação local (opcional)</h3>
            <p className="mt-2 text-[15px] text-[#3d4a58]">
              Computador na loja com o servidor do Concilia: impressora na cozinha e no bar, cupom na térmica, ponto
              facial no tablet e venda mesmo com a internet fora.
            </p>
            <p className="mt-3 text-[15px]">
              <b>R$ 990</b> de instalação + <b>R$ 99/mês</b>
              <span className="block text-sm text-[#5a6878]">Computador seu, ou alugado por R$ 79/mês</span>
            </p>
          </div>
          <div className="rounded-xl bg-white p-5 ring-1 ring-black/5">
            <h3 className="font-bold">Mensagens automáticas</h3>
            <p className="mt-2 text-[15px] text-[#3d4a58]">
              Lembrete e confirmação de reserva, cotação e pedido ao fornecedor e campanhas no WhatsApp.
            </p>
            <p className="mt-3 text-[15px]">
              <b>Custo da Meta</b>, repassado sem margem
            </p>
          </div>
        </div>
      </section>

      {/* Como começar */}
      <section className="mx-auto max-w-5xl px-4 pb-14">
        <h2 className="text-2xl font-bold sm:text-3xl">Do teste à sua loja funcionando</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {[
            {
              n: '1',
              t: 'Cadastro em 2 minutos',
              d: 'Nome, WhatsApp e o nome do restaurante. Sem cartão de crédito.',
            },
            {
              n: '2',
              t: 'A sua loja, separada',
              d: 'A gente cria a sua loja só com os seus dados e sobe o seu cardápio (manda foto ou planilha).',
            },
            {
              n: '3',
              t: 'Vendendo no mesmo dia',
              d: 'Baixe o Concilia na maquininha, entre com o código da sua loja e abra a primeira mesa.',
            },
          ].map((s) => (
            <div key={s.n} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-black/5">
              <span className="text-sm font-bold text-[#0b7a83]">{s.n}</span>
              <h3 className="mt-1 text-lg font-bold">{s.t}</h3>
              <p className="mt-2 text-[15px] text-[#5a6878]">{s.d}</p>
            </div>
          ))}
        </div>
        <a
          href="?plano=gratis#comecar"
          className="mt-6 inline-block rounded-lg bg-[#0f2a33] px-5 py-3 font-semibold text-white hover:bg-[#173b47]"
        >
          Começar grátis
        </a>
      </section>

      {/* Perguntas */}
      <section className="mx-auto max-w-5xl px-4 pb-14">
        <h2 className="text-2xl font-bold sm:text-3xl">Perguntas comuns</h2>
        <div className="mt-6 divide-y divide-black/10 rounded-xl bg-white ring-1 ring-black/5">
          {PERGUNTAS.map((q) => (
            <details key={q.p} className="group px-5 py-4">
              <summary className="cursor-pointer list-none font-semibold marker:hidden">
                <span className="mr-2 inline-block text-[#0b7a83] transition group-open:rotate-90">›</span>
                {q.p}
              </summary>
              <p className="mt-2 pl-5 text-[15px] text-[#3d4a58]">{q.r}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Quero começar */}
      <section id="comecar" className="scroll-mt-4 bg-white">
        <div className="mx-auto max-w-2xl px-4 py-14">
          <h2 className="text-2xl font-bold sm:text-3xl">Comece grátis</h2>
          <p className="mt-2 text-[#5a6878]">
            Crie sua conta com CPF ou CNPJ e teste <b>todos os módulos por 15 dias</b>, sem cartão. Depois, se quiser
            continuar, a mensalidade é paga por Pix.
          </p>
          <FormCadastro origem={origem} zap={zap} plano={plano} demo={DEMO} />
          <details className="mt-8 rounded-xl bg-[#f6f4ef] px-5 py-4">
            <summary className="cursor-pointer font-semibold">Prefere que a gente te chame?</summary>
            <p className="mt-2 text-[#5a6878]">
              Deixe seu contato. A gente te chama no WhatsApp em até 1 dia útil, cria a sua loja e te ajuda a subir o
              cardápio. Quer um plano pago? Escolha abaixo que a gente monta com você.
            </p>
            <FormComecar origem={origem} zap={zap} plano={plano} />
          </details>
        </div>
      </section>

      <footer className="bg-[#0f2a33] px-4 py-8 text-center text-sm text-white/60">
        Concilia · sistema e consultoria para restaurantes · Alphaville, SP
      </footer>
    </main>
  );
}
