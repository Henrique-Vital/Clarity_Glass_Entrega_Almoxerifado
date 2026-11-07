# Portaria Clarity Glass

PWA mobile-first para a portaria registrar a chegada de materiais, controlar a retirada pelo almoxarifado e avisar pelo WhatsApp. Funciona offline, sem backend, sem login e sem custo de servidor.

## Visão geral

- Registro de material **com nota fiscal**: fornecedor, número da NF, observação opcional, foto opcional e data/hora automática.
- Aviso ao almoxarifado pelo WhatsApp com mensagem pronta e, quando o navegador permite, foto anexada.
- Card de materiais pendentes na tela inicial, com tempo decorrido.
- Registro de saída com hora atual ou ajuste manual do horário.
- Relatório por período, edição, exclusão e geração de PDF.
- Fluxo de material **sem nota fiscal** para encomendas dos Correios/Sedex: apenas mensagem, sem criar registro.
- Dados salvos no IndexedDB do próprio aparelho. As fotos não são armazenadas.

## Arquitetura

Aplicação estática de página única, sem etapa de build e sem servidor de aplicação.

```text
Navegador (PWA)
  index.html
   ├── css/styles.css
   ├── assets/vendor/jsPDF + autoTable
   └── js/app.js (ES modules)
        ├── db.js        -> IndexedDB
        ├── datetime.js  -> fuso America/Sao_Paulo
        ├── share.js     -> compressão, Web Share, wa.me, backup
        └── pdf.js       -> relatório em PDF
  sw.js                 -> cache offline
  manifest.webmanifest  -> instalação como app
```

- **Sem backend e sem login.** Qualquer pessoa com o aparelho consegue abrir e editar os registros.
- **Dados locais.** Cada navegador/aparelho tem seu próprio banco. Não há sincronização entre celulares.
- **Service worker.** Navegação com estratégia network-first e fallback para o cache; arquivos estáticos com cache-first.
- **Hospedagem.** Qualquer servidor estático com HTTPS (GitHub Pages, Netlify, Vercel, servidor interno etc.).

## Estrutura de arquivos

```text
Entrega_Almoxerifado/
├── index.html
├── manifest.webmanifest
├── sw.js
├── package.json
├── README.md
├── css/
│   └── styles.css
├── js/
│   ├── app.js
│   ├── db.js
│   ├── datetime.js
│   ├── share.js
│   └── pdf.js
└── assets/
    ├── icons/
    │   ├── icon-192.png
    │   ├── icon-512.png
    │   ├── maskable-512.png
    │   ├── apple-touch-icon.png
    │   └── favicon-32.png
    └── vendor/
        ├── jspdf.umd.min.js
        └── jspdf.plugin.autotable.min.js
```

## Modelo de dados

```js
{
  id: string,
  tipo: "com_nf",
  fornecedor: string,
  numeroNF: string,
  observacao: string,
  dataHoraEntrada: string, // ISO 8601 em UTC
  dataHoraSaida: string | null, // ISO 8601 em UTC
  status: "aguardando" | "retirado",
  criadoEm: string // ISO 8601 em UTC
}
```

- Os horários são gravados em UTC e exibidos no fuso `America/Sao_Paulo`.
- A foto não faz parte do registro: ela é comprimida, usada no envio e descartada.
- Registros do fluxo "sem NF" não são criados.

## Configuração

Na tela **Configurações** é possível:

- Alterar o número de destino do WhatsApp. Padrão: `+55 12 98899-0837` (armazenado como `5512988990837`).
- Alterar o nome do grupo. Padrão: `Portaria principal e dos fundos Clarity`. Esse nome é apenas um rótulo de referência; o app não escolhe o grupo automaticamente.
- Exportar um backup em JSON.
- Importar um backup exportado anteriormente. A importação adiciona ou atualiza registros pelo `id`; ela não apaga os registros existentes.
- Apagar todos os registros com confirmação.
- Instalar o aplicativo, quando o navegador oferece o prompt de instalação.

O app também solicita armazenamento persistente ao navegador, quando disponível, para reduzir o risco de o sistema apagar os dados.

## Como rodar localmente

O service worker e a instalação exigem `localhost` ou HTTPS. Não abra o `index.html` diretamente via `file://`.

Com Python:

```bash
python -m http.server 8080
```

Ou com Node:

```bash
npm start
```

Depois acesse `http://localhost:8080`.

## Publicação

### GitHub Pages

1. Coloque o conteúdo desta pasta na raiz do repositório (ou em uma pasta publicada).
2. Em **Settings > Pages**, escolha a branch e a pasta raiz.
3. Acesse `https://usuario.github.io/repositorio/`.

Os caminhos são relativos, então o app funciona tanto na raiz quanto em um subdiretório.

### Netlify

1. Conecte o repositório ou arraste a pasta no painel.
2. Deixe o comando de build vazio.
3. Use `.` como diretório de publicação.

### Vercel

1. Importe o repositório.
2. Escolha o preset **Other**.
3. Deixe o build vazio e use `.` como output directory.

### Requisitos de hospedagem

- HTTPS (exceto em `localhost`) para service worker, instalação e Web Share.
- O arquivo `.webmanifest` deve ser servido como `application/manifest+json`. A maioria dos serviços já faz isso; se necessário, configure o MIME type.
- Não bloqueie os arquivos `js/`, `css/`, `assets/`, `sw.js` e `manifest.webmanifest`.

## Instalação no celular

### Android (Chrome, Edge ou Samsung Internet)

1. Abra a URL publicada.
2. Use o menu do navegador e escolha **Instalar aplicativo** ou **Adicionar à tela inicial**.
3. Também é possível usar o botão **Instalar aplicativo** em Configurações quando ele aparecer.

### iPhone e iPad (Safari)

1. Abra a URL no Safari.
2. Toque em **Compartilhar > Adicionar à Tela de Início**.

O suporte ao compartilhamento de arquivos pela Web Share API depende da versão do iOS. Quando não estiver disponível, o app usa o fallback.

### Desktop

Chrome e Edge oferecem a instalação pelo ícone na barra de endereços.

## WhatsApp: como funciona e limitações

O app oferece dois caminhos:

1. **Web Share API com arquivo.** Abre a folha de compartilhamento nativa do celular. O usuário escolhe o WhatsApp e o contato ou grupo, e a foto vai anexada. É o caminho preferencial em Android (Chrome, Edge, Samsung Internet) e em versões recentes do Safari no iOS.
2. **Fallback sem Web Share.** Baixa a foto comprimida e abre o `wa.me` com o texto. O usuário precisa anexar a foto manualmente no WhatsApp.

Se a Web Share API falhar (por exemplo, permissão negada ou anexo recusado), o app executa o mesmo fallback automaticamente: baixa a foto, abre o `wa.me` e mantém o aviso na tela para anexar o arquivo.

Limitações importantes:

- **Não é possível escolher o contato ou grupo automaticamente.** A Web Share API sempre mostra a folha do sistema para o usuário decidir.
- **O `wa.me` não anexa fotos e não envia a mensagem sozinho.** Ele apenas abre a conversa com o texto preenchido; o usuário precisa tocar em enviar.
- **O grupo configurado é apenas um rótulo.** Não existe link confiável para abrir um grupo específico; no compartilhamento, o usuário escolhe o grupo.
- **Não há confirmação de entrega ou leitura.** O app não tem acesso ao status da mensagem.
- **Mensagens muito longas podem ser truncadas** por alguns aplicativos. O app mantém os textos curtos.
- **O fallback no iOS pode abrir a imagem em uma nova aba** em vez de baixar. Nesse caso, use o toque longo e **Salvar em Fotos**.
- **Não há integração com a API do WhatsApp.** Não é necessário token, servidor ou conta Business.

### Alternativas para envio automático (não incluídas)

- **WhatsApp Cloud API (Meta):** oficial, exige conta Meta Business, número dedicado, token, backend/webhook, templates para mensagens iniciadas pela empresa, janela de atendimento de 24 horas e cobrança por conversa. Permite enviar texto e mídia automaticamente.
- **Z-API, Evolution API, WPPConnect:** gateways não oficiais/auto-hospedados. Exigem servidor, sessão/QR do WhatsApp, têm risco de instabilidade e podem violar os termos do WhatsApp.
- **Twilio WhatsApp API:** oficial via BSP, com requisitos e custos semelhantes aos da Cloud API.

Para adotar uma dessas opções seria necessário criar um backend, guardar o token com segurança no servidor, enviar texto e foto, tratar falhas e manter o fluxo local atual como fallback. **Nunca embuta tokens no app estático.**

## Privacidade e LGPD

- Os dados ficam no aparelho, no IndexedDB do navegador. Não há servidor da aplicação.
- As fotos não são salvas; são usadas apenas na ação de compartilhamento.
- Backups em JSON contêm fornecedor, NF e observações. Guarde-os com segurança e apague quando não forem mais necessários.
- Limpar os dados do navegador apaga os registros. Exporte backups regularmente.
- O app não tem login; proteja o aparelho com bloqueio de tela.
- Se for usada uma API do WhatsApp, os dados saem do aparelho e passam a ser tratados pela Meta ou pelo provedor. Avalie a base legal e a retenção conforme a LGPD.

## Atualização e cache

- Ao alterar CSS, JavaScript, ícones ou vendor, **incremente `CACHE_NAME` em `sw.js`**, a `version` em `package.json` e a versão exibida em **Sobre** no `index.html`.
- O novo service worker chama `skipWaiting()` e `clients.claim()`. Pode ser necessário fechar e reabrir o app uma vez.
- A navegação é network-first; os demais arquivos são cache-first. Sem o incremento do cache, usuários existentes podem continuar recebendo os arquivos antigos.

## Checklist de testes

- [ ] Abrir online, instalar o PWA e abrir offline.
- [ ] Registrar material com NF e foto; conferir mensagem e envio.
- [ ] Registrar material com NF sem foto.
- [ ] Conferir o card de pendentes e o tempo decorrido.
- [ ] Registrar a saída com a hora atual.
- [ ] Ajustar manualmente o horário de saída.
- [ ] Testar os filtros Hoje, Ontem, Últimos 7 dias, Mês atual e Personalizado.
- [ ] Editar fornecedor, NF, observação e horários.
- [ ] Apagar um registro com confirmação.
- [ ] Gerar o PDF, baixar e abrir no leitor.
- [ ] Testar o fluxo sem NF (Correios/Sedex).
- [ ] Exportar backup, apagar tudo e importar o backup.
- [ ] Alterar número e grupo e conferir o link do WhatsApp.
- [ ] Testar o fallback sem Web Share (download da foto + `wa.me`).
- [ ] Testar a falha de compartilhamento com foto (fallback automático).
- [ ] Testar em um Android e em um iPhone reais.
- [ ] Conferir data, hora e virada de dia no fuso de São Paulo.
- [ ] Verificar foco, labels e contraste em teclado e leitor de tela.

## Limitações conhecidas

- Sem sincronização ou multiusuário: cada aparelho tem seus próprios dados.
- Sem autenticação: qualquer pessoa com o aparelho pode ver e editar.
- Os dados podem ser apagados pelo navegador (limpeza de dados, modo privado ou falta de espaço).
- As fotos não são armazenadas; se o envio falhar, é preciso tirar ou selecionar novamente.
- A Web Share API não permite pré-selecionar contato ou grupo.
- O `wa.me` não anexa foto; o fallback exige anexação manual.
- O PDF é gerado no aparelho; relatórios muito grandes podem consumir memória.
- O fuso é fixo em `America/Sao_Paulo`. Para outra localidade, ajuste `js/datetime.js`.
- O service worker exige HTTPS ou `localhost`.
- Não há integração oficial com o WhatsApp nem confirmação de entrega.

## Navegadores recomendados

- Android: Chrome, Edge ou Samsung Internet recentes.
- iOS/iPadOS: Safari recente.
- Desktop: Chrome ou Edge para instalação; demais navegadores funcionam sem instalação.

## Licença

Uso interno da Clarity Glass.
