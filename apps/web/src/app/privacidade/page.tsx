import type { Metadata } from 'next';
import { PaginaLegal } from '@/components/legal/pagina-legal';

export const metadata: Metadata = { title: 'Política de privacidade — Prainha' };

export default function PrivacidadePage() {
  return (
    <PaginaLegal titulo="Política de privacidade" atualizado="21/10/2026">
      <section>
        <p>
          Esta política explica como o grupo Prainha (Prainha Bar, Tabuará e Prainha Mar, Aracaju-SE) trata dados
          pessoais no sistema app.prainhabar.com, de acordo com a Lei Geral de Proteção de Dados (Lei 13.709/2018).
        </p>
      </section>
      <section>
        <h2>1. Dados que tratamos</h2>
        <ul>
          <li><strong>Clientes:</strong> nome, telefone, e-mail e CPF quando informados em reservas, pedidos, cadastro de fidelidade ou pagamento; conversas de atendimento pelo WhatsApp; avaliações.</li>
          <li><strong>Equipe:</strong> dados de cadastro, ponto e folha, para cumprir obrigações trabalhistas.</li>
          <li><strong>Redes sociais das casas:</strong> quando uma casa conecta o próprio Instagram ou TikTok, recebemos o identificador da conta, o nome de usuário, nome e foto do perfil, número de seguidores e curtidas, e a lista de posts/vídeos com seus números (visualizações, curtidas, comentários, compartilhamentos).</li>
        </ul>
      </section>
      <section>
        <h2>2. Para que usamos</h2>
        <ul>
          <li>Operar as casas: reservas, pedidos, pagamentos, notas fiscais e atendimento.</li>
          <li>Cumprir obrigações legais, fiscais e trabalhistas.</li>
          <li>Mostrar à equipe de marketing o desempenho das contas das casas nas redes sociais.</li>
        </ul>
        <p>Não vendemos dados pessoais e não os usamos para publicidade de terceiros.</p>
      </section>
      <section>
        <h2>3. Instagram e TikTok</h2>
        <ul>
          <li>A conexão só acontece com a autorização do dono da conta, pelo login oficial da rede.</li>
          <li>As chaves de acesso são guardadas cifradas (AES-256) e usadas só para ler os dados da própria conta conectada.</li>
          <li>Posts, vídeos e números são lidos na hora em que a tela é aberta e não ficam armazenados no nosso banco.</li>
          <li>Ao desconectar (Marketing → Desconectar) as chaves são apagadas. A autorização também pode ser revogada nas configurações do Instagram ou do TikTok.</li>
        </ul>
      </section>
      <section>
        <h2>4. Com quem compartilhamos</h2>
        <p>
          Apenas com os serviços necessários para o funcionamento: hospedagem e banco de dados (Vercel e
          Supabase), meios de pagamento, emissão de notas fiscais, WhatsApp (Meta) e as próprias redes sociais
          conectadas. Também quando exigido por lei ou autoridade.
        </p>
      </section>
      <section>
        <h2>5. Por quanto tempo</h2>
        <p>
          Guardamos os dados enquanto forem necessários para a finalidade ou pelo prazo exigido em lei (por
          exemplo, documentos fiscais e trabalhistas).
        </p>
      </section>
      <section>
        <h2>6. Seus direitos</h2>
        <p>
          Você pode pedir acesso, correção, exclusão ou informações sobre o uso dos seus dados. Basta falar com
          qualquer uma das casas pelo WhatsApp ou pessoalmente; respondemos em até 15 dias.
        </p>
      </section>
      <section>
        <h2>7. Mudanças</h2>
        <p>Esta política pode ser atualizada; a data no topo indica a versão em vigor.</p>
      </section>
    </PaginaLegal>
  );
}
