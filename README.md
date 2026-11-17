# YT Downloader (uso pessoal)

Extensão do Chrome (Manifest V3) que mostra um botão flutuante nas páginas de vídeo do YouTube para baixar **MP4** ou **MP3**. O download é feito por um host nativo (Node.js) que chama o `yt-dlp` instalado na sua máquina. Instalada só em modo desenvolvedor, nunca publicada.

> **Aviso legal:** baixar vídeos do YouTube viola os Termos de Serviço da plataforma, exceto para conteúdo próprio, licenciado em Creative Commons ou downloads offline do YouTube Premium. Use apenas de forma pessoal e por sua conta e risco.

## Como funciona

```
Página do YouTube ──> content.js (botões) ──> background.js ──connectNative──> host.bat ──> host.js ──> yt-dlp + ffmpeg
```

O painel tem um seletor de resolução, a opção "Preferir H.264" e um seletor de bitrate para o MP3. A escolha fica salva no navegador. Durante o download o painel mostra a etapa (vídeo, áudio, junção ou conversão), a porcentagem, a velocidade e o tempo restante; o resultado e eventuais erros ficam visíveis no próprio painel. Os arquivos vão para `%USERPROFILE%\Downloads\YouTube`. Playlists não são suportadas (só o vídeo da aba).

## Painel: o que tem

A tela principal só mostra o essencial: **Formato**, **Qualidade** e o botão **Baixar**. Trecho, patrocínios e ajustes do YouTube ficam dentro de **Mais opções**, agrupados por assunto (a escolha de abrir ou fechar fica salva). Durante o download o botão vira a barra de progresso.

- **Baixar** MP4 ou MP3, com resolução máxima, preferência por H.264 e bitrate do MP3.
- **Mostrar na pasta**: depois do download, o painel tem o link "Mostrar na pasta" e a notificação do Chrome abre o arquivo no Explorer ao ser clicada. Em **Mais opções** há também "Abrir pasta de downloads". O host só abre arquivos que estão dentro de `Downloads\YouTube`.
- **Trecho (opcional)**: campos Início e Fim (`90`, `1:30` ou `1:02:03`). Só o início baixa até o fim; só o fim baixa desde o começo. O corte é preciso (`--force-keyframes-at-cuts`), por isso refaz o trecho e demora mais. O nome do arquivo ganha `(trecho 1m30s-2m00s)` para não ser confundido com o vídeo inteiro.
- **Remover patrocínios do arquivo**: usa o SponsorBlock via `yt-dlp` (`sponsor`, `selfpromo`, `interaction`). O nome ganha `(sem patrocínio)`.
- **Atualização automática do yt-dlp**: se um download falha por algo que parece desatualização (extração, HTTP 403 etc.), o host roda `yt-dlp -U` e tenta de novo uma vez, no máximo a cada 6 horas. Vídeo indisponível, privado ou só para membros não dispara atualização.
- **No YouTube** (chaves, ficam salvas): bloquear anúncios, pular patrocínios ao assistir e esconder Shorts, comentários, recomendados laterais e sugestões do fim do vídeo (essas últimas começam desligadas).

### Pular patrocínios (SponsorBlock)

Ao abrir um vídeo, o service worker consulta `https://sponsor.ajay.app` e o player pula os trechos de `sponsor`, `selfpromo` e `interaction` mostrando um aviso rápido. **Privacidade:** a consulta envia só os 4 primeiros caracteres do hash SHA-256 do ID do vídeo, nunca o ID. Os trechos vêm de votos da comunidade: podem faltar ou estar errados em vídeos novos. Não pula durante anúncios.

## Pré-requisitos

No PowerShell:

```powershell
winget install yt-dlp.yt-dlp Gyan.FFmpeg OpenJS.NodeJS.LTS
```

**Reinicie o Chrome por completo** (feche todas as janelas) para ele enxergar o PATH atualizado. Confirme em um terminal novo:

```powershell
yt-dlp --version
ffmpeg -version
node --version
```

## Instalação

1. Registre o host nativo (só grava em `HKCU`, sem admin):

   ```powershell
   node host\install.js
   ```

   O script mostra o ID da extensão. Ele é fixo: `fkpfdanjlidaodlcjnhjkhlolaknlede`.

2. No Chrome, abra `chrome://extensions`, ative o **Modo do desenvolvedor**, clique em **Carregar sem compactação** e escolha a pasta `extension\`. Confira se o ID exibido é o mesmo do passo 1.

3. Abra um vídeo no YouTube (`youtube.com/watch?v=...`). Os botões aparecem no canto inferior direito. Se a aba já estava aberta, recarregue-a.

## Desinstalação

```powershell
node host\install.js --uninstall
```

Depois remova a extensão em `chrome://extensions`.

## Testes

```powershell
node --test "tests/*.test.js" "host/test/*.test.js"
```

## Bloqueador de anúncios

O painel tem a chave **Bloquear anúncios** (ligada por padrão; a escolha fica salva). Ela age em três camadas no YouTube:

- **Remove os anúncios da resposta do YouTube** (`extension/adprune.js`, mundo `MAIN`): tira `adPlacements`, `playerAds` e `adSlots` do `JSON.parse`, do `fetch` e de `ytInitialPlayerResponse` antes de o player lê-los. Quando funciona, o anúncio nem chega ao player, sem tela escura.
- **Esconde** slots de anúncio (banner do topo, anúncios no feed, cartões patrocinados, sobreposições no player).
- **Pula anúncios de vídeo**: quando o player entra em modo de anúncio, muta, acelera para 16× e vai ao fim do anúncio (só se ele tiver até 5 minutos), além de clicar em "Pular" quando o botão aparece. Ao acabar, restaura volume e velocidade originais.
- Se o YouTube mostrar o aviso de "bloqueador de anúncios", o script o remove e retoma o vídeo.

Limites, sem rodeios:

- Não bloqueia requisições de rede, só age sobre a página. Anúncios inseridos no próprio stream não passam pela remoção e caem nas outras camadas (acelerar e pular), com uma tela escura breve.
- Depende dos nomes que o YouTube usa. Quando mudarem, anúncios voltam a aparecer até os campos de `extension/adprune.js` e os seletores de `extension/adblock.js` serem atualizados.
- Desligar a chave vale para as próximas respostas do YouTube; recarregue a aba para valer na hora.
- O YouTube combate bloqueadores. O aviso pode ser removido, mas ele pode também parar de entregar o vídeo até você desligar a chave. Não há garantia.
- Bloquear anúncios também contraria os Termos de Serviço do YouTube. Uso pessoal, por sua conta e risco.

## Manutenção

O YouTube muda com frequência e o yt-dlp precisa acompanhar. Atualize de vez em quando:

```powershell
yt-dlp -U
```

(ou `winget upgrade yt-dlp.yt-dlp` se instalou pelo winget).

## Troubleshooting

| Sintoma | Causa provável / solução |
|---|---|
| Notificação "Specified native messaging host not found" | O `install.js` não foi executado, ou o Chrome não foi reiniciado depois. Rode `node host\install.js` de novo. |
| "Access to the specified native messaging host is forbidden" | O ID da extensão carregada difere do `allowed_origins`. Use a pasta `extension\` original, sem alterar o campo `key` do manifest. |
| "Native host has exited" / "host encerrou sem responder" | O `node` não está no PATH do Chrome. Reinicie o Chrome. Teste `host\host.bat` num terminal: ele deve ficar esperando entrada. |
| "yt-dlp não encontrado no PATH" ou "ffmpeg não encontrado no PATH" | Instale com o `winget` acima e reinicie o Chrome **por completo**: fechar as janelas não basta, porque o Chrome continua em segundo plano com o PATH antigo. Use `taskkill /F /IM chrome.exe` e abra de novo. |
| Erro do yt-dlp (vídeo indisponível, HTTP 403 etc.) | O host já tenta `yt-dlp -U` sozinho (no máximo a cada 6h). Se persistir, rode `yt-dlp -U` e teste a mesma URL no terminal com `yt-dlp URL`. Mensagem "tentei atualizar o yt-dlp, sem sucesso": a atualização falhou; use `winget upgrade yt-dlp.yt-dlp`. |
| "Arquivo não encontrado" ao clicar em Mostrar na pasta | O arquivo foi movido ou apagado depois do download. |
| Os botões não aparecem | Só existem em `/watch?v=...`. Recarregue a aba. Verifique se a extensão está ativa em `chrome://extensions`. |
| Botão mostra "Recarregue a página" | A extensão foi recarregada e a aba ficou com o script antigo. Recarregue a aba. |
| Quero ver o erro completo | A notificação trunca a mensagem. Rode o comando do yt-dlp manualmente no terminal. |

## Limitações

- Sem "Preferir H.264", o MP4 usa o melhor vídeo disponível em contêiner mp4, que costuma ser **AV1** (até 4K quando existe). Toca no VLC e no Chrome, mas pode não tocar em players, TVs e celulares antigos.
- Com "Preferir H.264", o vídeo vem em H.264/AAC (mais compatível), em geral até 1080p. Se o vídeo não tiver H.264, cai para o melhor formato disponível.
- A resolução escolhida é um **teto**: se o vídeo não tiver aquela qualidade, baixa a maior abaixo dela.
- O MP3 é convertido do áudio original do YouTube (~128–160 kbps em AAC/Opus). Escolher 320 kbps não aumenta a qualidade real, só o tamanho.
- Sem playlists nem legendas.
- Trecho e remoção de patrocínios refazem partes do vídeo com o ffmpeg: demoram mais que um download normal.
- A atualização automática usa `yt-dlp -U`. Se o `yt-dlp` foi instalado de um jeito que não permite se atualizar sozinho, ela falha e o erro original é mostrado com um aviso.
- O botão depende de a aba ter o content script carregado. Em abas abertas antes de instalar a extensão, recarregue.
- Os botões ficam desabilitados durante o download da aba. Downloads em abas diferentes rodam em paralelo.

## Estrutura

```
extension/   manifest.json, background.js, content.js, sponsor.js, declutter.js, adblock.js, adprune.js, icons/
tests/       adblock.test.js, adprune.test.js, sponsor.test.js, declutter.test.js
host/        host.js, host.bat, install.js, test/host.test.js, test/host-features.test.js
```

`host/com.local.yt_downloader.json` é gerado pelo `install.js` (contém caminho local) e fica fora do git.
