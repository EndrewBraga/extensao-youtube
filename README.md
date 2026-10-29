# YT Downloader (uso pessoal)

Extensão do Chrome (Manifest V3) que mostra um botão flutuante nas páginas de vídeo do YouTube para baixar **MP4** ou **MP3**. O download é feito por um host nativo (Node.js) que chama o `yt-dlp` instalado na sua máquina. Instalada só em modo desenvolvedor, nunca publicada.

> **Aviso legal:** baixar vídeos do YouTube viola os Termos de Serviço da plataforma, exceto para conteúdo próprio, licenciado em Creative Commons ou downloads offline do YouTube Premium. Use apenas de forma pessoal e por sua conta e risco.

## Como funciona

```
Página do YouTube ──> content.js (botões) ──> background.js ──connectNative──> host.bat ──> host.js ──> yt-dlp + ffmpeg
```

O painel tem um seletor de resolução, a opção "Preferir H.264" e um seletor de bitrate para o MP3. A escolha fica salva no navegador. Durante o download o painel mostra a etapa (vídeo, áudio, junção ou conversão), a porcentagem, a velocidade e o tempo restante; o resultado e eventuais erros ficam visíveis no próprio painel. Os arquivos vão para `%USERPROFILE%\Downloads\YouTube`. Playlists não são suportadas (só o vídeo da aba).

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
| Erro do yt-dlp (vídeo indisponível, HTTP 403 etc.) | Rode `yt-dlp -U`. Se persistir, teste a mesma URL no terminal com `yt-dlp URL`. |
| Os botões não aparecem | Só existem em `/watch?v=...`. Recarregue a aba. Verifique se a extensão está ativa em `chrome://extensions`. |
| Botão mostra "Recarregue a página" | A extensão foi recarregada e a aba ficou com o script antigo. Recarregue a aba. |
| Quero ver o erro completo | A notificação trunca a mensagem. Rode o comando do yt-dlp manualmente no terminal. |

## Limitações

- Sem "Preferir H.264", o MP4 usa o melhor vídeo disponível em contêiner mp4, que costuma ser **AV1** (até 4K quando existe). Toca no VLC e no Chrome, mas pode não tocar em players, TVs e celulares antigos.
- Com "Preferir H.264", o vídeo vem em H.264/AAC (mais compatível), em geral até 1080p. Se o vídeo não tiver H.264, cai para o melhor formato disponível.
- A resolução escolhida é um **teto**: se o vídeo não tiver aquela qualidade, baixa a maior abaixo dela.
- O MP3 é convertido do áudio original do YouTube (~128–160 kbps em AAC/Opus). Escolher 320 kbps não aumenta a qualidade real, só o tamanho.
- Sem playlists nem legendas.
- O botão depende de a aba ter o content script carregado. Em abas abertas antes de instalar a extensão, recarregue.
- Os botões ficam desabilitados durante o download da aba. Downloads em abas diferentes rodam em paralelo.

## Estrutura

```
extension/   manifest.json, background.js, content.js, adblock.js, adprune.js, icons/
tests/       adblock.test.js, adprune.test.js
host/        host.js, host.bat, install.js, test/host.test.js
```

`host/com.local.yt_downloader.json` é gerado pelo `install.js` (contém caminho local) e fica fora do git.
