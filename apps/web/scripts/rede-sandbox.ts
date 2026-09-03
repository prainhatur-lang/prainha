// Fumaça do e.Rede no SANDBOX — valida @/lib/rede de ponta a ponta sem tocar
// em produção. Uso (na pasta apps/web):
//   REDE_SANDBOX=true REDE_PV=<pv sandbox> REDE_CHAVE_INTEGRACAO=<chave sandbox> \
//     pnpm exec tsx --tsconfig tsconfig.json scripts/rede-sandbox.ts [pix|pix-espera|cartao|webhook|tudo]
//   pix        → gera QR e consulta (status pendente)
//   pix-espera → gera QR, espera ~2m10s e consulta: o SANDBOX simula o pagamento
//                sozinho 2 min depois (evento PV.UPDATE_TRANSACTION_PIX) → deve vir 'pago'
//   cartao     → crédito com cartão de teste da doc (Visa 4235647728025682, 01/35, 123), consulta e estorna
//   webhook    → cadastra a URL de notificação do SANDBOX (só sandbox tem API pra isso):
//                REDE_WEBHOOK_URL=https://app.prainhabar.com/api/webhook/rede [REDE_WEBHOOK_SECRET=…]
// Cartões de teste (doc "Tutorial Sandbox → Cartões"): Visa créd 4235647728025682 · Master créd
// 5448280000000007 · Visa déb 4761120000000148 · Elo 4389351648020055 — validade jan/35, CVV 123.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Carrega ../../.env sem depender do pacote dotenv (o apps/web não o tem — e o
// next build type-checa esta pasta: 'Cannot find module dotenv' derrubou o
// deploy em 03/09). Variável já setada no ambiente tem prioridade.
try {
  for (const linha of readFileSync(resolve(process.cwd(), '../../.env'), 'utf8').split('\n')) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* sem .env: usa só o ambiente */ }
process.env.REDE_SANDBOX = process.env.REDE_SANDBOX || 'true';

async function main() {
  const modo = process.argv[2] || 'tudo';
  const { createRedePixPayment, queryRedePayment, refundRedePayment, createRedeCardPayment, friendlyRedeError } = await import('../src/lib/rede');
  if (!process.env.REDE_PV || !process.env.REDE_CHAVE_INTEGRACAO) {
    console.error('❌ Faltam REDE_PV / REDE_CHAVE_INTEGRACAO (sandbox)'); process.exit(1);
  }
  console.log('sandbox:', process.env.REDE_SANDBOX, '| PV:', process.env.REDE_PV);

  if (modo === 'pix' || modo === 'tudo') {
    console.log('\n=== PIX: criar QR ===');
    const pix = await createRedePixPayment({ orderId: 'TESTE-' + Date.now(), amount: 150, customerName: 'Teste Concilia', filialId: null, expiraMinutos: 30 });
    console.log('tid:', pix.paymentId, '| status:', pix.status, '| copia-e-cola:', pix.qrCodeString.slice(0, 60) + '…', '| img base64:', pix.qrCodeBase64.length, 'chars');
    console.log('=== PIX: consultar ===');
    const q = await queryRedePayment(pix.paymentId, null);
    console.log(q);
  }

  if (modo === 'pix-espera') {
    console.log('\n=== PIX: criar QR e esperar o sandbox "pagar" (2 min) ===');
    const pix = await createRedePixPayment({ orderId: 'TESTE-W-' + Date.now(), amount: 150, customerName: 'Teste Concilia', filialId: null, expiraMinutos: 30 });
    console.log('tid:', pix.paymentId);
    for (let i = 1; i <= 5; i++) {
      await new Promise((r) => setTimeout(r, 30_000));
      const q = await queryRedePayment(pix.paymentId, null);
      console.log(`  +${i * 30}s → status ${q.status}`);
      if (q.status === 'pago') break;
    }
  }

  if (modo === 'webhook') {
    const url = process.env.REDE_WEBHOOK_URL;
    if (!url) { console.error('❌ REDE_WEBHOOK_URL não definida'); process.exit(1); }
    console.log('\n=== cadastrar URL de notificação no SANDBOX ===', url);
    // Sandbox-only: em produção a URL é cadastrada por CNPJ na central da Rede.
    const pv = process.env.REDE_PV!, chave = process.env.REDE_CHAVE_INTEGRACAO!;
    const tk = await fetch('https://rl7-sandbox-api.useredecloud.com.br/oauth2/token', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${pv}:${chave}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    }).then((r) => r.json());
    const sec = process.env.REDE_WEBHOOK_SECRET;
    const body: Record<string, unknown> = { url };
    if (sec) body.authorization = { type: 'Bearer', token: `Bearer ${sec}` };
    const r = await fetch('https://sandbox-erede.useredecloud.com.br/v2/transactions/notification-url', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk.access_token}` }, body: JSON.stringify(body),
    });
    console.log(r.status, (await r.text()).slice(0, 300));
  }

  if (modo === 'cartao' || modo === 'tudo') {
    console.log('\n=== CARTÃO crédito (sem 3DS) ===');
    const card = await createRedeCardPayment({
      orderId: 'TESTE-C-' + Date.now(), amount: 100, customerName: 'Teste Concilia',
      cardNumber: process.env.REDE_TEST_CARD || '4235647728025682', holder: 'TESTE CONCILIA',
      expirationDate: '01/2035', securityCode: '123', installments: 1, paymentType: 'CreditCard', filialId: null,
    });
    console.log(card, '→', friendlyRedeError(card.returnCode));
    if (card.paymentId) {
      console.log('=== consultar ==='); console.log(await queryRedePayment(card.paymentId, null));
      console.log('=== estornar ==='); console.log(await refundRedePayment(card.paymentId, undefined, null));
    }
  }
  console.log('\n✅ fumaça concluída');
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });
