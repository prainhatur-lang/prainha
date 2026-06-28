// Monitor da entrada de alarme do facial — pra TESTAR a fiação da botoeira/laço.
// Fica lendo o estado e avisa quando muda. Acione a botoeira e veja flipar.
// Uso: pnpm --filter @concilia/agente-patio test:alarme   (Ctrl+C pra sair)
import { loadConfig } from './config.js';
import { getAlarmInState } from './facial.js';

async function main() {
  const cfg = loadConfig();
  console.log(`Monitorando entrada de alarme do facial ${cfg.facial.host}`);
  console.log('Acione a botoeira/sensor — o estado deve mudar de INATIVO p/ ATIVO.\n');
  let anterior: boolean | null = null;
  for (;;) {
    try {
      const s = await getAlarmInState(cfg.facial);
      if (s.ativo !== anterior) {
        const t = new Date().toLocaleTimeString('pt-BR');
        console.log(`${t}  ${s.ativo ? '🔴 ATIVO (gatilho!)' : '⚪ inativo'}  (raw=${s.raw})`);
        anterior = s.ativo;
      }
    } catch (e) {
      console.error('erro lendo:', (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

main().catch((e) => {
  console.error('ERRO:', (e as Error).message);
  process.exit(1);
});
