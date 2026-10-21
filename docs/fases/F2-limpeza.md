# F2 — Suspiros e silêncios (v2)

**Meta:** com a fala sozinha na timeline, a ferramenta marca os suspiros e os silêncios, o José
revisa os marcadores e, ao confirmar, todos os marcados são cortados, com backup da sequência.

**Base:** SPEC §7. **Pré-requisitos:** F0 inteira (principalmente P4, P5 e P6) e as gravações de
teste do José (F2-00).

---

## [ ] F2-00 Gravações de teste com gabarito · (José)

**O que fazer:** juntar de 3 a 5 trechos reais de fala (30 a 90 s cada, de clientes ou pessoas
diferentes), exportados em WAV com o mesmo preset da P5, e para cada um um CSV com os trechos
marcados à mão:

```csv
inicio_s,fim_s,tipo
3.420,3.780,suspiro
7.100,8.050,silencio
```

Salvar em `fixtures/audio/<nome>.wav` e `fixtures/audio/<nome>.csv`. Se o conteúdo não puder ficar
no repositório, use `fixtures/private/` (ignorada pelo git) e o `eval:cleanup` procura lá também.

---

## [ ] F2-01 Leitura de WAV e reamostragem

**Arquivos:** `packages/core/src/audio/{wav.ts,resample.ts,index.ts}`, `packages/core/test/wav.test.ts`.

**Passos:** `REFERENCIAS-API.md` §9. `readWav(buf) → { sampleRate, channels: Float32Array[] }`,
`toMono`, `resample(samples, from, to)` (filtro passa-baixa simples + interpolação; a qualidade
precisa ser suficiente para o VAD).

**Aceite:** WAVs sintéticos gerados no próprio teste (PCM16, PCM24, float32, extensible, estéreo,
com chunk `LIST` no meio) são lidos corretamente; um seno de 440 Hz reamostrado de 48 kHz para
16 kHz mantém a frequência (pico da FFT a ±5 Hz).

---

## [ ] F2-02 VAD (Silero)

**Arquivos:** `packages/core/src/audio/vad.ts`, `packages/core/assets/silero_vad.onnx`,
`packages/core/test/vad.test.ts`.

**Passos:** `REFERENCIAS-API.md` §8. `detectSpeech(mono16k) → { startMs, endMs }[]` com os
parâmetros da SPEC §7.3. Registre a dependência `onnxruntime-node` e o modelo em `docs/DECISOES.md`.

**Aceite:** num WAV de fixture com fala, os segmentos cobrem a fala (comparando com o gabarito); um
silêncio puro sintético gera zero segmentos.

---

## [ ] F2-03 Detecção de silêncios e suspiros

**Arquivos:** `packages/core/src/cleanup/{features.ts,detect.ts,params.ts,index.ts}`,
`packages/core/test/cleanup.test.ts`, `scripts/eval-cleanup.mjs`.

**Passos:**
1. `features.ts`: RMS em quadros de 20 ms, piso de ruído, planicidade espectral, taxa de
   cruzamentos por zero.
2. `detect.ts`: SPEC §7.3, com a saída `CleanupCandidate[]`.
3. `params.ts`: os limiares por sensibilidade (baixa, média, alta) num lugar só, fácil de ajustar.
4. `pnpm eval:cleanup`: para cada fixture, precisão e revocação por tipo (um candidato acerta quando
   se sobrepõe a pelo menos 50% de um trecho do gabarito do mesmo tipo).
5. Ajustar os limiares até a meta da SPEC §7.3 nas gravações do José. Anotar os valores finais em
   `docs/DECISOES.md`.

**Aceite:** testes com áudio sintético (fala simulada = ruído modulado; suspiro = ruído curto de
energia média antes da "fala"; silêncio = quase zero); `eval:cleanup` atinge a meta nas fixtures do
José.

---

## [ ] F2-04 Marcadores · Teste manual

**Arquivos:** `packages/panel/host/cleanup.jsx`, métodos `createMarkers`, `listMarkers` e
`deleteMarkers` do `CepAdapter`.

**Passos:** SPEC §7.4, com as cores definidas na P4. Apagar e listar só mexem em marcadores cujo
nome começa com `eve-cut ·`.

**Teste manual (José):** criar 10 marcadores de teste, conferir duração, nome, comentário e cor;
apagar pelo painel e conferir que os marcadores dele (sem o prefixo) ficaram.

---

## [ ] F2-05 Checagem de segurança da timeline

**Arquivos:** `packages/core/src/cleanup/safety.ts` (+ teste), `listTrackUsage` no `CepAdapter`.

**Passos:** SPEC §7.1. A função pura recebe a lista de faixas e clipes e devolve
`{ ok: true } | { ok: false, message }`.

**Aceite:** testes com só V1/A1 (ok), A2 vinculada a V1 (ok), clipe em V2 (bloqueia), música em A3
(bloqueia), sequência vazia (bloqueia com "Não há fala na timeline"). A faixa de legenda não é
detectável (P3/P6): ela é tratada pela conferência de cada corte na F2-06.

---

## [ ] F2-06 Confirmar e cortar · Teste manual

**Arquivos:** `packages/core/src/cleanup/ranges.ts` (+ teste), `packages/panel/host/cut.jsx`,
`cloneSequence` e `cutRanges` no `CepAdapter`. A P6 escolheu a técnica (A): razor da QE com o
timecode sem o ponto zero + `remove(true, true)`; o FCP XML não entra.

**Passos:** SPEC §7.5. `ranges.ts` (puro): juntar sobrepostos e vizinhos, alinhar aos quadros pela
taxa da sequência, ordenar do fim para o começo, somar o tempo removido. `cut.jsx` confere, depois
de cada trecho, que o clipe seguinte recuou o tamanho do trecho, e para com erro se não recuou.

**Aceite automático:** `ranges.ts` com sobreposição, adjacência abaixo de 1 quadro, 23,976 / 25 /
29,97 / 30 / 60 fps, e lista vazia.

**Teste manual (José):** analisar → apagar 2 marcadores e esticar 1 → confirmar → backup criado com
o nome certo, cortes só nos marcadores que sobraram, sem buracos, áudio e vídeo alinhados. Numa
sequência em 01;00;00;00. E uma vez com uma faixa de legenda: o corte para com a mensagem e o backup
fica intacto.

---

## [ ] F2-07 Aba Limpeza · Teste manual

**Arquivos:** `packages/panel/src/ui/cleanup/*`.

**Passos:** botões Analisar, Limpar marcadores e Confirmar cortes; seletor de sensibilidade (e
avançado: silêncio mínimo, padding); lista de candidatos com clique para ir até o trecho; progresso
da exportação do áudio; mensagem da checagem de segurança. Os parâmetros padrão vêm do perfil do
cliente (`cleanup`).

**Teste manual (José):** fluxo completo num vídeo real de cliente, do Analisar ao relatório final.

---

## [ ] F2-08 Ferramentas MCP da limpeza

**Arquivos:** `packages/mcp-server/src/tools/cleanup.ts` (+ testes),
`packages/panel/src/bridge/methods/cleanup.ts`.

**Passos:** SPEC §7.6. `apply_cleanup_cuts` sempre passa por `ui.confirm`.

**Aceite:** testes com ponte falsa. **Teste manual:** "marca os suspiros dessa sequência" e depois
"pode cortar" numa conversa; a confirmação aparece no painel.
