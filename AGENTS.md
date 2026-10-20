# AGENTS.md — como trabalhar no eve-cut

Leia este arquivo inteiro antes de qualquer tarefa. Depois leia `docs/SPEC.md` e o arquivo da fase
em que você está, em `docs/fases/`.

## O que é

O eve-cut é um painel para o Adobe Premiere Pro usado por **uma pessoa só, o José**, num único PC
(Windows 11, Premiere Pro 2026, Node 24, Claude Code instalado e logado na assinatura). Ele:

1. corrige o texto das legendas geradas pelo Speech-to-Text do Premiere com o glossário e o tom de
   cada cliente (fase 1);
2. marca suspiros e silêncios na timeline e corta os marcados depois da confirmação (fase 2);
3. aplica os templates de cada cliente: MOGRT, estilo de legenda, regras de formato, presets (fase 3).

O "cérebro" é o Claude, mas **não existe chave de API**. O modelo é chamado de dois jeitos:
- pelo botão do painel, que roda o Claude Code em modo não interativo (`claude -p`);
- numa conversa no Claude Code, em que o próprio Claude chama as ferramentas MCP deste projeto.

## Como trabalhar

- Faça **uma tarefa por vez**, na ordem dos arquivos `docs/fases/F*.md`. Cada tarefa tem objetivo,
  arquivos, passos, critério de aceite, testes e o que fica fora.
- Não comece a próxima tarefa com teste falhando.
- Ao terminar uma tarefa: rode `pnpm lint && pnpm test`, marque o `[x]` dela no arquivo da fase e
  faça um commit com a mensagem `F1-03: <resumo do que mudou>`.
- Se a spec não bater com a realidade (API que não existe, nome diferente, limitação), **não
  invente**: registre em `docs/DECISOES.md`, seção "Desvios durante o desenvolvimento", e escolha a
  opção mais simples que mantenha as invariantes abaixo.
- Tarefas marcadas **(José)** ou com "Teste manual" dependem do Premiere aberto. Você escreve o
  código e o roteiro do teste; quem executa é o José. Não marque como cumprido um critério manual.
- Não implemente nada de fases futuras "de brinde".

## Invariantes (nunca violar)

1. **Corrigir texto nunca muda tempo.** A linha de tempo de cada bloco do `.srt` é preservada byte a
   byte, inclusive sufixos de posição como `X1:… Y1:…`. Só a ação explícita "dividir bloco" (fase 3)
   cria tempos novos, e sempre dentro do intervalo do bloco original.
2. **Nada é sobrescrito.** O `.srt` original nunca é sobrescrito: a saída ganha sufixo e, se já
   existir, numeração. Antes de qualquer corte, a sequência é duplicada como backup.
3. **Nada é aplicado sem confirmação no painel.** Correção de legenda só entra se aceita no diff.
   Corte só acontece depois do botão "Confirmar cortes", ou de um diálogo de confirmação no painel
   quando o pedido vem de uma conversa.
4. **Sem chave de API da Anthropic.** Nunca use `api.anthropic.com`, `ANTHROPIC_API_KEY` nem o SDK
   da Anthropic. Use o runner do `claude -p` (`packages/core/src/claude/`) ou as ferramentas MCP.
5. **Falha não perde dado.** Bloco que o modelo não devolver fica com o texto original. Resposta
   inválida não grava nada e mostra o motivo.
6. **A ponte local só aceita quem tem o token.** Servidor só em `127.0.0.1`, token aleatório gerado
   a cada abertura do painel, conexão sem token é fechada.

## Stack e estrutura

pnpm workspaces, TypeScript estrito, vitest, esbuild, eslint. Node 24 para desenvolvimento.

```
eve-cut/
  packages/
    core/          lógica pura (TS): srt, perfis, glossário, lotes, prompt, validação, diff,
                   runner do claude -p, ponte (cliente e protocolo), (F2) áudio, (F3) templates e Hub
    panel/         extensão CEP: index.html, src/*.ts (bundle esbuild), host/*.jsx (ExtendScript ES3),
                   CSXS/manifest.xml
    mcp-server/    servidor MCP (stdio) do modo conversa; fala com o painel pela ponte
  scripts/         instalação de desenvolvimento, registro do MCP, install.ps1
  presets/         .epr criados no Media Encoder pelo José
  fixtures/        .srt e áudios de teste
  legacy/          protótipo original (só referência: não editar, não importar)
  docs/
```

## Comandos (criados na F0-01)

| comando | faz |
|---|---|
| `pnpm install` | instala as dependências |
| `pnpm test` | vitest em todos os pacotes (não precisa do Premiere) |
| `pnpm lint` | eslint + `tsc --noEmit` |
| `pnpm build` | gera `packages/panel/dist` e `packages/mcp-server/dist` |
| `pnpm dev:panel` | build + copia o painel para `%APPDATA%\Adobe\CEP\extensions\eve-cut` e liga o PlayerDebugMode |
| `pnpm mcp:register` | registra o servidor MCP no Claude Code do usuário |

## Convenções

- Textos de interface em **pt-BR**. Código, nomes e comentários em **inglês**.
- Comentário explica o porquê, não o quê.
- Lógica em funções puras no `core` sempre que der. O painel e o MCP fazem I/O e chamam o `core`.
- Erro para o usuário: frase curta em pt-BR dizendo o que aconteceu e o que fazer (lista em
  `docs/SPEC.md` §12).
- Caminho vindo do Premiere é sempre Windows: use `path.win32` no `core`.
- `.srt` de fixture nunca passa por conversão de fim de linha (o `.gitattributes` marca `*.srt -text`):
  os testes de ida e volta comparam byte a byte.
- Dependência nova pesada (binário, modelo, lib nativa) só com registro em `docs/DECISOES.md`.

## Armadilhas conhecidas

**ExtendScript (`packages/panel/host/*.jsx`)**
- É **ES3**: sem `let`/`const`, arrow function, template string, `Array.prototype.map/filter/forEach/indexOf`
  e sem `JSON`. Inclua `json2.js` no host e use laços `for`.
- Toda função do host recebe **um** argumento (string JSON) e devolve string JSON
  `{"ok":true,"data":…}` ou `{"ok":false,"error":"…"}`. Nunca monte código concatenando caminhos de
  arquivo: o painel gera o argumento com `JSON.stringify` (ver `docs/REFERENCIAS-API.md` §2).
- Tempo: objetos `Time` têm `.seconds` e `.ticks` (string). 1 segundo = 254016000000 ticks.
- `qe` (a "QE DOM") **não é documentada**. Só use onde a prova técnica da F0-05 mostrou que funciona,
  sempre isolada numa função própria.
- Erro não tratado no host faz a chamada voltar vazia: envolva tudo em `try/catch` e sempre devolva JSON.

**CEP (`packages/panel`)**
- O Node fica disponível via `require` por causa de `--enable-nodejs` e `--mixed-context` no manifest.
  No esbuild, use `format: 'iife'` e marque os módulos nativos do Node como `external`.
- Nada de `alert`, `prompt` ou `confirm`: travam o painel. Diálogos são HTML dentro do painel.
- Extensão não assinada só carrega com `PlayerDebugMode=1` em `HKCU\Software\Adobe\CSXS.<versão>`.
- Depuração: arquivo `.debug` com a porta 8088 e `http://localhost:8088` no Chrome.

**Claude Code (`claude -p`)**
- No Windows, `claude` é um shim (`claude.cmd`) que chama
  `<pasta global do npm>\node_modules\@anthropic-ai\claude-code\bin\claude.exe`. Chame o `claude.exe`
  direto com `child_process.spawn` e lista de argumentos, **sem shell**. Com shell, argumentos vazios
  (`--tools ""`) somem.
- Na correção de legendas use sempre `--safe-mode` (não carrega CLAUDE.md, hooks, plugins nem MCPs
  do usuário) e `--tools ""` (sem ferramentas: só queremos o JSON de volta).
- A assinatura tem limite de uso. Quando acaba, o Claude Code devolve `is_error: true` com
  `api_error: "usage_limit_reached"` (exemplo real em `docs/REFERENCIAS-API.md` §6). Trate como erro
  próprio, com mensagem clara e a opção de corrigir só com o glossário.
