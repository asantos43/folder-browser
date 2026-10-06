# Privacy

*Last updated: 2026-10-06. [Português abaixo.](#privacidade)*

Folder Browser shows and changes the folders and ZIP files you open, plays and draws what is in them (text, pictures, documents, sounds, videos, bytes), and opens web pages that were saved to a file. It is built so that **nothing leaves your computer**.

## What it does not do

- No account, no sign-in, no server of its own.
- No analytics, no telemetry, no advertising, no crash reports sent anywhere.
- No update check (there is no automatic update yet: you install a new release yourself).
- **The application makes no network request at all.** Its own window can only load its own files, a snapshot's page can only load files that are in
  its own `.wsnp`, and an office document is drawn in a frame that has no network at all: everything else a page or a document tries (images, scripts, frames, forms, beacons, sockets, navigation) is cancelled before any request is made, and the
  checks for this are part of the test suite. (Documents are drawn by libraries that run inside the application; no file is sent to a service to be drawn.)

## The one time the network is used

When you **click a link to the web** in a snapshot, or one of the links of the application (the source code, the user guide, a snapshot's source address), it
opens in **your default browser**. That is the browser's request, to that site, and the only one.

## What is kept on your computer

In the application's own folder (`~/.config/folder-browser` on Linux, `%APPDATA%\folder-browser` on Windows, `~/Library/Application Support/folder-browser` on macOS):

| What | Where | Why |
| --- | --- | --- |
| Your settings: colour theme, language, how SVG files are shown, the width of the side bar | the window's local storage | so they are as you left them |
| The paths of the snapshots and files that are open (only their names, never their contents) | `session.json` | to open them again at the next start (**Settings ▸ Reopen the files that were open**; off, nothing is kept) |
| The paths of the files you opened lately (up to 10) | `recent-files.json` | **Open Recent**. **Clear Recently Opened** empties it |
| The folders you opened lately (up to 10) | `recent-folders.json` | **Recent Folders** in the side bar. **Clear Recent Folders** empties it |
| The folders you pinned | `favorites.json` | **Favorites** in the side bar. Remove one from its menu |
| The changes you made and did not save (the text or the bytes, with the path of the file) | `drafts/` | so that closing the application does not lose them (**Settings ▸ Keep changes that are not saved**; off, nothing is kept and the application asks before it closes). A draft is removed when you save, reload or close the tab without saving, and after 90 days |
| The signers you chose to trust: the fingerprint of a signing key and the name you gave it | `trusted-signers.json` | to tell a key you know from one you do not (see `wsnp-format/MANIFEST-SIGNING.md`). **Stop trusting** removes one |
| The files Chromium keeps for any window (caches of the interface itself) | the rest of the folder | they hold nothing from your snapshots |

The **contents of a snapshot, a ZIP or a document are never written to disk** by the application to be shown: it reads them when they are needed and keeps them in memory while the tab is open. The files it writes are the ones you ask for: **Save As…**, **Extract**, **Save as PDF…**, **Save as .wsnp…**, where you choose, **Save** of a text you edited (written to a temporary file next to it and renamed over it), and **New File…**, **New Folder…**, **Rename** and **Move**, in the folder you opened; **Delete** moves an item to your system's trash, and removes it for good only after the trash refused it and you said yes again. Three exceptions are temporary copies in your system's temporary folder, each removed when the application quits (and a stale one at the next start): when you choose **Open With…**, a read-only copy of that one file for the application you pick; a video or a sound that is an entry of a ZIP, copied to be played; and a ZIP saved by an older PageKeep, converted to a `.wsnp` to be shown, deleted when you close the snapshot. A ZIP itself is never changed. Delete the folder above to remove everything the application kept.

## Files and their signatures

A `.wsnp` can carry the public key of the program that wrote it, and a signature. The application reads them; it does not send them anywhere. The same key is in every file written by the
same installation of PageKeep, so whoever holds several of your files can tell they came from one installation.

## Changes

A change to this policy is made in this file and noted in `CHANGELOG.md`.

---

# Privacidade

*Última atualização: 2026-10-06.*

O Folder Browser mostra e altera as pastas e os arquivos ZIP que você abre, toca e desenha o que há neles (texto, imagens, documentos, sons, vídeos, bytes) e abre páginas da web que foram salvas num arquivo. Ele foi feito para que **nada saia do seu computador**.

## O que ele não faz

- Sem conta, sem login, sem servidor próprio.
- Sem análise de uso, sem telemetria, sem publicidade, sem relatórios de falha enviados a lugar nenhum.
- Sem verificação de atualização (ainda não há atualização automática: você instala a nova versão).
- **O aplicativo não faz nenhuma requisição de rede.** A própria janela só carrega os arquivos dela, a página de um snapshot só carrega arquivos que estão no próprio `.wsnp`, e um documento de escritório é desenhado num quadro que não tem rede nenhuma: tudo o mais que uma página ou um documento
  tenta (imagens, scripts, quadros, formulários, beacons, sockets, navegação) é cancelado antes de qualquer requisição, e as verificações disso fazem parte dos testes. (Os documentos são desenhados por bibliotecas que rodam dentro do aplicativo; nenhum arquivo é enviado a um serviço para ser desenhado.)

## A única vez em que a rede é usada

Quando você **clica num link da web** num snapshot, ou num dos links do aplicativo (o código-fonte, o guia do usuário, o endereço de origem de um snapshot), ele abre no **seu navegador padrão**. Essa é a requisição
do navegador, àquele site, e a única.

## O que fica no seu computador

Na pasta do próprio aplicativo (`~/.config/folder-browser` no Linux, `%APPDATA%\folder-browser` no Windows, `~/Library/Application Support/folder-browser` no macOS):

| O quê | Onde | Para quê |
| --- | --- | --- |
| Suas configurações: tema de cores, idioma, como os arquivos SVG são mostrados, a largura da barra lateral | o armazenamento local da janela | para ficarem como você deixou |
| Os caminhos dos snapshots e arquivos que estão abertos (só os nomes, nunca o conteúdo) | `session.json` | para abri-los de novo na próxima vez (**Configurações ▸ Reabrir os arquivos que estavam abertos**; desligado, nada é guardado) |
| Os caminhos dos arquivos que você abriu há pouco (até 10) | `recent-files.json` | **Abrir Recente**. **Limpar Abertos Recentemente** esvazia |
| As pastas que você abriu há pouco (até 10) | `recent-folders.json` | **Pastas Recentes** na barra lateral. **Limpar Pastas Recentes** esvazia |
| As alterações que você fez e não salvou (o texto ou os bytes, com o caminho do arquivo) | `drafts/` | para que fechar o aplicativo não as perca (**Configurações ▸ Manter alterações não salvas**; desligado, nada é guardado e o aplicativo pergunta antes de fechar). Um rascunho é removido quando você salva, recarrega ou fecha a aba sem salvar, e depois de 90 dias |
| As pastas que você fixou | `favorites.json` | **Favoritos** na barra lateral. Remova uma pelo menu dela |
| Os assinantes em que você decidiu confiar: a impressão digital de uma chave de assinatura e o nome que você deu | `trusted-signers.json` | para distinguir uma chave que você conhece de uma que não conhece (veja `wsnp-format/MANIFEST-SIGNING.md`). **Deixar de confiar** remove uma |
| Os arquivos que o Chromium guarda para qualquer janela (caches da própria interface) | o resto da pasta | não guardam nada dos seus snapshots |

O **conteúdo de um snapshot, de um ZIP ou de um documento nunca é gravado em disco** pelo aplicativo para ser mostrado: ele o lê quando precisa e o mantém na memória enquanto a aba está aberta. Os arquivos que ele grava são os que você pede: **Salvar Como…**, **Extrair**, **Salvar como PDF…**, **Salvar como .wsnp…**, onde você escolhe, **Salvar** de um texto que você editou (gravado num arquivo temporário ao lado e renomeado sobre ele), e **Novo Arquivo…**, **Nova Pasta…**, **Renomear** e **Mover**, na pasta que você abriu; **Apagar** move um item para a lixeira do sistema, e só o remove de vez depois que a lixeira o recusou e você disse sim de novo. Três exceções são cópias temporárias na pasta temporária do sistema, cada uma removida quando o aplicativo fecha (e uma esquecida, na próxima vez que ele abre): quando você escolhe **Abrir com…**, uma cópia somente leitura desse arquivo para o aplicativo que você escolher; um vídeo ou som que é entrada de um ZIP, copiado para ser tocado; e um ZIP salvo por um PageKeep antigo, convertido em um `.wsnp` para ser mostrado, apagado quando você fecha o snapshot. Um ZIP em si nunca é alterado. Apague a pasta acima para remover tudo o que o aplicativo guardou.

## Arquivos e suas assinaturas

Um `.wsnp` pode levar a chave pública do programa que o gravou e uma assinatura. O aplicativo as lê; não as envia a lugar nenhum. A mesma chave está em todo arquivo gravado pela mesma instalação do PageKeep,
então quem tiver vários dos seus arquivos pode perceber que vieram de uma só instalação.

## Mudanças

Uma mudança nesta política é feita neste arquivo e anotada no `CHANGELOG.md`.
