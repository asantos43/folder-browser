# Privacy

*Last updated: 2026-09-30. [Português abaixo.](#privacidade)*

Folder Browser shows and changes the folders and ZIP files you open, and opens web pages that were saved to a file. It is built so that **nothing leaves your computer**.

## What it does not do

- No account, no sign-in, no server of its own.
- No analytics, no telemetry, no advertising, no crash reports sent anywhere.
- No update check (there is no automatic update yet: you install a new release yourself).
- **The application makes no network request at all.** Its own window can only load its own files, and a snapshot's page can only load files that are in
  its own `.wsnp`: everything else it tries (images, scripts, frames, forms, beacons, sockets, navigation) is cancelled before any request is made, and the
  checks for this are part of the test suite.

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
| The signers you chose to trust: the fingerprint of a signing key and the name you gave it | `trusted-signers.json` | to tell a key you know from one you do not (see `docs/MANIFEST-SIGNING.md`). **Stop trusting** removes one |
| The files Chromium keeps for any window (caches of the interface itself) | the rest of the folder | they hold nothing from your snapshots |

The **contents of a snapshot are never written to disk** by the viewer: it reads them from the `.wsnp` when they are needed and keeps them in memory while the tab is open.
The only files it writes are the ones you ask for (**Save As…**, **Extract**, **Save as PDF…**, **Save as .wsnp…**), where you choose, and two exceptions: when you choose **Open With…**, a read-only copy of that one file is written to your system's temporary folder for the application you pick, and removed when the viewer quits; and a ZIP saved by an older PageKeep is converted to a `.wsnp` in your system's temporary folder, to be shown, and that file is deleted when you close the snapshot. The ZIP itself is never changed. Delete the folder above to remove everything the application kept.

## Files and their signatures

A `.wsnp` can carry the public key of the program that wrote it, and a signature. The viewer reads them; it does not send them anywhere. The same key is in every file written by the
same installation of PageKeep, so whoever holds several of your files can tell they came from one installation.

## Changes

A change to this policy is made in this file and noted in `CHANGELOG.md`.

---

# Privacidade

*Última atualização: 2026-09-30.*

O Folder Browser abre páginas da web que foram salvas num arquivo. Ele foi feito para que **nada saia do seu computador**.

## O que ele não faz

- Sem conta, sem login, sem servidor próprio.
- Sem análise de uso, sem telemetria, sem publicidade, sem relatórios de falha enviados a lugar nenhum.
- Sem verificação de atualização (ainda não há atualização automática: você instala a nova versão).
- **O aplicativo não faz nenhuma requisição de rede.** A própria janela só carrega os arquivos dela, e a página de um snapshot só carrega arquivos que estão no próprio `.wsnp`: tudo o mais que ela
  tenta (imagens, scripts, quadros, formulários, beacons, sockets, navegação) é cancelado antes de qualquer requisição, e as verificações disso fazem parte dos testes.

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
| Os assinantes em que você decidiu confiar: a impressão digital de uma chave de assinatura e o nome que você deu | `trusted-signers.json` | para distinguir uma chave que você conhece de uma que não conhece (veja `docs/MANIFEST-SIGNING.md`). **Deixar de confiar** remove uma |
| Os arquivos que o Chromium guarda para qualquer janela (caches da própria interface) | o resto da pasta | não guardam nada dos seus snapshots |

O **conteúdo de um snapshot nunca é gravado em disco** pelo visualizador: ele o lê do `.wsnp` quando precisa e o mantém na memória enquanto a aba está aberta. Os únicos arquivos que ele grava são os que você pede
(**Salvar Como…**, **Extrair**, **Salvar como PDF…**, **Salvar como .wsnp…**), onde você escolhe, e duas exceções: quando você escolhe **Abrir com…**, uma cópia somente leitura desse arquivo é gravada na pasta temporária do sistema para o aplicativo que você escolher, e removida quando o visualizador fecha; e um ZIP salvo por um PageKeep antigo é convertido em um `.wsnp` na pasta temporária do sistema, para ser mostrado, e esse arquivo é apagado quando você fecha o snapshot. O ZIP em si nunca é alterado. Apague a pasta acima para remover tudo o que o aplicativo guardou.

## Arquivos e suas assinaturas

Um `.wsnp` pode levar a chave pública do programa que o gravou e uma assinatura. O visualizador as lê; não as envia a lugar nenhum. A mesma chave está em todo arquivo gravado pela mesma instalação do PageKeep,
então quem tiver vários dos seus arquivos pode perceber que vieram de uma só instalação.

## Mudanças

Uma mudança nesta política é feita neste arquivo e anotada no `CHANGELOG.md`.
