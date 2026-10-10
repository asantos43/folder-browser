# Folder Browser

<img src="build/icon.png" alt="Ícone do Folder Browser: uma pasta fechada por um zíper, com uma página, um lápis, um botão de play e uma lente" width="96" align="right">

**O gerenciador de arquivos que entende os seus arquivos.** Um aplicativo de desktop para navegar por pastas e arquivos ZIP e para **ver e tratar o que há neles, ali mesmo**: ler documentos, imagens, PDFs, tabelas, mídia e bytes; editar texto e consertar um arquivo até **dentro de um ZIP**; pôr dois arquivos lado a lado num **diff**; abrir snapshots `.wsnp` (páginas web salvas para leitura offline) exatamente como o [WSNP Viewer](https://github.com/asantos43/wsnp-viewer) os mostra. O plano é fazê-lo crescer, com extensões, até ser a ferramenta que você procura primeiro para as **tarefas pequenas** do dia (recortar uma imagem, girar ou juntar páginas de um PDF, conferir se um YAML ou um Dockerfile é válido) em vez de abrir um programa diferente para cada uma.

Roda no Linux, Windows e macOS, é feito com Electron e TypeScript e tem o visual e o comportamento do Dark+ e do Light+ do Visual Studio Code. Inglês e português do
Brasil, conforme o idioma do sistema. [English](README.md).

![Folder Browser: a árvore de pastas à esquerda, um arquivo numa aba à direita](docs/images/workbench.png)

O [guia do usuário](docs/USER-GUIDE.pt-BR.md) mostra cada funcionalidade, com imagens, e como usá-la; ele também está dentro do aplicativo: **Ajuda ▸ Guia do Usuário** (`F1`), em português ou inglês, sem rede.

> **Situação: inicial (0.1.3).** O que está em [O que faz](#o-que-faz) funciona hoje; o que está em [Para onde vai](#para-onde-vai) é **planejado e ainda não foi feito** (o plano está no [`TODO.md`](TODO.md) e em `docs/todo/`). Até agora foi usado no Linux: os pacotes do Windows e do macOS são construídos e verificados, mas ninguém os usou ainda.

## A ideia

Os gerenciadores de arquivos são bons em nomes, tamanhos e datas, e entregam todo o resto a outros programas. Mas **quase tudo o que fazemos com um arquivo é pequeno**: recortar uma imagem, mudar uma linha, girar uma página de um PDF, juntar dois PDFs, separar páginas, comparar duas versões, olhar dentro de um arquivo compactado, conferir se uma configuração é válida. Cada uma dessas tarefas hoje obriga a achar e abrir um programa diferente, e no Linux muitas vezes não há uma boa alternativa atualizada para alguma delas. Para quem trabalha com TI ou software, isso significa recorrer ao Notepad++ ou ao VS Code para as coisas mais básicas.

O Folder Browser parte de outra ideia: **o gerenciador de arquivos deve ser o lugar onde você vê um arquivo e faz a tarefa rápida com ele.** Seus princípios:

- **Entender o arquivo.** Cada tipo de arquivo tem um visualizador de verdade, que desenha sem executar nada.
- **Fazer a tarefa pequena ali mesmo.** Editar, consertar, comparar, girar, juntar, converter, validar, até dentro de um ZIP, e voltar ao que estava fazendo.
- **Seguro por padrão.** Arquivos de qualquer origem aparecem em quadros isolados e sem rede; toda gravação é atômica e conferida; um histórico para desfazer está planejado.
- **Local e privado.** Nada sai do computador a menos que você peça.
- **Rápido para abrir.** Uma tarefa rápida não pode custar mais do que iniciar um programa maior.
- **Extensível.** Extensões (planejadas, projetadas com a segurança em primeiro lugar: pacotes assinados e um catálogo assinado opcional) ensinam novos tipos de arquivo e de tarefa, como os plugins estendem um programa, para que ele cresça sem ficar pesado.

Ele **não** pretende substituir um editor ou uma IDE para um projeto inteiro: para isso, entregue a pasta ao VS Code (**Abrir com…**).

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
| **Texto novo** | **Arquivo ▸ Novo Arquivo de Texto** (`Ctrl+N`) abre uma aba vazia que existe só na janela: cole um trecho de texto nela (a linguagem, como HTML ou JSON, é detectada e pode ser trocada na barra de status) e compare com um arquivo (**Selecionar para comparar**, no menu da aba) ou ponha ao lado de um (**Dividir à direita**); **Salvar como** transforma a aba no arquivo salvo. |
| **Botão direito** | Um menu por tipo de arquivo (texto, imagem, PDF, ZIP, `.wsnp`, pasta) e **Abrir com…** em todo arquivo, com os aplicativos instalados no computador e seus comandos cadastrados nas Configurações. |
| **WSNP** | Arquivos `.wsnp` abrem como snapshots, isolados, verificados (SHA-256, assinatura) e sem rede, como no WSNP Viewer. São somente leitura. |

Nada sai do computador: sem conta, sem análise de uso, sem rede, exceto um link da web em que você clica.

## Para onde vai

Planejado, ainda não feito, em ordem aproximada de valor (cada item com o projeto, o orçamento e os testes no [`TODO.md`](TODO.md) e em [`docs/todo/`](docs/todo/); o sistema de extensões em [`docs/EXTENSIONS-DESIGN.md`](docs/EXTENSIONS-DESIGN.md)):

- **PDF**: bookmarks, links, formulários que dá para preencher e salvar, anotações, e **girar, apagar, reordenar, separar e juntar páginas**.
- **Imagens**: recortar, girar, redimensionar, desenhar formas, copiar e colar, com desfazer e refazer; ler e editar o **EXIF**; salvar em outro formato e qualidade.
- **Arquivos que entendem o próprio conteúdo** (para quem trabalha com TI e software): abrir um Dockerfile, um manifesto do Kubernetes, um workflow de CI ou um `docker-compose.yml` e ver **problemas, a validação contra o esquema, um esboço e uma versão formatada**; decodificar um certificado, um JWT ou uma linha de cron; converter entre JSON, YAML e TOML.
- **Ferramentas de texto** de um bom editor: mudar a caixa, ordenar e limpar linhas, localizar e substituir com expressões regulares, vários cursores.
- **Comparar** pastas, imagens, PDFs e arquivos compactados, não só texto.
- **Redes de segurança**: um histórico local para desfazer qualquer gravação, dados escondidos (GPS, autor) mostrados e removíveis, redação de verdade, um modo só de inspeção, uma triagem de arquivos arriscados.
- **Arquivos compactados**: compactar e extrair, `tar`, `tar.gz`, `7z`; **SQLite** e outros arquivos de dados; playlists; uma galeria.
- **Extensões** com um catálogo assinado, e distribuição pelos repositórios de pacotes e lojas que as pessoas já usam.

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
