import type { Metadata } from 'next';
import { PaginaLegal } from '@/components/legal/pagina-legal';

// Termos de uso do app Concilia Garçom (maquininha Cielo LIO), exigidos pela
// loja pública da Cielo. Página nova; /termos (do Prainha) continua igual.
export const metadata: Metadata = { title: 'Termos de uso — Concilia Garçom' };

export default function TermosMaquininhaPage() {
  return (
    <PaginaLegal
      titulo="Termos de uso do app Concilia Garçom"
      atualizado="05/11/2026"
      marca="Concilia"
      rodape={
        <>
          Concilia · sistema para restaurantes ·{' '}
          <a className="underline" href="/privacidade/maquininha">Política de privacidade</a> ·{' '}
          <a className="underline" href="https://conciliabr.app/conheca">conciliabr.app</a>
        </>
      }
    >
      <section>
        <h2>1. O que é o app</h2>
        <p>
          O Concilia Garçom é o aplicativo do sistema Concilia para a maquininha Cielo LIO. Com ele o garçom abre
          mesas e comandas, lança pedidos que seguem para a cozinha e o bar, e recebe o pagamento na própria
          maquininha. Ao instalar e usar o app, o restaurante e a sua equipe aceitam estes termos.
        </p>
      </section>
      <section>
        <h2>2. Quem pode usar</h2>
        <ul>
          <li>O app funciona com uma conta do restaurante no sistema Concilia. Sem conta, só é possível conhecer o app pelo código de empresa <strong>demo</strong>, que usa dados fictícios.</li>
          <li>O restaurante cria o login de cada garçom e decide o que cada um pode fazer, como dar desconto.</li>
          <li>Cada pessoa é responsável pelo sigilo do seu PIN e pelo que lança com o seu acesso.</li>
        </ul>
      </section>
      <section>
        <h2>3. Contratação</h2>
        <p>
          A conta no Concilia é contratada direto com o Concilia, pelo site{' '}
          <a className="underline" href="https://conciliabr.app/conheca">conciliabr.app</a>. Valores, prazos e
          condições da assinatura são os combinados na contratação.
        </p>
      </section>
      <section>
        <h2>4. Pagamentos com cartão e Pix</h2>
        <ul>
          <li>Os pagamentos são processados pela Cielo, dentro do contrato do restaurante com a Cielo. Taxas, prazos de recebimento, estornos e contestações são tratados entre o restaurante e a Cielo.</li>
          <li>O app não lê nem guarda número de cartão, senha ou código de segurança. Ele recebe da Cielo só o resultado da transação (valor, forma, bandeira, NSU e autorização) e registra na conta da mesa.</li>
          <li>A conta só é dada como paga quando a Cielo aprova o pagamento.</li>
        </ul>
      </section>
      <section>
        <h2>5. Nota fiscal</h2>
        <p>
          Quando o restaurante usa a emissão de nota fiscal (NFC-e), a nota sai em nome do restaurante, com o CNPJ,
          os produtos e a tributação que ele cadastrou. O restaurante responde pela correção desses dados perante a
          Secretaria da Fazenda.
        </p>
      </section>
      <section>
        <h2>6. Uso correto</h2>
        <ul>
          <li>Use o app só para a operação do restaurante: pedidos e pagamentos reais, ou de teste no código demo.</li>
          <li>Confira valores e itens antes de cobrar. O cardápio, os preços e a taxa de serviço são os cadastrados pelo restaurante.</li>
          <li>É proibido tentar acessar dados de outra empresa, burlar permissões ou usar o app para fraude.</li>
        </ul>
      </section>
      <section>
        <h2>7. Funcionamento</h2>
        <p>
          O app depende da internet ou da rede da loja, do servidor do Concilia e dos serviços da Cielo. Falhas de
          conexão, manutenção ou indisponibilidade de terceiros podem interromper o uso por algum tempo. O Concilia
          pode atualizar o app pela Cielo Store para corrigir problemas e trazer novidades.
        </p>
      </section>
      <section>
        <h2>8. Dados pessoais</h2>
        <p>
          O tratamento de dados segue a{' '}
          <a className="underline" href="/privacidade/maquininha">Política de privacidade do app Concilia Garçom</a> e
          a Lei Geral de Proteção de Dados (Lei 13.709/2018).
        </p>
      </section>
      <section>
        <h2>9. Mudanças nestes termos</h2>
        <p>
          Quando estes termos mudarem, a nova versão é publicada nesta página com a data de atualização. Continuar
          usando o app depois disso significa aceitar a nova versão.
        </p>
      </section>
      <section>
        <h2>10. Contato</h2>
        <p>
          Dúvidas e suporte pelo formulário em{' '}
          <a className="underline" href="https://conciliabr.app/conheca">conciliabr.app/conheca</a>. Estes termos
          seguem a lei brasileira.
        </p>
      </section>
    </PaginaLegal>
  );
}
