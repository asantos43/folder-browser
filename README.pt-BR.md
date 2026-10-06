# Folder Browser

<img src="build/icon.png" alt="Ícone do Folder Browser: uma pasta fechada por um zíper, com uma página, um lápis, um botão de play e uma lente" width="96" align="right">

Um aplicativo de desktop para **navegar por pastas e arquivos ZIP**, alterar o que há neles e ler snapshots **WSNP**. Escolha uma pasta ou um `.zip`, veja os
arquivos (os ocultos, se quiser), crie, renomeie, mova, apague e **edite** arquivos de texto (HTML, TXT, JSON, código…) na pasta ou **dentro do ZIP**, ponha
dois arquivos de texto lado a lado num **diff** e abra arquivos `.wsnp` (páginas web salvas para leitura offline) exatamente como o
[WSNP Viewer](https://github.com/asantos43/wsnp-viewer) os mostra.

Roda no Linux, Windows e macOS, é feito com Electron e TypeScript e tem o visual e o comportamento do Dark+ e do Light+ do Visual Studio Code. Inglês e português do
Brasil, conforme o idioma do sistema. [English](README.md).

![Folder Browser: a árvore de pastas à esquerda, um arquivo numa aba à direita](docs/images/workbench.png)

O [guia do usuário](docs/USER-GUIDE.pt-BR.md) mostra cada funcionalidade, com imagens, e como usá-la; ele também está dentro do aplicativo: **Ajuda ▸ Guia do Usuário** (`F1`), em português ou inglês, sem rede.

> **Situação: primeira versão (0.1.0).** Navegar por pastas e arquivos ZIP, a árvore com várias linhas marcadas, Recortar/Copiar/Colar, editar texto (também dentro de um ZIP), tabelas, diff, dois grupos de editor,
> mídia, documentos de escritório, a visão hexadecimal e os snapshots `.wsnp` funcionam; o que falta está no [`TODO.md`](TODO.md).

## O que faz

| | |
| --- | --- |
| **Lugares** | Uma barra lateral com **Home, Documentos, Downloads, Música, Imagens, Vídeos, Área de trabalho, Lixeira**, suas **pastas recentes** e suas **pastas favoritas** (arraste uma pasta para fixá-la). |
| **Navegar** | Uma árvore de pastas e arquivos ZIP (o ZIP abre como pasta, até dentro de outro ZIP), com uma chave para **mostrar arquivos ocultos** (`Ctrl+H`). |
| **Alterar** | Criar, **renomear** (`F2`), mover (um seletor de pastas, ou arrastar e soltar) e apagar arquivos e pastas de uma pasta que você abriu; apagar manda para a lixeira, e nada é substituído. O mesmo dentro de um arquivo ZIP (também um ZIP dentro de um ZIP), que é regravado inteiro e com segurança; lá apagar é definitivo, pois um ZIP não tem lixeira. |
| **Editar** | Arquivos de texto (HTML, TXT, JSON, Markdown, código…) abrem num editor com cores de sintaxe; `Ctrl+S` salva o arquivo inteiro e com segurança (um arquivo temporário renomeado sobre ele, terminações de linha mantidas, e uma pergunta se ele mudou no disco nesse meio-tempo); uma aba com alterações mostra um ponto e pergunta antes de fechar. O que você digitou e não salvou é guardado para a próxima vez. Um arquivo de texto **dentro de um ZIP** é editado e salvo do mesmo jeito: o ZIP é regravado e as entradas que você não tocou são copiadas como estavam. |
| **Documentos** | Arquivos do Word, PowerPoint, LibreOffice e Excel (`.docx`, `.pptx`, `.odt`, `.ods`, `.odp`, `.xlsx`, `.xls`…) são desenhados numa aba, num quadro sem rede; CSV e TSV abrem como tabela que você pode ordenar, filtrar, buscar, consultar em SQL (`SELECT`, executado pelo SQLite num worker) e **editar célula a célula**. |
| **Hex** | Programas, bibliotecas e qualquer arquivo de bytes (`.exe`, `.dll`, `.so`, `.bin`, `.iso`…) abrem como posição, hexadecimal e texto, com seleção, cópia, Ir para a posição e Localizar bytes ou texto; o cabeçalho diz o que o arquivo é (ELF, PE, Mach-O, ZIP…) sem executá-lo. **Editar** muda os bytes (dígitos hex ou texto, Insert, Delete, desfazer) e salva como o texto. |
| **Tocar** | Vídeos e sons tocam numa aba (mp4, webm, mp3, flac, wav…), com busca, volume, velocidade e Próximo/Anterior na pasta, também de dentro de um ZIP. |
| **Comparar** | **Selecionar para comparar** e **Comparar com o selecionado**, no menu da árvore, põem dois arquivos de texto (disco ou ZIP) numa aba de **diff**, lado a lado ou em uma coluna, com cores de sintaxe, as alterações contadas e F7 para percorrê-las. |
| **Botão direito** | Um menu por tipo de arquivo (texto, imagem, PDF, ZIP, `.wsnp`, pasta) e **Abrir com…** em todo arquivo, com os aplicativos instalados no computador. |
| **WSNP** | Arquivos `.wsnp` abrem como snapshots, isolados, verificados (SHA-256, assinatura) e sem rede, como no WSNP Viewer. São somente leitura. |

Nada sai do computador: sem conta, sem análise de uso, sem rede, exceto um link da web em que você clica.

## Instalação

Os arquivos de versão estão na [página de Releases](https://github.com/asantos43/folder-browser/releases). Eles **não são assinados**, então o primeiro
início mostra um aviso no Windows e no macOS (Windows: **Mais informações ▸ Executar assim mesmo**; macOS: clique com o botão direito no aplicativo ▸ **Abrir**, ou permita-o em **Ajustes do Sistema ▸ Privacidade e Segurança**).

| Sistema | Arquivo |
| --- | --- |
| Windows | `folder-browser-<versão>-win-x64.exe` |
| macOS (Apple Silicon e Intel) | `folder-browser-<versão>-mac-universal.dmg` |
| Debian, Ubuntu | `folder-browser-<versão>-linux-amd64.deb` (`sudo apt install ./<arquivo>`) |
| Fedora, Red Hat | `folder-browser-<versão>-linux-x86_64.rpm` (`sudo dnf install ./<arquivo>`) |

## Compilar a partir do código

É preciso Node.js 22 ou mais novo.

```sh
npm ci
npm run app            # compila e inicia o aplicativo
npm test               # testes unitários e de componentes
npm run test:e2e       # o aplicativo de verdade, dirigido pelo Playwright
npm run package:linux  # ou package:win, package:mac: os arquivos de versão, em release/
```

Mais em [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md); como as mudanças são feitas está em [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Privacidade e segurança

O que fica guardado no seu computador está em [`PRIVACY.md`](PRIVACY.md). O Folder Browser **altera seus arquivos**, então só mexe nas pastas e nos ZIPs que você abriu, manda
o que é apagado para a lixeira e grava por um arquivo temporário; como arquivos hostis são tratados e como relatar uma vulnerabilidade está em [`SECURITY.md`](SECURITY.md).

## Documentação

| | |
| --- | --- |
| [`TODO.md`](TODO.md) | O plano, fase por fase, e o que vem a seguir |
| [`CHANGELOG.md`](CHANGELOG.md) | O que mudou, por versão |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Como o aplicativo é feito e suas regras de segurança |
| [`docs/USER-GUIDE.pt-BR.md`](docs/USER-GUIDE.pt-BR.md) ([en](docs/USER-GUIDE.md)) | Como usar (por ora, a parte WSNP; o resto é escrito conforme chega) |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md), [`docs/RELEASING.md`](docs/RELEASING.md) | Preparar o ambiente, testar, fazer uma versão |
| [`wsnp-format/FORMAT.md`](https://github.com/asantos43/wsnp-format/blob/main/FORMAT.md), [`wsnp-format/MANIFEST-SIGNING.md`](https://github.com/asantos43/wsnp-format/blob/main/MANIFEST-SIGNING.md), [`docs/PAGEKEEP-ZIP.md`](docs/PAGEKEEP-ZIP.md), [`docs/VIEWER-GUIDELINES.md`](docs/VIEWER-GUIDELINES.md) | O formato WSNP e o que um visualizador deve fazer (copiados do WSNP Viewer) |
| [`docs/UI-DESIGN.md`](docs/UI-DESIGN.md) | A interface no estilo do VS Code |
| [`docs/WSNP-VIEWER-ARCHITECTURE.md`](docs/WSNP-VIEWER-ARCHITECTURE.md), [`docs/WSNP-VIEWER-HISTORY.md`](docs/WSNP-VIEWER-HISTORY.md) | O que foi herdado do WSNP Viewer 0.1.0 |
| [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) | As bibliotecas dentro do aplicativo e suas licenças |

A interface é *inspirada no* Visual Studio Code. O Folder Browser não é o Visual Studio Code e não é endossado pela Microsoft.

## Licença

[Mozilla Public License 2.0](LICENSE) (MPL-2.0).
