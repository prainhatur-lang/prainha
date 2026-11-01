# TikTok — liberar o post direto (Direct Post) e pedir a auditoria

> **01/11/2026:** a Produção foi recusada. O TikTok não aprova app de uso interno de empresa ("Applications intended for personal use or internal company use are not eligible for approval"). Sem aprovação, o post direto só sai como "Só eu". O caminho público continua sendo o rascunho na caixa de entrada.

O Concilia já sabe postar direto no perfil (sem passar pela caixa de entrada).
Faltam passos que só o dono faz: no portal do TikTok e na Vercel.

## 1. Portal do TikTok (developers.tiktok.com → app do Concilia)

Faça nos dois: **Sandbox** e **Produção**.

1. **Products → Content Posting API** → ligue **Direct Post**.
2. **Scopes** → adicione **`video.publish`**. O `video.upload` continua lá.
3. Salve. Na Produção, isso vai em "Submit for review" junto com o vídeo do passo 4.

## 2. Vercel (projeto prainha-web → Settings → Environment Variables → Production)

Troque `TIKTOK_ESCOPOS` para:

```
user.info.basic,user.info.profile,user.info.stats,video.list,video.upload,video.publish
```

Depois faça um Redeploy, ou espere o próximo commit.

## 3. Reconectar o TikTok em cada casa

Abra /marketing e clique em **Conectar TikTok** de novo. A tela de autorização vai pedir a
permissão nova de publicar. Quando ela for aceita, aparece embaixo do TikTok no bloco
Publicar a escolha **"Caixa de entrada (rascunho)"** ou **"Publicar direto no perfil"**.

Até o TikTok aprovar a auditoria, o post direto só sai como **"Só eu"** (privado). Isso é
regra do TikTok para app não auditado. Depois dá para abrir o post para todos no próprio app.

## 4. Vídeo para a auditoria (gravar a tela, 1–2 min)

O revisor quer ver o caminho completo, com as regras de tela deles. Grave nesta ordem:

1. Abrir app.prainhabar.com/marketing já logado e mostrar que o TikTok da casa está conectado.
2. Clicar em **Conectar TikTok**. Mostrar a tela de autorização do TikTok com as permissões,
   incluindo publicar vídeo, e aceitar.
3. No bloco **Publicar**, subir um vídeo e escrever a legenda.
4. Marcar **TikTok** e escolher **Publicar direto no perfil**. Mostrar, devagar:
   - a conta que vai postar (foto + nome + @usuário);
   - **Quem pode ver** começando em "Escolha…" (sem padrão) e abrir a lista;
   - **Comentários / Dueto / Stitch** desmarcados;
   - ligar **Conteúdo comercial** e mostrar as opções "A própria casa" e "Parceria paga".
     Mostrar que, com parceria paga, "Só eu" fica bloqueado e aparece o link da Política de
     Conteúdo de Marca;
   - o aviso da **Confirmação de Uso de Música**.
5. Desligar o conteúdo comercial, escolher a privacidade e clicar em **Publicar agora**.
6. Mostrar no histórico: "Publicado direto no perfil… Pode levar alguns minutos pra aparecer".
7. Abrir o app do TikTok (celular espelhado ou web) e mostrar o post no perfil.

## 5. Texto para o formulário ("How will you use the scopes?")

> **video.publish** — Concilia is the internal management system of Prainha, a group of
> three restaurants in Aracaju, Brazil. Our marketing staff uses it to publish the
> restaurants' own photos and short videos (dishes, events, the venue) to the restaurants'
> own TikTok accounts. Before each post, the app queries creator_info and shows the
> connected account (avatar and username). The user chooses who can view the post (no
> default), and turns comments, duet and stitch on or off. These options start off and are
> greyed out when the account disables them. The user also discloses commercial content
> (own brand / paid partnership, which cannot be "Only me") and sees the Music Usage
> Confirmation (plus the Branded Content Policy when it applies) before posting. Nothing is
> posted without the user clicking Publish. The user can still send to the TikTok inbox as
> a draft instead (video.upload).

## O que muda e o que não muda no Concilia

- O jeito antigo continua igual: o padrão é **Caixa de entrada (rascunho)**.
- A fila de aprovação e o espelho automático IG → TikTok continuam indo como rascunho.
- Se um post pediu direto e a ligação ainda não tem `video.publish`, ele vai pra caixa de
  entrada com um aviso no histórico. Não falha.
