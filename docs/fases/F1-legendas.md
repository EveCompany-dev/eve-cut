# F1 — Correção de legendas (v1)

**Meta:** o José corrige as legendas de uma sequência com um clique (ou pela conversa), revisa
bloco a bloco e aplica, sem chave de API.

**Base:** SPEC §4.3, §5, §6, §10–§12. Leia antes de começar.

---

## [x] F1-01 Perfis de cliente

**Arquivos:** `packages/core/src/profile/{schema.ts,store.ts,migrate.ts,export.ts,index.ts}`,
`packages/core/test/profile.test.ts`.

**Passos:**
1. Schema v2 em zod (SPEC §6), com valores padrão para tudo que for opcional.
2. `migrate(json)`: aceita v1 (protótipo, sem `schema_version`) e v2; v1 vira v2 com `match: "exata"`
   e `source: "manual"` nos termos.
3. `store`: `list()`, `load(slug)`, `save(profile)` (grava num arquivo temporário e renomeia, para
   não corromper), `slugify(name)` (porte do protótipo). A pasta é injetada (padrão
   `%APPDATA%\eve-cut\profiles`), para os testes usarem uma pasta temporária.
4. Semente na primeira execução: converte `legacy/subtitle-fixer-panel/profiles/*.json`.
5. `export.ts`: `toJson(profile)` e `toMarkdown(profile, date)` no formato da SPEC §6.

**Aceite:** testes de migração (os dois JSON do protótipo), ida e volta load/save, JSON inválido
listado como "(JSON inválido)" sem derrubar a lista, `toMarkdown` igual ao exemplo da SPEC para a 4S.

---

## [ ] F1-02 Glossário exato

**Arquivos:** `packages/core/src/glossary/{apply.ts,index.ts}`, `packages/core/test/glossary.test.ts`.

**Passos:** `applyGlossary(blocks, profile) → { blocks, changes }` conforme SPEC §5.2.

**Aceite (testes):**
- "fazemos estampa em de teif" → "fazemos estampa em DTF"; "Dtf" → "DTF".
- Não troca dentro de palavra ("dtfx" fica igual).
- Termo com acento e com "ç" funciona; borda de palavra com Unicode (`\p{L}`).
- Ocorrência atravessando `\n` não é trocada.
- Termo protegido nunca é alterado, mesmo que um `wrong` caia dentro dele.
- Termos `fonetica` são ignorados aqui.
- Cada troca gera `{ index, before, after, kind: "glossario", source: "regra" }`.

---

## [ ] F1-03 Lotes com contexto

**Arquivos:** `packages/core/src/batch/{batch.ts,index.ts}`, `packages/core/test/batch.test.ts`.

**Passos:** `makeBatches(blocks, size = 40, context = 3) → Batch[]`, em que cada lote tem
`items: { index, text, editable }[]` e os blocos de contexto antes e depois vêm com
`editable: false`. O primeiro e o último lote têm contexto só de um lado.

**Aceite:** 46 blocos / 40 → 2 lotes; os editáveis cobrem todos os blocos exatamente uma vez; o
contexto nunca é editável; os lotes nunca carregam a linha de tempo.

---

## [ ] F1-04 Prompt

**Arquivos:** `packages/core/src/prompt/{rules.ts,build.ts,schema.ts,index.ts}`,
`packages/core/test/prompt.test.ts`.

**Passos:**
1. `rules.ts`: porte do `RULES` de `legacy/subtitle-fixer-panel/js/claude.js` com as mudanças da
   SPEC §5.4.
2. `buildSystemPrompt(profile)`: regras + glossário (todos os termos) + protegidos + tom + exemplos,
   como no protótipo.
3. `buildUserPrompt(batch)`: "Revise estes blocos…" + JSON de `items`.
4. `schema.ts`: o JSON Schema da resposta (SPEC §5.4).

**Aceite:** snapshot do system prompt da 4S; o prompt contém todos os termos, protegidos e notas; o
prompt sem perfil não quebra; o user prompt não contém `-->`.

---

## [ ] F1-05 Runner do `claude -p`

**Arquivos:** `packages/core/src/claude/{runner.ts,locate.ts,errors.ts,index.ts}`,
`packages/core/test/runner.test.ts`, `packages/core/test/fake-claude/fake-claude.mjs`.

**Passos:**
1. `runClaude(opts)` conforme SPEC §4.3 e `REFERENCIAS-API.md` §6. O executável é injetável, para os
   testes.
2. `locateClaude()`: configuração → `where.exe claude` → derivar `claude.exe` do `claude.cmd`.
3. `errors.ts`: mapear a saída para `not_found | auth | limit | timeout | invalid | failed`, com as
   mensagens da SPEC §12. Use o JSON real de limite de `REFERENCIAS-API.md` §6 como fixture.
4. Fila com no máximo 2 execuções ao mesmo tempo.
5. `fake-claude.mjs`: um script Node que lê os argumentos e o stdin e devolve uma fixture escolhida
   por variável de ambiente (sucesso, limite, JSON inválido, demora, exit 1 sem JSON). Nos testes,
   o runner chama `node fake-claude.mjs` no lugar do `claude.exe`.

**Aceite (testes com o fake):** sucesso com `structured_output`; sucesso só com `result` em JSON;
limite → `limit` com o texto "resets…"; JSON fora do schema → uma nova tentativa e depois `invalid`;
timeout → `timeout` e o processo é encerrado; executável inexistente → `not_found`; os argumentos
incluem `--safe-mode` e `--tools` seguido de string vazia.

**Teste manual (José):** botão "Testar Claude" em ⚙ (feito na F1-08) mostra sucesso ou o limite.

---

## [ ] F1-06 Validação das correções

**Arquivos:** `packages/core/src/validate/{validate.ts,distance.ts,index.ts}`,
`packages/core/test/validate.test.ts`.

**Passos:** `validateChanges(batch, changes, profile) → ReviewedChange[]` com as 7 regras da SPEC
§5.5. Cada mudança sai com `status: "pendente" | "rejeitada_auto"` e `reason`.

**Aceite:** um teste por regra (passa e falha), índice duplicado, índice de contexto, termo protegido
removido, linha a mais, reescrita (distância > 0,6).

---

## [ ] F1-07 Orquestração da correção

**Arquivos:** `packages/core/src/correct/{correct.ts,diff.ts,index.ts}`,
`packages/core/test/correct.test.ts`.

**Passos:**
1. `correctCaptions(blocks, profile, { runner, batchSize, onProgress, signal })`: glossário exato →
   lotes → runner (em paralelo, limitado pela fila) → validação → junta tudo num `CaptionJob`.
2. Modo só-glossário: `runner: null` faz só o passo 1.
3. Cancelamento por `AbortSignal`: interrompe os lotes que faltam; o que já voltou é mantido.
4. `diff.ts`: diff por palavra (LCS sobre tokens) para a interface: `{ op: "igual" | "removido" | "inserido", text }[]`.
5. Tipos `CaptionJob`, `ReviewedChange` e o estado de revisão de cada mudança
   (`pendente | aceita | recusada | editada`).

**Aceite (testes com runner falso):** lote que falha não perde os outros (o job registra o erro do
lote); bloco omitido fica com o original; mudanças da regra e do Claude no mesmo bloco se combinam
(a do Claude parte do texto já com o glossário); progresso chamado por lote; cancelamento.

---

## [ ] F1-08 Aba Legendas: entrada e progresso · Teste manual

**Arquivos:** `packages/panel/src/ui/captions/*`, `packages/panel/src/jobs/store.ts`,
`packages/panel/host/captions.jsx`, aba ⚙ (Claude: caminho, modelo, lote, "Testar Claude").

**Passos:**
1. Seletor de cliente (lembra o último).
2. Botão "Corrigir legendas da sequência": `adapter.exportCaptionsSrt()` com o método da P1; se a P1
   falhou, a pasta vigiada (SPEC §5.1). Arrastar e escolher arquivo sempre funcionam.
3. Progresso por lote, botão Cancelar.
4. Erros com as mensagens da SPEC §12. Para `limit`, o botão "Corrigir só com o glossário".
5. O job é gravado em `%APPDATA%\eve-cut\jobs\<jobId>.json` e restaurado ao reabrir (hash do `.srt`).

**Teste manual (José):** sequência com legendas → Corrigir → o progresso anda e a revisão aparece;
fechar e abrir o painel → a revisão volta; Claude sem limite → mensagem certa e a opção do glossário.

---

## [ ] F1-09 Revisão (diff) · Teste manual

**Arquivos:** `packages/panel/src/ui/review/*`.

**Passos:** SPEC §5.6 inteira: lista, diff por palavra, aceitar/recusar/editar, ações em lote,
filtros, rejeitadas recolhidas, clicar no tempo move o cursor (`adapter.setPlayhead`), rodapé com
contagens, botão Aplicar.

**Aceite automático:** a lógica de estado da revisão (funções puras do `core`: aceitar, recusar,
editar, aceitar todas, aceitar só glossário, contagens) com testes.

**Teste manual (José):** revisar um job real de ponta a ponta usando teclado e mouse; o painel
estreito (300 px) continua legível.

---

## [ ] F1-10 Aprender glossário

**Arquivos:** `packages/core/src/glossary/learn.ts`, `packages/core/test/learn.test.ts`,
`packages/panel/src/ui/review/suggestions.ts`.

**Passos:** SPEC §5.7. Função pura
`suggestTerms(job, profile) → { wrong, correct, count, reason }[]`, mais a interface do chip.
"Adicionar" grava no perfil; "Nunca sugerir" grava em `ignored_suggestions`.

**Aceite (testes):** edição "de teif" → "DTF" gera a sugestão; um par repetido 2 vezes vem com
`count: 2`; um par já no glossário ou ignorado não é sugerido; palavra comum ("de", "que") gera
`match: "fonetica"`.

---

## [ ] F1-11 Aplicar · Teste manual

**Arquivos:** `packages/panel/src/jobs/apply.ts`, `packages/panel/host/captions.jsx`,
`packages/core/src/srt/naming.ts` (+ teste).

**Passos:** SPEC §5.8: montar o `.srt` (só as aceitas e editadas), nome sem sobrescrever
(`naming.ts`, testado), importar na bin `eve-cut/Legendas`, `createCaptionTrack` com o ponto zero
da P2, mensagem final e `history.jsonl`.

**Aceite automático:** `naming.ts` gera `_eve-cut`, `_eve-cut-2`… sem sobrescrever; o `.srt` montado
tem os tempos idênticos aos do original (byte a byte nas linhas de tempo).

**Teste manual (José):** aplicar → a nova faixa aparece alinhada com a fala; a faixa antiga continua
lá; o arquivo original não mudou.

---

## [ ] F1-12 Aba Clientes

**Arquivos:** `packages/panel/src/ui/clients/*`.

**Passos:** editor de perfil (porte do formulário do protótipo + termos com `match` e `source`),
"+ Novo" sem `prompt()`, importar JSON (v1 ou v2), exportar `.json` + `.md` (escolha da pasta),
abrir a pasta dos perfis.

**Teste manual (José):** criar um cliente, adicionar termos, exportar e conferir o `.md`, importar
o JSON do protótipo.

---

## [ ] F1-13 Servidor MCP (modo conversa)

**Arquivos:** `packages/mcp-server/src/{index.ts,tools/*.ts,prompts.ts}`,
`packages/panel/src/bridge/methods/{jobs.ts,profiles.ts,ui.ts}`, `packages/mcp-server/test/*.test.ts`,
`scripts/mcp-register.ps1`.

**Passos:**
1. Ferramentas da SPEC §5.9 e o prompt `corrigir_legendas` (mesmas regras do F1-04).
2. Métodos da ponte do lado do painel: `jobs.start`, `jobs.blocks`, `jobs.propose`, `jobs.review`,
   `jobs.apply`, `profiles.list`, `profiles.get`, `profiles.addTerms`, `ui.confirm`, `premiere.jump`.
3. `propose_caption_changes` passa pela mesma validação do F1-06 e aparece na revisão do painel.
4. `apply_caption_job` e `add_glossary_terms` só seguem depois do `ui.confirm` no painel.
5. Painel fechado → erro claro: "O painel eve-cut não está aberto no Premiere."
6. `pnpm mcp:register`: build + `claude mcp add --scope user eve-cut -- node "<dist>\index.js"`.

**Aceite automático:** cada ferramenta testada com uma ponte falsa (sem Premiere); o stdout só tem
o protocolo MCP.

**Teste manual (José):** numa conversa no Claude Code: "corrige as legendas da sequência ativa com o
perfil da 4S". O Claude usa as ferramentas, as mudanças aparecem no painel, e o Aplicar pede
confirmação no painel.

---

## [ ] F1-14 Instalador e documentação de uso · Teste manual

**Arquivos:** `scripts/install.ps1`, `README.md` (seções Instalação e Uso).

**Passos:** SPEC §13. O instalador é idempotente (rodar duas vezes não quebra) e avisa se o Premiere
estiver aberto.

**Teste manual (José):** instalar do zero num perfil limpo de `%APPDATA%\eve-cut`, corrigir uma
sequência real de ponta a ponta pelo botão e pela conversa.
