import type { Metadata } from 'next';
import { PaginaLegal } from '@/components/legal/pagina-legal';

// Política do app Concilia Garçom (maquininha Cielo LIO), exigida pela loja da
// Cielo pra listagem pública. Página nova; /privacidade (do Prainha) continua igual.
export const metadata: Metadata = { title: 'Política de privacidade — Concilia Garçom' };

export default function PrivacidadeMaquininhaPage() {
  return (
    <PaginaLegal
      titulo="Política de privacidade do app Concilia Garçom"
      atualizado="03/11/2026"
      marca="Concilia"
      rodape={
        <>
          Concilia · sistema para restaurantes ·{' '}
          <a className="underline" href="https://conciliabr.app/conheca">conciliabr.app</a>
        </>
      }
    >
      <section>
        <p>
          O Concilia Garçom é o aplicativo do sistema Concilia para a maquininha Cielo LIO. O garçom usa o app
          para abrir mesas e comandas, lançar pedidos e receber o pagamento na própria maquininha. Esta política
          explica quais dados o app trata, de acordo com a Lei Geral de Proteção de Dados (Lei 13.709/2018).
        </p>
        <p>
          O restaurante que usa o Concilia é o controlador dos dados do seu negócio. O Concilia trata esses dados
          em nome do restaurante, só para fazer o sistema funcionar.
        </p>
      </section>
      <section>
        <h2>1. Dados que o app trata</h2>
        <ul>
          <li><strong>Acesso do garçom:</strong> código da empresa, login e senha (PIN). A senha é enviada ao servidor só para conferir o acesso e não fica gravada no aparelho.</li>
          <li><strong>Pedidos:</strong> mesa ou comanda, itens, quantidades, observações, quantidade de pessoas e quem lançou cada item.</li>
          <li><strong>Pagamentos:</strong> o resultado que a Cielo devolve depois da transação — valor, forma de pagamento, bandeira, NSU e código de autorização. <strong>O app não lê nem guarda número de cartão, senha do cartão ou código de segurança</strong>; o cartão é lido e processado só pelo sistema da Cielo.</li>
          <li><strong>Cliente (quando o restaurante usa):</strong> nome ou CPF informados na conta para nota fiscal ou programa de fidelidade.</li>
        </ul>
      </section>
      <section>
        <h2>2. Permissões do aparelho</h2>
        <ul>
          <li>O app pede apenas acesso à internet e ao estado da rede, para falar com o servidor do restaurante.</li>
          <li>Não usa câmera, microfone, localização, contatos nem arquivos do aparelho.</li>
        </ul>
      </section>
      <section>
        <h2>3. Para que usamos</h2>
        <ul>
          <li>Registrar os pedidos e mandá-los para a cozinha e o bar.</li>
          <li>Fechar a conta, registrar o pagamento e emitir a nota fiscal do restaurante.</li>
          <li>Mostrar ao restaurante relatórios de vendas e de atendimento.</li>
        </ul>
        <p>Não vendemos dados e não os usamos para publicidade.</p>
      </section>
      <section>
        <h2>4. Onde os dados ficam e com quem são compartilhados</h2>
        <ul>
          <li>Os dados vão do app para o servidor do restaurante no Concilia, por conexão cifrada (HTTPS) ou pela rede interna da loja.</li>
          <li>Pagamentos passam pela Cielo, que segue a própria política de privacidade.</li>
          <li>Notas fiscais são enviadas à Secretaria da Fazenda, como a lei exige.</li>
        </ul>
      </section>
      <section>
        <h2>5. Por quanto tempo</h2>
        <p>
          Pedidos, pagamentos e notas ficam guardados enquanto o restaurante usar o sistema e pelo prazo que a lei
          fiscal exige. Ao sair do app (botão Sair) os dados de acesso são apagados do aparelho.
        </p>
      </section>
      <section>
        <h2>6. Seus direitos</h2>
        <p>
          Você pode pedir acesso, correção ou exclusão dos seus dados. Garçons e clientes falam primeiro com o
          restaurante onde o dado foi registrado. Também é possível falar com o Concilia pelo formulário em{' '}
          <a className="underline" href="https://conciliabr.app/conheca">conciliabr.app/conheca</a>.
        </p>
      </section>
    </PaginaLegal>
  );
}
