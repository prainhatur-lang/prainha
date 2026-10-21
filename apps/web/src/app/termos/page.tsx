import type { Metadata } from 'next';
import { PaginaLegal } from '@/components/legal/pagina-legal';

export const metadata: Metadata = { title: 'Termos de uso — Prainha' };

export default function TermosPage() {
  return (
    <PaginaLegal titulo="Termos de uso" atualizado="21/10/2026">
      <section>
        <h2>1. O que é este sistema</h2>
        <p>
          O app.prainhabar.com é o sistema interno de gestão do grupo Prainha (Prainha Bar, Tabuará e Prainha Mar,
          em Aracaju-SE). Ele é usado pela equipe das casas para operação, financeiro, reservas, atendimento e
          marketing. Clientes usam apenas as páginas públicas (reserva, cardápio, pagamento da mesa, avaliação).
        </p>
      </section>
      <section>
        <h2>2. Quem pode usar</h2>
        <p>
          A área interna é restrita a pessoas autorizadas pelo Prainha, com login próprio. Cada pessoa é
          responsável pelo sigilo da sua senha e pelo que faz com o seu acesso.
        </p>
      </section>
      <section>
        <h2>3. Ligação com redes sociais (Instagram e TikTok)</h2>
        <p>
          Cada casa pode conectar a sua própria conta do Instagram e do TikTok. A conexão é feita pelo login
          oficial de cada rede e só acontece com a autorização do dono da conta. Com ela, o sistema mostra à
          equipe do Prainha o perfil, os posts e vídeos e os números públicos e de desempenho dessas contas.
        </p>
        <ul>
          <li>O sistema não publica, apaga nem comenta nada sem uma ação da equipe.</li>
          <li>A conexão pode ser desfeita a qualquer momento no próprio sistema (Marketing → Desconectar) ou nas configurações da rede social.</li>
          <li>O uso das redes continua sujeito aos termos do Instagram/Meta e do TikTok.</li>
        </ul>
      </section>
      <section>
        <h2>4. Uso correto</h2>
        <p>
          É proibido usar o sistema para fins fora da operação do Prainha, tentar acessar dados de outra casa sem
          permissão, ou contornar as travas de segurança.
        </p>
      </section>
      <section>
        <h2>5. Disponibilidade</h2>
        <p>
          O sistema é oferecido como está. Fazemos o possível para mantê-lo no ar e correto, mas pode haver
          interrupções para manutenção ou por falhas de serviços de terceiros.
        </p>
      </section>
      <section>
        <h2>6. Privacidade</h2>
        <p>
          O tratamento de dados pessoais está descrito na <a className="underline" href="/privacidade">Política de privacidade</a>.
        </p>
      </section>
      <section>
        <h2>7. Mudanças e foro</h2>
        <p>
          Estes termos podem ser atualizados; a data no topo indica a versão em vigor. Vale a lei brasileira e o
          foro da comarca de Aracaju-SE.
        </p>
      </section>
    </PaginaLegal>
  );
}
