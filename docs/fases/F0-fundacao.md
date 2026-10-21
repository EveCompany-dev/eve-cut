# F0 — Fundação e provas técnicas

**Meta:** repositório funcionando, painel abrindo no Premiere, ponte testada, e as perguntas técnicas
respondidas com fatos antes de construir a v1.

**Pré-requisito:** Premiere 2026 funcionando no PC do José (da F0-03 em diante).

---

## [x] F0-01 Esqueleto do monorepo

**Objetivo:** base de código com lint, testes, build e CI.

**Arquivos:** `package.json` (raiz, com os scripts do AGENTS.md), `pnpm-workspace.yaml`,
`tsconfig.base.json`, `eslint.config.mjs`, `vitest.config.ts`, `.editorconfig`, `.gitignore`,
`packages/core/{package.json,tsconfig.json,src/index.ts,test/smoke.test.ts}`,
`packages/panel/package.json`, `packages/mcp-server/package.json`, `.github/workflows/ci.yml`.

**Passos:**
1. pnpm workspaces com `packages/*`. TypeScript `strict`, `target` ES2022, `module` NodeNext em
   `core` e `mcp-server`.
2. vitest na raiz, rodando os testes de todos os pacotes.
3. eslint com `typescript-eslint` (config plana). `pnpm lint` = eslint + `tsc --noEmit` em cada pacote.
4. CI no GitHub Actions: `ubuntu-latest`, Node 24, pnpm; passos `install --frozen-lockfile`, `lint`,
   `test`.
5. Os scripts `dev:panel`, `mcp:register` e `build` existem mas podem só imprimir "a implementar"
   até a tarefa que os cria.

**Aceite:** `pnpm install && pnpm lint && pnpm test` passam no PC e no CI.

**Fora:** qualquer lógica do produto.

---

## [x] F0-02 `core/srt` (porte do protótipo)

**Objetivo:** ler e montar `.srt` com as mesmas garantias do protótipo, em TypeScript.

**Arquivos:** `packages/core/src/srt/{types.ts,parse.ts,build.ts,decode.ts,time.ts,index.ts}`,
`packages/core/test/srt.test.ts`, `fixtures/srt/premiere-exemplo.srt` (sintético, com sufixo de
posição em alguns blocos).

**Passos:**
1. Porte `legacy/subtitle-fixer-panel/js/srt.js` mantendo o comportamento: BOM, CRLF/LF/CR, linha de
   tempo guardada byte a byte, número sintetizado quando falta, pedaços sem tempo descartados.
2. Tipos: `SrtBlock { index: number; num: string; timing: string; text: string }`.
3. `decode(buf: Uint8Array): string`: UTF-8 (com `fatal: true`); se falhar, `windows-1252`.
4. `time.ts`: `parseTiming(timing) → { startMs, endMs }` para `HH:MM:SS,mmm --> HH:MM:SS,mmm`,
   ignorando o sufixo de posição; `formatMs(ms) → "HH:MM:SS,mmm"`.
5. `build(blocks)`: CRLF, linha em branco depois de cada bloco, igual ao protótipo.

**Aceite:**
- Todos os casos da seção "SRT.parse / SRT.build" de `legacy/subtitle-fixer-panel/test/harness.js`
  convertidos para vitest e passando.
- Ida e volta (`build(parse(x))`) byte a byte idêntica para `fixtures/srt/premiere-exemplo.srt`.
- Testes de `parseTiming`, `formatMs` e `decode` (UTF-8 com BOM, windows-1252 com "ç" e "ã").

**Fora:** correção de texto.

---

## [x] F0-03 Painel CEP mínimo · Teste manual

> Teste manual concluído em 21/10/2026 no Premiere 26.5.2: o painel abre com as 4 abas, o rodapé
> mostra `Premiere 26.5.2 · EVE_5246` com a bolinha verde e o DevTools abre em
> `http://localhost:8088`.

**Objetivo:** o painel "eve-cut" abre no Premiere e conversa com o ExtendScript.

**Arquivos:** `packages/panel/CSXS/manifest.xml`, `packages/panel/index.html`,
`packages/panel/src/{main.ts,premiere/host.ts,premiere/adapter.ts,premiere/cep-adapter.ts}`,
`packages/panel/host/{index.jsx,json2.js}`, `packages/panel/css/style.css` (base: CSS do protótipo),
`packages/panel/.debug`, `packages/panel/build.mjs`, `scripts/dev-install-panel.ps1`,
`packages/panel/test/host.test.ts`.

**Passos:**
1. Manifest conforme `REFERENCIAS-API.md` §1 (id `com.eve.evecut.panel`, menu "eve-cut").
2. `index.html` com as 4 abas (Legendas, Limpeza desativada com "em breve", Clientes, ⚙) e o
   rodapé, todas vazias por enquanto.
3. `callHost` e `evePing` conforme `REFERENCIAS-API.md` §2. `PremiereAdapter` só com `status()` por
   enquanto.
4. Ao carregar, o painel chama `status()` e mostra no rodapé "Premiere 26.x · <sequência>".
5. `build.mjs` conforme §4. `pnpm dev:panel` = build + `scripts/dev-install-panel.ps1`, que copia
   `dist` para `%APPDATA%\Adobe\CEP\extensions\eve-cut` e grava `PlayerDebugMode=1` em `CSXS.9` a
   `CSXS.13`.

**Aceite automático:** teste de `callHost` com um `__adobe_cep__` falso: aspas, barras invertidas,
`\n`, U+2028 e acentos chegam intactos; JSON inválido do host vira erro legível.

**Teste manual (José):** fechar o Premiere → `pnpm dev:panel` → abrir o Premiere → Janela →
Extensões → eve-cut. O painel abre e o rodapé mostra a versão e a sequência ativa. DevTools abre em
`http://localhost:8088`.

**Fora:** ponte, correção.

---

## [x] F0-04 Ponte local

> Teste manual concluído em 21/10/2026 no Premiere 26.5.2: com o painel aberto, `bridge-ping`
> imprimiu `Premiere 26.5.2 · EVE_5246` e o status; com o painel fechado, avisou que não achou o
> `bridge.json` e saiu sem travar.

**Objetivo:** processos externos (mcp-server, scripts) chamam o painel com segurança.

**Arquivos:** `packages/core/src/bridge/{protocol.ts,client.ts,paths.ts}`,
`packages/panel/src/bridge/server.ts`, `scripts/bridge-ping.mjs`, `packages/core/test/bridge.test.ts`.

**Passos:**
1. Protocolo conforme SPEC §4.2: tipos JSON-RPC 2.0, `hello`, notificação `progress`, códigos de erro
   (-32601 método desconhecido, -32001 não autorizado, -32002 timeout).
2. Servidor (`ws`) no painel: `127.0.0.1`, porta 47615 ou outra livre, token, `bridge.json`, recusa
   upgrade com `Origin`, fecha sem `hello` em 2 s, registro de métodos (`register(name, handler)`).
   Registra `premiere.status`.
3. Cliente no `core`: lê `bridge.json`, conecta, faz `hello`, `call(method, params, { timeoutMs,
   onProgress })`, reconecta uma vez se o painel reiniciar (token novo).
4. `scripts/bridge-ping.mjs` chama `premiere.status` e imprime o resultado.

**Aceite automático** (servidor e cliente no Node, sem Premiere; o servidor é testável fora do CEP):
token errado → fechado; sem `hello` em 2 s → fechado; com `Origin` → recusado; chamada ok; timeout;
método desconhecido → -32601; `progress` chega ao `onProgress`.

**Teste manual (José):** com o Premiere e o painel abertos, `node scripts/bridge-ping.mjs` imprime a
versão e a sequência.

**Fora:** métodos além de `premiere.status`.

---

## [ ] F0-05 Laboratório e provas técnicas · código: agente · execução: José

> Código pronto em 20/10/2026: Lab oculto (Ctrl+Shift+L), `lab.jsx` com as provas, sonda P7 e roteiro
> em `docs/PROVAS.md`. O `[x]` só entra quando o José rodar as provas e preencher o arquivo.

**Objetivo:** responder com fatos o que a documentação não garante.

**Arquivos:** `packages/panel/host/lab.jsx`, aba oculta **Lab** no painel (abre com Ctrl+Shift+L),
`docs/PROVAS.md` (já existe, com o modelo a preencher).

**Passos:** para cada prova, um botão no Lab que chama uma função do `lab.jsx` (ou do Node, na P7) e
mostra o resultado bruto em JSON, com um campo para colar caminhos. O José roda e anota em
`docs/PROVAS.md`.

| prova | pergunta | como testar | se falhar |
|---|---|---|---|
| P1 | Dá para exportar as legendas da sequência para `.srt` por script? | (a) `exportAsMediaDirect` com `presets/eve-cut-legendas.epr` (preset de WAV com sidecar SubRip) e ver se o `.srt` sai ao lado; (b) `exportAsFinalCutProXML` e procurar o texto das legendas no XML. | pasta vigiada (SPEC §5.1) |
| P2 | `createCaptionTrack` cria a faixa com o `.srt` importado no tempo certo? Testar com sequência começando em 00:00:00:00 e em 01:00:00:00. | importar `fixtures/srt/premiere-exemplo.srt` e criar a faixa | instrução manual: arrastar o `.srt` para a timeline |
| P3 | Existe algum jeito de ler o texto das legendas que já estão na sequência? (esperado: não) | inspecionar faixas e itens, inclusive pela QE | – |
| P4 | Marcador com duração, nome, comentário e cor; ler de volta; apagar. Qual índice dá qual cor? | `createMarker`, `end`, `setColorByIndex(0..7)`, iteração | marcadores sem cor, tipo só no nome |
| P5 | Exportar o áudio da sequência em WAV por script. Quanto tempo leva para 60 s de vídeo? | `exportAsMediaDirect` com `presets/eve-cut-audio.epr` | ler o arquivo de mídia do clipe de V1 (exigiria decodificar) |
| P6 | Cortar trechos com ripple: (A) `clone` + `razor` da QE + `remove(true, true)`; (B) FCP XML editado e importado como sequência nova. Qual funciona com 20 cortes num clipe? | rodar as duas com os mesmos 20 trechos e comparar | – (uma das duas precisa funcionar) |
| P7 | `claude -p` chamado do Node do CEP: o painel acha o `claude.exe`? Formato da saída de sucesso com `--json-schema` (campo `structured_output`?). `--system-prompt-file` funciona sem `--bare`? Quanto tempo leva com 40 blocos? | botão que roda o runner com um lote de exemplo | `--system-prompt` inline |
| P8 | MOGRT: `importMGT` + mudar o texto + definir a duração | um `.mogrt` qualquer com texto editável | só legenda nativa na F3 |
| P9 | `.prtextstyle`: dá para importar no projeto e aplicar na faixa de legenda por script? | `importFiles` + inspecionar | instrução manual de 1 passo |

**Aceite:** `docs/PROVAS.md` preenchido (resultado, versão do Premiere, decisão de cada prova) e
`SPEC.md` / `REFERENCIAS-API.md` corrigidos onde a prova contradisse. Os presets `.epr` usados
estão em `presets/`.

**Fora:** usar os resultados em funcionalidades (isso é F1+).
