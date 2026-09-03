# Otávio — atendente virtual no WhatsApp da Tabuará

**Data:** 2026-09-03 · **Status:** aprovado pelo Elison (conversa 02-03/09) · **Fase desta spec:** Fase 1

Esta spec executa a "Fase 3 — opcional, futuro" prevista em
`2026-08-08-atendente-whatsapp-design.md`: separar a Tabuará num número
próprio, mas em vez de replicar a Nina, com uma persona nova e distinta
(homem, tom de "lorde"/sommelier), pensada especificamente para o
posicionamento de alta gastronomia da casa.

## Objetivo

Atender no WhatsApp quem procura a Tabuará, num número dedicado e com uma
persona própria — **Otávio**: anfitrião/sommelier, formal, culto, sutil,
conhecedor de vinhos e de alta gastronomia. Réplica funcional completa do que
a Nina já faz hoje pelo Prainha (conversa, reserva de mesa, cardápio com
preço, orçamento automático de evento), adaptada aos dados e ao ambiente reais
da Tabuará. Tudo acompanhável e corrigível pelo Elison no mesmo painel do
Concilia usado pela Nina.

## Pesquisa feita para embasar a persona e a KB (02/09/2026)

Levantamento público (site, Instagram @tabuara.se, cardápio online, imprensa)
para calibrar tom e conteúdo — tudo abaixo é ponto de partida, **a validação
final de qualquer valor/afirmação é do Elison, no painel**, mesma regra da
Nina:

- **Posicionamento oficial:** "Muito além do sabor: uma experiência sensorial
  à mesa" (bio do Instagram). Elison, à imprensa (AJN1, sobre a Mounjaro
  Selection): "A ideia é oferecer flexibilidade sem alterar o conceito
  criativo que consolidou o Tabuará como referência local em **gastronomia
  autoral**."
- **Local:** Praça de Eventos da Orla de Atalaia, anexo ao Memorial de
  Sergipe. Aberto todos os dias (Instagram).
- **Carta de vinhos é de sommelier de verdade** — não é só um "vinho da casa":
  ~40 tintos majoritariamente portugueses + França/Itália/Espanha/
  Argentina/Chile, de R$140 (Condor Cabernet Sauvignon) a **R$5.800 (Pera
  Manca)**, passando por Tignanello 2021 (R$2.750), Barolo Rizieri Riserva
  (R$1.190), Quinta do Noval Vinhas do Passadouro (R$2.999). **Só a lista de
  tintos foi visível na pesquisa** — branco/espumante/rosé não apareceram,
  não assumir que não existem. Preço vem do cardápio de delivery
  (tabuara.menudino.com), **pode não refletir a carta física do salão** —
  confirmar antes de citar valor exato ao cliente.
- **Cardápio (categorias, sem preço prato-a-prato confiável ainda):** Entrada,
  Saladas, Aves, Carnes, Frutos do Mar, Sobremesa, Sobremesa Inclusiva
  (restrição alimentar), Bebida não alcoólica, Café, Drink - Autorais,
  Cerveja, Porções, Sanduíches.
- **Mounjaro Selection:** já documentada na KB atual da Nina — versões
  reduzidas de pratos consagrados, valor proporcional, "consumo consciente e
  bem-estar" (linguagem da matéria). Regra de marca já em vigor e que este
  projeto **mantém sem alteração**: falar como cuidado/elegância, nunca como
  dieta, nunca comentar peso/corpo.
- **Reservas — CONFIRMADO com o Elison (02/09):** apesar de a bio do
  Instagram apontar hoje para `dguests.com/tabuara`, a fonte real usada pela
  operação é o **Concilia** (mesma tabela/config de reserva do Prainha) — o
  link do Instagram está desatualizado ou é secundário. Otávio cria/consulta/
  cancela reserva direto, como a Nina faz para o Prainha.
- **Avaliações (TripAdvisor, via busca — não confirmado por acesso direto à
  página):** citada como bem avaliada e um dos restaurantes de referência em
  Aracaju; comentários mencionam textura/tempero "muito sensorial" e equipe
  "super atenciosa". Tratar como sinal de qualidade, não como fato a repetir
  literalmente para clientes.
- `[PENDENTE]` explícito (não pesquisável, depende do Elison): horário exato
  por dia (a memória do projeto tem uma versão de 17/08 — happy hour seg-qui
  18h–22h, sexta 12h–19h — precisa reconfirmação), preço/capacidade dos
  espaços de evento (Salão/Varanda), se a Tabuará participa do programa de
  selos sem glúten/lactose do Prainha, confirmação dos preços de vinho e do
  cardápio prato-a-prato.

## Decisões tomadas (com o Elison, 02-03/09)

1. **Número dedicado:** Otávio recebe um `phone_number_id` próprio na Cloud
   API da Meta, migrado do número humano atual da Tabuará, **(79) 3512-0567**
   — mesmo procedimento já usado para a Nina (ver apêndice de migração na
   spec de 08/08): o número precisa sair do WhatsApp/Business app do celular
   antes de virar registro na Cloud API. **Essa etapa é do Elison, fora do
   código** (Meta Business Manager); o schema e o código ficam prontos
   esperando o `phone_number_id` real.
2. **Nome do personagem:** **Otávio**.
3. **Persona:** homem, tom de "lorde" — formal ("o senhor"/"a senhora"),
   pausado, culto sem ser hermético, conhecedor de vinhos e alta gastronomia
   com propriedade real (a carta de vinhos da casa sustenta isso). Zero
   emoji. Nunca vende com exagero — a sofisticação está no que ele nota e no
   que ele sabe de verdade, não em adjetivo. Amostras de tom validadas:
   - *Abertura:* "Boa noite. Meu nome é Otávio — será um prazer recebê-lo
     esta noite no Tabuará. É a sua primeira visita, ou já nos conhece?"
   - *Harmonização:* "Para os frutos do mar, eu me inclinaria a um branco de
     acidez mais viva; mas se o senhor preferir manter o tinto à mesa, temos
     rótulos com taninos macios que acompanham sem se sobrepor ao prato. Há
     alguma uva ou região de que o senhor mais goste?"
   Mesma regra de honestidade da Nina: se perguntarem diretamente se é robô,
   não mente.
4. **Escopo funcional:** réplica completa do que a Nina faz hoje (reserva,
   cardápio com preço, orçamento automático de evento, modo fornecedor,
   CPF/mapa de mesas) — não uma versão enxuta. Ver seção "Gaps técnicos"
   abaixo: parte do código de suporte a isso hoje está hardcoded para o
   Prainha e precisa ser generalizado antes.
5. **Áudio de voz (TTS):** infraestrutura fica pronta (troca só a voz OpenAI
   TTS para uma masculina, ex. `onyx`), mas **desligada no lançamento** —
   mesmo critério da Nina (o dono decide ligar depois de ouvir em produção).
6. **Rollout:** nasce com `ativo=false`; Elison testa no próprio celular;
   liga quando aprovar; divulgação pública (site/Instagram da Tabuará) é uma
   fase posterior, à parte.

## Arquitetura — sem mudança estrutural

Confirmado por mapeamento do código existente: a Nina **não é uma entidade
própria** — é o resultado de `whatsapp_numero.phone_number_id → filial_id →
atendimento_config (1 linha por filial)`. O webhook (`/api/whatsapp/webhook`)
e o motor (`lib/atendimento/motor.ts`) já resolvem "quem responde e com que
persona" inteiramente por dado, não por código específico da Nina. Isso
significa que **nenhuma tabela nova é necessária** — o Otávio nasce como mais
uma linha:

- `whatsapp_numero`: novo `phone_number_id` (gerado quando a Meta migrar o
  (79) 3512-0567) → `filial_id = 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7'`
  (Tabuará), `atendente_ativo = false`.
- `atendimento_config`: nova linha, PK `filial_id` da Tabuará,
  `nome_atendente = 'Otávio'`, `persona = <texto do personagem>`,
  `conhecimento = <blocos KB semente>`, `espacos_evento = <vazio até Elison
  preencher>`.
- Reserva de mesa: a Tabuará **já tem** `filial.reserva_config` populado com
  as áreas **Salão** e **Varanda** (`migrate-reserva-config.ts`), e
  `lib/atendimento/reservar.ts` já lê essas áreas dinamicamente da filial —
  não precisa mudar código de validação/alocação.

## Gaps técnicos a corrigir antes de ligar (achados no mapeamento do código)

Estes 5 pontos hoje só funcionam corretamente para o Prainha Bar. Corrigir de
verdade (generalizar por dado de filial), não com `if (filial === 'Tabuará')`
pontual — decisão do Elison (02/09), para não acumular dívida técnica:

1. `lib/atendimento/ia.ts` (~linha 202) — regra de horário "o Prainha abre
   9h–19h" está escrita fixa **fora** do condicional de filial, valendo hoje
   para qualquer casa. Precisa virar dado (bloco de conhecimento ou campo de
   config), não texto fixo no prompt.
2. `ia.ts` (~linhas 335, 442) — descrição dos parâmetros das ferramentas de
   reserva (`criar_reserva`/`remarcar_reserva`) cita `"Areia ou Deck
   Superior"` fixo. A validação real já é genérica via
   `filial.reservaConfig.areas`, mas a *descrição* que o modelo lê no schema
   da ferramenta precisa ficar genérica também (ler os nomes reais das áreas
   da filial), senão o modelo tenta oferecer "Areia" para quem fala da
   Tabuará.
3. `ia.ts` (tool `consultar_mare`, ~linhas 402-413) — descrição cita
   "AquaArena" fixo, que não existe na Tabuará. Precisa ficar condicional
   (só oferecer essa ferramenta/descrição quando a filial tiver o recurso).
4. `lib/atendimento/avisos.ts` (~linhas 20-21) — `avisarEquipe()` usa
   `WHATSAPP_PHONE_ID` de env fixo para disparar o template de aviso à
   equipe, em vez do `phoneNumberId` real da conversa/filial. Sem correção,
   os avisos de transferência/lead da Tabuará sairiam pelo número da Nina.
5. Painel `/atendimento/config` (`config-client.tsx`) e `/atendimento`
   (`atendimento-client.tsx`) têm "Nina" escrito fixo em título e vários
   textos, em vez de ler `nomeAtendente` da config carregada. Sem correção, o
   painel mostraria "Configuração da Nina" mesmo ao editar o Otávio.

## Persona semente do Otávio (editável no painel)

Otávio é o anfitrião/sommelier da Tabuará: extremamente educado, paciente,
culto — trata o cliente por "o senhor"/"a senhora" sempre. Fala pausado e
preciso, nunca floreado a ponto de soar encenado. Entende genuinamente de
vinhos (a carta da casa sustenta isso) e de alta gastronomia, e usa esse
conhecimento para servir, nunca para impressionar — explica um termo técnico
com naturalidade, sem fazer quem não entende do assunto se sentir por fora.
Zero emoji. Nunca promete o que não está escrito na base; dúvida real vira
transferência para a equipe, com a mesma elegância do resto da conversa. Não
mente se perguntarem se é robô. Este texto entra como valor inicial do campo
`persona` em `atendimento_config` da filial Tabuará.

## Base de conhecimento — semente inicial (Tabuará)

Ver blocos e status `[PENDENTE]`/`[PENDENTE confirmação]` detalhados na seção
"Pesquisa feita" acima. Resumo dos blocos a criar: `posicionamento` (bio +
citação do Elison), `localizacao` (Orla de Atalaia/Memorial de Sergipe),
`horario` `[PENDENTE reconfirmação]`, `ambientes` (Salão/Varanda),
`cardapio` (categorias, sem preço prato-a-prato ainda), `vinhos`
(amplitude/rótulos de destaque, preço `[PENDENTE confirmação]`),
`mounjaro_selection` (regra de tom herdada da Nina), `eventos`
`[PENDENTE — Elison define piso/teto por pessoa e pacotes]`, `contato`
(telefone humano, @tabuara.se). Mesma convenção da Nina: bloco com
`[PENDENTE]` = Otávio não afirma nem nega, oferece transferir.

## Escopo funcional (réplica completa) e dependências

- **Reserva de mesa:** pronta (dados já existem — `reserva_config` da
  Tabuará). Sem dependência externa.
- **Cardápio com preço:** mesma fonte da Nina
  (`produto_variante.menu_dino`) — **precisa verificar na implementação se
  esse dado já está sincronizado a partir do Consumer/Firebird próprio da
  Tabuará** (ela não roda vendas-local, só Consumer, conforme CLAUDE.md). Se
  não estiver populado, Otávio cita cardápio conceitual e direciona ao site
  até o dado estar pronto — mesmo fallback que a Nina já usa quando "não
  achou".
- **Orçamento automático de evento:** estrutura de código já existe
  (`lib/atendimento/orcamento.ts`), mas os parâmetros (piso/teto R$/pessoa,
  pacotes de bebida, capacidade por espaço) foram calibrados com orçamentos
  reais do Prainha (Terraço) — **para a Tabuará isso precisa ser recalibrado
  com números reais do Elison**, não é dado pesquisável.
- **Modo fornecedor, CPF na reserva, mapa de mesas, curiosidades/tempero:**
  infraestrutura genérica por filial, herda automaticamente sem trabalho
  extra.
- **Áudio de voz:** infraestrutura pronta, desligada (ver decisão 5 acima).

## Painel

Reaproveita `/atendimento`, `/atendimento/config`, `/atendimento/eventos` já
existentes — a Tabuará aparece como mais uma filial no seletor, uma vez
corrigido o gap #5 (nome dinâmico em vez de "Nina" fixo). Sem páginas novas.

## Rollout

1. Elison migra (79) 3512-0567 para a Cloud API da Meta (fora do código).
2. Corrigir os 5 gaps técnicos (generalização).
3. Migration nova (`whatsapp_numero` + `atendimento_config` da Tabuará),
   seguindo o padrão de `migrate-atendimento.ts`.
4. Seed dos blocos de KB (com os `[PENDENTE]` explícitos) + persona do
   Otávio.
5. Elison preenche no painel o que está `[PENDENTE]` (horário, eventos,
   preços de vinho/cardápio confirmados).
6. Teste real no celular do Elison — igual ao processo usado com a Nina.
7. Ligar (`ativo=true`, `atendente_ativo=true`).
8. Fase futura (fora desta spec): divulgar o número no site/Instagram da
   Tabuará.

## Riscos / fora do escopo desta spec

- Migração do número (79) 3512-0567 na Meta é passo manual do Elison — este
  documento não cobre esse procedimento em detalhe (repetir o roteiro já
  usado na spec da Nina).
- Conteúdo de vinhos/cardápio/eventos citado aqui vem de pesquisa pública e
  **não deve ser tratado como fonte de verdade para produção** sem
  confirmação do Elison no painel — mesmo padrão de governança da KB da Nina.
- Nenhuma mudança está prevista na Nina/Prainha além da generalização de
  código (que é estritamente aditiva — comportamento do Prainha não muda).
