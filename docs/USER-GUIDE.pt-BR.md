# Guia do usuário

O Folder Browser abre **arquivos `.wsnp`**: páginas da web salvas pela extensão [PageKeep](https://github.com/asantos43/webpage-snapshot) para ler offline. Um `.wsnp`
é um **contêiner**, um único arquivo que guarda uma página, todos os arquivos de que ela precisa e um manifesto que os descreve. [English](USER-GUIDE.md).

## Abrindo arquivos

- **Duplo clique** num `.wsnp` (os instaladores registram o tipo de arquivo), ou **Arquivo › Abrir Arquivo…** (`Ctrl+O`, `⌘O` no macOS).
- **Arraste** um ou mais arquivos para a janela.
- **Arquivo › Abrir Recente** lista os arquivos abertos há pouco; **Limpar Abertos Recentemente** esvazia a lista.
- Abrir um segundo arquivo com o aplicativo em execução acrescenta uma aba à mesma janela. Um arquivo que já está aberto apenas mostra a aba dele.
- O seletor de arquivos lista primeiro os **arquivos `.wsnp` e `.zip`**, e cada tipo sozinho; **Todos os arquivos** é a última escolha.
- Quando o aplicativo inicia sem um arquivo para abrir, ele **abre de novo o que estava aberto** quando foi fechado, na mesma ordem e com a mesma aba na frente
  (**Configurações ▸ Reabrir os arquivos que estavam abertos**; desligado, nada é guardado). Um arquivo dado na linha de comando, ou aberto com duplo clique, abre sozinho.

### Um ZIP salvo por um PageKeep antigo

Antes de existir o `.wsnp`, o PageKeep salvava uma página como um ZIP simples. O visualizador abre esses também: escolha o `.zip` em **Abrir Arquivo…**, solte-o na janela ou abra-o com duplo clique pelo visualizador.

- Ele é **convertido em um `.wsnp`** (um arquivo temporário, apagado quando você fecha a aba) e mostrado como qualquer snapshot, com uma faixa sobre a página que diz
  "Este é um ZIP salvo por PageKeep … O arquivo original não é alterado."
- **Detalhes** na faixa lista o que a conversão teve de remover para deixar a página segura (scripts e referências que carregariam da internet) e o que o ZIP não registrou
  (o tamanho da janela e a densidade de pixels: presume-se 1280 × 800 e 1).
- **Salvar como .wsnp…** (o botão, ou **Arquivo ▸ Salvar como .wsnp…**) grava o arquivo convertido onde você escolher, depois que ele passa pelas mesmas verificações de qualquer `.wsnp`. O ZIP nunca é alterado.
- Um ZIP que não é do PageKeep, ou cujo `snapshot.json` não pode ser usado, é recusado em palavras.

Um arquivo que não pode ser aberto diz por quê, em palavras: por exemplo "feito por uma versão mais nova do formato", "protegido por senha, e esta versão ainda não
abre arquivos protegidos" ou "contém um aplicativo que este visualizador ainda não consegue executar". Um erro fica na tela até você dispensá-lo; uma informação some sozinha.

## A janela

![A janela: barra de título, barra de atividades, barra lateral, abas, editor e barra de status](images/workbench-dark.png)

Ela é organizada como o Visual Studio Code: uma **barra de título** com o menu, uma **barra de atividades**, uma **barra lateral**, as **abas** com o caminho (breadcrumbs) embaixo,
a página ou o arquivo no meio e uma **barra de status**. `Ctrl+B` oculta e mostra a barra lateral. Arraste a borda da barra lateral para redimensioná-la; o tamanho é lembrado.
(As imagens mostram a interface em inglês.)

### A barra de título

- As **setas** são **Voltar** e **Avançar**: percorrem as abas que você visitou, como num navegador (`Alt+Esquerda`, `Alt+Direita`; no macOS `⌃-` e `⌃⇧-`). Ficam desligadas quando não há para onde ir.
- A **caixa do meio** abre **Ir para Arquivo** (`Ctrl+E`): digite parte de um nome para abrir um arquivo de qualquer snapshot aberto (sem digitar nada, ela lista as suas abas, a usada há menos tempo primeiro).
  Digite `>` (ou aperte `Ctrl+Shift+P`) para a **paleta de comandos**: todo comando dos menus que pode ser executado agora, e os temas de cores.
- O menu fica à esquerda dela (Arquivo, Editar, Exibir, Ir, Ajuda); o botão da barra lateral fica à direita.

![Ir para Arquivo: parte de um nome encontra um arquivo dos snapshots abertos](images/quick-open.png)

### O endereço de um link

Deixe o ponteiro sobre um link de uma página e o endereço dele aparece ao lado, como uma dica: o endereço da web, o caminho de um arquivo do snapshot, ou `#fragmento` para um link dentro da própria página. Nada é aberto até você clicar.

### Zoom

O zoom é da **aba**, nunca do aplicativo inteiro (a interface, os menus e as outras abas ficam como estão):

- **A página de um snapshot** amplia como a página de um navegador (25 % a 500 %): o texto cresce e o layout é refeito para o espaço menor. Use `Ctrl+=`, `Ctrl+-` e `Ctrl+0` (`⌘` no macOS), ou `Ctrl` e a roda, também com o ponteiro ou o foco do teclado dentro da página.
- **Um arquivo de texto** é desenhado no zoom da aba, do mesmo modo.
- **Uma imagem ou um PDF** guardam o seu próprio zoom, com barra de ferramentas e modos de ajuste; as mesmas teclas o ajustam (`Ctrl+0` o ajusta de novo à janela) e a roda amplia em torno do ponteiro.
- Para uma página ou um texto, a **barra de status** tem controles de zoom à direita: **−**, o valor (clique nele para voltar a 100 %) e **+**. Eles mexem no mesmo zoom das teclas e da roda, e mostram o valor quando elas o mudam. Uma aba fechada esquece o zoom.
- Ampliar, Reduzir e Redefinir Zoom estão na paleta de comandos (`Ctrl+Shift+P`), não no menu Exibir.

### Abas

- Cada snapshot abre numa aba. Um clique num arquivo da barra lateral abre uma **aba de prévia** (o nome em itálico) que o próximo clique substitui; um duplo clique
  (ou Enter) a **mantém**.
- Feche com o × da aba, um clique com o botão do meio ou `Ctrl+W`. **Arraste** uma aba para movê-la. O menu de contexto da aba tem Fechar, Fechar Outros, Fechar à Direita,
  Fechar Todos, Fixar, **Mostrar Metadados**, Copiar Endereço de Origem (ou Copiar Caminho) e Mostrar no Gerenciador de Arquivos.
- `Ctrl+Tab` percorre as abas na ordem em que você as usou; `Alt+1…9` vai para a enésima aba (`⌘1…9` no macOS).
- Um snapshot mantém o estado (rolagem, um carrossel no item 3) enquanto você olha outra aba.

### A barra lateral

- **Snapshots Abertos**: os snapshots que estão abertos.
- **Arquivos**: os arquivos do snapshot selecionado em árvore. As setas se movem, digitar pula para um nome, Enter mantém um arquivo aberto, e o menu de contexto tem
  **Abrir**, **Abrir com…** e **Salvar Como…** para todo arquivo. **Abrir com…** pergunta ao seu sistema qual aplicativo deve abrir o arquivo (a janela "Abrir com" do Windows, o seletor do macOS,
  e no Linux uma janela do próprio visualizador, desenhada como a da área de trabalho, com os aplicativos registrados para o tipo do arquivo primeiro, depois todos os outros, uma caixa de busca e **Sempre usar para este tipo de arquivo**, que torna a escolha o padrão da área de trabalho; o seletor da própria área de trabalho abre atrás da janela de um programa no Wayland, e por isso o visualizador o desenha; onde o sistema não tem como escolher (sem `gio`), o aplicativo padrão é usado e o visualizador avisa). O aplicativo recebe uma **cópia somente leitura** na sua pasta temporária,
  removida quando o visualizador fecha. Um tipo de arquivo que pode ser executado como programa (`.exe`, `.bat`, `.sh`, `.desktop`, `.jar`…) nunca é entregue: use **Salvar Como…**.
- **Informações**: de onde a página veio, quando e com quê. **Mostrar todos os metadados…** abre a visão completa.
- **Integridade**: o resultado da verificação de cada arquivo.

## O que uma aba pode mostrar

| Arquivo | O que você vê |
| --- | --- |
| O próprio snapshot | A página, como era, com os scripts do formato funcionando (carrosséis, abas, menus). |
| HTML, CSS, JavaScript, TypeScript, JSON, XML, Markdown, YAML, texto, SVG, e código-fonte em Python, C, C++, C#, Java, Kotlin, Scala, Go, Rust, Swift, Dart, PHP, Ruby, Perl, Lua, R, Groovy, Haskell, Julia, Clojure, Erlang, Pascal (`.pas`, `.pp`, `.dpr`, `.lpr`, `.inc`), shell (`.sh`, `.bash`, `.zsh`), PowerShell, SQL, TOML, INI e `.env`, Dockerfile, CMake, Diff, Protocol Buffers, SCSS, Sass, Less | Código com cores e numeração de linhas, somente leitura. Um arquivo HTML, CSS, JavaScript, JSON ou XML minificado ou numa só linha aparece **organizado** (indentado, um membro por linha): o botão **Formatar** da barra mostra como foi salvo, e Salvar Como grava sempre o arquivo como foi salvo. **Quebra de Linha** quebra as linhas longas (`Alt+Z`). As duas escolhas valem para todos os arquivos, ficam guardadas e também estão em Configurações. Um arquivo com mais de 2 MB aparece como foi salvo. |
| Imagens | A imagem com uma **barra de ferramentas**: reduzir e ampliar, uma caixa (Ajustar, Ajustar à Largura, Ajustar à Página, 25 % a 400 % e mais), tamanho real (1:1), **Salvar Como…**. `Ctrl` e a roda ampliam em torno do ponteiro, `+` `-` `0` ampliam pelo teclado, e uma imagem ampliada pode ser arrastada. O zoom fica com a aba. |
| PDFs | As páginas, uma após a outra, com texto selecionável, e uma **barra de ferramentas**: o mesmo zoom, página anterior e próxima, uma caixa para ir a uma página, **Salvar Como…**. Ainda não: links e formulários dentro do PDF, e senha de um PDF protegido (ele avisa, e pode ser salvo). |
| Fontes | Uma amostra em vários tamanhos. |
| SVG | Uma **imagem** no começo, com a barra de zoom; os botões **Imagem / Código** no início da barra alternam para o código-fonte (colorido como XML, com Localizar, Quebra de Linha e o zoom da aba) e de volta. A escolha vale para todos os SVG. |
| Um arquivo de texto na linguagem errada | A barra de status mostra a linguagem do arquivo na tela (ao lado do idioma da interface). Clique nela para **Selecionar Modo de Linguagem**: uma lista de todas as linguagens que o visualizador sabe colorir, para escolher a certa para aquele arquivo (**Detectar Automaticamente** volta ao que o visualizador escolheu). A escolha vale enquanto a janela estiver aberta e nunca altera o arquivo. |
| Markdown (`.md`) | Uma **página formatada** no começo (títulos, listas, tabelas, código; um link da web abre no navegador; uma imagem não é carregada, aparece a descrição dela, e o HTML escrito dentro aparece como texto); os botões **Formatado / Texto** no início da barra alternam para o texto (com cores, Localizar e Quebra de Linha) e de volta. A escolha vale para todos os arquivos Markdown. **Largura Total** deixa a página tão larga quanto a janela (sem barra de rolagem num bloco de código largo) e **Quebrar Código** quebra as linhas longas de código; as duas escolhas ficam guardadas. |
| Um arquivo de tipo que o visualizador não conhece (`.py`, `.sh`, `.toml`, `LICENSE`, uma entrada de ZIP com extensão incomum) | Aparece como texto quando o conteúdo é texto; senão é oferecido com Salvar Como. |
| Arquivos ZIP | A **lista de arquivos** do ZIP, com tamanhos e datas: veja "Arquivos ZIP" abaixo. |
| Qualquer outra coisa (um documento, áudio, vídeo, um arquivo grande demais) | Uma página com o nome, o tipo e o tamanho, e **Salvar Como…**. |

Um clique num link **dentro de uma página**: um link `#seção` rola na página; um link para um arquivo salvo no snapshot abre uma aba (uma imagem, um PDF, código) ou oferece
**Salvar Como…** (um documento ou um vídeo); um ZIP abre como uma lista; um link para a web abre o seu **navegador padrão**, só quando você clica, e nunca dentro da página.

### Arquivos ZIP

![Um ZIP dentro de um snapshot: seus arquivos, dois selecionados, e o menu de contexto](images/zip-viewer.png)

Um ZIP guardado num snapshot abre como uma **lista dos seus arquivos**: nome, tamanho, tamanho compactado e data. Nada é gravado no disco até você extrair.

- **Selecione** como num gerenciador de arquivos: clique, `Ctrl`+clique, `Shift`+clique, as caixas, a caixa do cabeçalho para todos, `Ctrl+A`, e as setas e `Espaço` pelo teclado.
- **Extrair Selecionados…** grava a seleção numa pasta que você escolhe (as pastas do ZIP são mantidas). Um só arquivo pede um nome de arquivo, como o Salvar Como.
  **Extrair Tudo…** grava tudo. Um arquivo que já existe nunca é sobrescrito: o novo se chama `nome (2)`.
- **Exibir** (duplo clique, `Enter` ou o menu de contexto) abre uma entrada numa aba própria: texto como código, uma imagem, um PDF, e um ZIP dentro do ZIP como uma lista de novo.
  O **Salvar Como…** da aba salva essa entrada.
- O clique direito numa linha abre um menu com **Exibir** e **Extrair…** (para várias linhas, **Extrair N Selecionados…**).
- O visualizador não grava um nome que poderia sair da pasta escolhida (`../x`, um caminho absoluto), não segue atalhos e não abre uma entrada protegida por senha:
  elas aparecem esmaecidas, com o motivo ao apontar, e são puladas (e contadas) na extração. Um ZIP com mais de 256 MB só é oferecido com Salvar Como.

## Localizar, copiar, imprimir e salvar como PDF

![Localizar na lista de um ZIP: as ocorrências são marcadas, e a caixa diz qual de quantas](images/find.png)

- **Localizar** (`Ctrl+F`, **Editar ▸ Localizar**) funciona em toda aba que tem texto: a página do snapshot, um arquivo de código (em todo o texto, não só nas linhas à vista), um PDF (em todas as páginas),
  a lista de um ZIP, os metadados e as Configurações. A caixa diz qual ocorrência de quantas; `Enter` e `Shift+Enter` (ou as setas) vão à próxima e à anterior, **Aa** diferencia maiúsculas,
  `Esc` fecha. Cada aba tem a sua busca: a caixa fecha quando você muda de aba. Uma imagem não tem texto, então Localizar fica desligado nela.
- **Copiar** (**Editar ▸ Copiar**, ou `Ctrl+C`) copia o que está selecionado na página, num arquivo de código, num PDF, ou nas listas e textos do próprio visualizador. O texto de todos eles pode ser selecionado com o mouse.
- **Imprimir** (**Arquivo ▸ Imprimir…**, `Ctrl+P`, ou o ícone da impressora na barra de atividades) imprime a página do snapshot como foi salva, um arquivo HTML do snapshot como a página que ele é, qualquer outro texto
  como a aba o mostra (organizado ou como foi salvo), ou uma imagem, com a janela de impressão do sistema. A lista de um ZIP, um PDF e os metadados ainda não podem ser impressos.
- **Salvar como PDF…** (**Arquivo ▸ Salvar como PDF…**) grava a mesma coisa como PDF, com o nome do título da página ou do arquivo, onde você escolher.
- Um **clique direito** na página de um snapshot abre um menu com **Selecionar Tudo**, **Copiar**, **Imprimir…** e **Salvar como PDF…**; num arquivo de texto, com **Selecionar Tudo** e **Copiar**.
- **Abrir Arquivo** também é um ícone da barra de atividades, acima da impressora.

## Conferindo um arquivo

O visualizador confere um arquivo quando o abre, e de novo em segundo plano:

1. **Estrutura**: o ZIP, a entrada de identificação, o manifesto, os nomes das entradas e se todo arquivo está listado.
2. **Conteúdo**: o SHA-256 e o tamanho de cada arquivo contra o manifesto (a barra de status mostra *Verificando…* e depois *Intacto*).
3. **Assinatura**: se o manifesto é assinado, e se ainda é o que foi assinado.

![A aba de metadados: o que o manifesto diz e o que foi conferido](images/metadata.png)

### Um snapshot que não é válido

Um `.wsnp` é um ZIP, então qualquer pessoa pode descompactá-lo, mudar um arquivo ou o manifesto e compactá-lo de novo. Se um arquivo não é o que o manifesto diz, ou um manifesto
assinado foi editado, o snapshot **não é válido**: a página dele não é exibida. Você vê quais arquivos e escolhe **Mostrar Mesmo Assim**, **Fechar Snapshot** ou **Mostrar Metadados**.
A barra de status diz *Inválido*.

### Assinaturas

O PageKeep assina todo `.wsnp` que grava, com uma chave que fica no seu navegador. O visualizador mostra o **assinante** como uma impressão digital (`5647-5AA7-…`):

- **Sem assinatura**: arquivos gravados antes de o PageKeep começar a assinar. Eles abrem, e o visualizador diz discretamente que os metadados deles não são protegidos: alguém poderia tê-los editado.
- **Assinado por uma chave que este visualizador ainda não conhece**: a assinatura é boa (o manifesto não foi editado depois de assinado), mas qualquer pessoa pode criar uma chave. Se você sabe que
  é a sua (a Ajuda do PageKeep mostra a impressão digital da sua), escolha **Confiar neste assinante** em **Mostrar Metadados** e, se quiser, dê um nome a ela.
- **Assinado por** um nome que você deu: uma chave em que você confia. **Deixar de confiar** desfaz.

O desenho está em [`MANIFEST-SIGNING.md`](MANIFEST-SIGNING.md) (em inglês).

## Atalhos

| Ação | Windows, Linux | macOS |
| --- | --- | --- |
| Abrir Arquivo | `Ctrl+O` | `⌘O` |
| Fechar a aba | `Ctrl+W` | `⌘W` |
| Próxima / anterior aba | `Ctrl+PageDown` / `Ctrl+PageUp` | `⌘PageDown` / `⌘PageUp` |
| Pelas abas, a usada há menos tempo primeiro | `Ctrl+Tab`, `Ctrl+Shift+Tab` | `⌃Tab`, `⌃⇧Tab` |
| Ir para a aba 1…9 | `Alt+1…9` | `⌘1…9` |
| Ocultar / mostrar a barra lateral | `Ctrl+B` | `⌘B` |
| Configurações | `Ctrl+,` | `⌘,` |
| Zoom da aba: ampliar / reduzir / redefinir (a página, um texto; uma imagem ou um PDF ajusta o seu) | `Ctrl+=` / `Ctrl+-` / `Ctrl+0`, ou `Ctrl` + roda | `⌘=` / `⌘-` / `⌘0`, ou `⌘` + roda |
| Quebra de Linha numa aba de código | `Alt+Z` | `⌥Z` |
| Voltar / Avançar | `Alt+Esquerda` / `Alt+Direita` | `⌃-` / `⌃⇧-` |
| Ir para Arquivo | `Ctrl+E` | `⌘E` |
| Paleta de comandos | `Ctrl+Shift+P` | `⇧⌘P` |
| Localizar na aba | `Ctrl+F` | `⌘F` |
| Copiar | `Ctrl+C` | `⌘C` |
| Imprimir | `Ctrl+P` | `⌘P` |
| Zoom de uma imagem ou de um PDF em torno do ponteiro | `Ctrl` + roda, ou `+` `-` `0` com o visualizador em foco | o mesmo |

Os atalhos funcionam onde estiver o foco, também dentro de uma página.

## Configurações

**Configurações** (a engrenagem no fim da barra de atividades, Arquivo › Configurações ou `Ctrl+,`) abre numa aba, com uma caixa que as filtra:

- **Tema de Cores**: Dark+, Light+ ou Automático, que segue o sistema operacional.
- **Idioma de Exibição**: inglês, português do Brasil ou automático (o do sistema). A mudança é imediata.

As configurações ficam no seu computador, na pasta do próprio aplicativo, e em nenhum outro lugar. Veja [`../PRIVACY.md`](../PRIVACY.md) (em inglês).

## Ajuda e Sobre

**Ajuda › Sobre o Folder Browser** mostra a versão, em que ele roda, a licença e os avisos das bibliotecas que há dentro dele, e copia as informações da versão para um relato de problema.
Relate um problema em <https://github.com/asantos43/folder-browser/issues>, **sem anexar um snapshot privado**; uma vulnerabilidade segue o que diz [`../SECURITY.md`](../SECURITY.md).

## O que ainda não existe

Ler um ZIP simples salvo pelo PageKeep e convertê-lo, exportar para PNG, JPG e PDF, busca em todos os snapshots abertos, proteção por senha e `.wsnpx` vêm em fases posteriores
([`ARCHITECTURE.md`](ARCHITECTURE.md), "Phases").
