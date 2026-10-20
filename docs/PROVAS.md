# Provas técnicas (F0-05)

Preencher depois de rodar cada prova pela aba Lab do painel (Ctrl+Shift+L). As perguntas estão em
`docs/fases/F0-fundacao.md`, tarefa F0-05.

**Versão do Premiere:** _(Ajuda → Sobre)_
**Versão do CEP/CSXS que funcionou no manifest:**
**Data:**

| prova | funcionou? | o que aconteceu (resultado bruto, tempos, mensagens) | decisão |
|---|---|---|---|
| P1 exportar SRT por script | | | |
| P2 `createCaptionTrack` e ponto zero | | | |
| P3 ler legendas existentes | | | |
| P4 marcadores (duração, nome, cor) | | | índice → cor: |
| P5 exportar WAV (tempo para 60 s) | | | |
| P6 corte (A: QE razor / B: FCP XML) | | | |
| P7 `claude -p` pelo painel | | | campo de saída: |
| P8 MOGRT com texto | | | |
| P9 `.prtextstyle` por script | | | |

---

## Roteiro

**Antes de começar**

1. Feche o Premiere.
2. No terminal, rode `pnpm dev:panel` (build + cópia para o CEP + `PlayerDebugMode`).
3. Abra o Premiere, abra um **projeto de teste** com uma sequência montada (V1/A1 com fala). Use
   projeto de teste: as provas criam marcadores, faixas e uma cópia da sequência.
4. Janela → Extensões → eve-cut. Confirme o rodapé com a versão e a sequência ativa.
5. Abra o Lab com **Ctrl+Shift+L**. Cada botão mostra o JSON bruto no fim da aba; ele é a evidência
   que vai para a tabela. `Esc` ou o × fecham o Lab.

### P1 · Exportar as legendas por script

Pré-requisito: preset `presets/eve-cut-legendas.epr` criado no Media Encoder (ver
`PENDENCIAS-JOSE.md`).

1. No Lab, preencha o preset `.epr`, a saída `.srt` e (opcional) a saída `.xml`.
2. Clique em **Rodar P1**.
3. Anote em `direct`: se `ok`, se o `.srt` existe e o tamanho. Em `xml`: se exportou e se
   `mentionsCaption`/`hasTextElements` vieram `true` (ou seja, se o texto da legenda aparece no XML).
4. Se o `.srt` não sair, a decisão é a pasta vigiada da SPEC §5.1.

### P2 · `createCaptionTrack` e o ponto zero

Use `fixtures/srt/premiere-exemplo.srt`.

1. Rode uma vez com **Começar em 0** e anote `startAt`, `created` e `captionTracksAfter`.
2. Na mesma sequência, rode de novo com **Começar no zeroPoint** e compare `zeroPointSeconds`,
   `startAt` e onde a faixa ficou na timeline.
3. Se a faixa entrar no ponto errado, teste o modo **Começar em…** com o valor de `zeroPointSeconds`.
4. Anote também `importedItem`; se vier `null`, o problema é a importação, não a faixa.

### P3 · Ler legendas que já estão na sequência

1. Com uma sequência que tenha faixa de legenda, clique em **Rodar P3**.
2. Anote `captionTrackCount`, `captionTracks` (nome e número de clipes) e `probes`: o esperado é que
   `getCaption`/`text` não existam. Se existir, registre o nome exato da API — isso muda a F1.

### P4 · Marcadores

1. Clique em **Rodar P4** (cria 8 marcadores, um por cor).
2. Olhe a timeline: os marcadores têm duração? A cor muda de 0 a 7? Anote o mapa `índice → cor` na
   tabela.
3. Confira `readBack`: `startSeconds`, `endSeconds` e `comments` voltaram certos?
4. Marque **Apagar os marcadores no fim** e rode de novo se quiser limpar; ou apague na mão.

### P5 · Exportar o áudio em WAV

Pré-requisito: preset `presets/eve-cut-audio.epr`.

1. Use uma sequência de ~60 s (a que a F2 vai usar).
2. Preencha o preset e a saída `.wav`, clique em **Rodar P5**.
3. Anote `durationMs` (tempo do script, não do vídeo), `fileSize` e `sequenceSeconds`.

### P6 · Corte com ripple

A prova A trabalha numa **cópia** da sequência ativa (nome `<sequência> (lab P6)`); a original não é
tocada. A prova B só exporta e reimporta o XML sem edição — o corte pela técnica B completa só é
necessário se A falhar.

1. Clique em **A · Clonar + QE razor (20 cortes)**.
2. Abra a cópia `(lab P6)` na timeline: ficou com 20 cortes (21 pedaços, 10 removidos)? Anote
   `razors`, `removed`, `videoClipsAfter` e qualquer mensagem em `errors`.
3. Se A falhar, preencha a saída `.xml` e clique em **B · Exportar e reimportar FCP XML**. Anote se o
   XML exportou (`exportOk`, `fileSize`) e se a sequência reimportada apareceu (`importedItem`).
4. A decisão da F2 sai daqui: A se funcionar; senão, editar o XML no Node antes de importar.

### P7 · `claude -p` pelo painel

Cada clique consome o limite da assinatura (no máximo duas execuções: uma com
`--system-prompt-file`, outra com `--system-prompt` se a primeira reclamar da opção).

1. Descubra o caminho do executável: no PowerShell, `where.exe claude`; o `.cmd` aponta para
   `...\node_modules\@anthropic-ai\claude-code\bin\claude.exe`. Cole esse `.exe` no campo.
2. Deixe o modelo `sonnet` e 40 blocos, clique em **Rodar P7**.
3. Anote: `exitCode`, `durationMs`, se `stderr` tem erro de opção desconhecida, se o `parsed` tem
   `structured_output` (campo de saída) e o tamanho de `stdout`.
4. Se o limite tiver acabado, o `parsed` deve trazer `is_error: true` e
   `api_error: "usage_limit_reached"`; registre o texto de `result`.

### P8 · MOGRT

1. Preencha o caminho de um `.mogrt` com texto editável e o texto de teste.
2. Clique em **Rodar P8**.
3. Anote `imported`, `hasComponent`, `parameterNames`, `textParamRaw`, `textChanged` e `endSeconds`.
   Se o texto mudou na timeline, a F3 pode usar MOGRT; se não, só legenda nativa.

### P9 · `.prtextstyle`

1. Preencha o caminho do `.prtextstyle` e clique em **Rodar P9**.
2. Anote se o arquivo importou (`importedItem`), se há faixa de legenda e o que os `probes` mostram
   (`applyStyle`, `setStyle`, `style`, `importTextStyle`). O esperado é que não exista API; nesse
   caso a F3 mostra a instrução manual de um passo.

---

## Depois de rodar

1. Preencha a tabela e a seção de cada prova.
2. Onde a prova contrariar `docs/SPEC.md` ou `docs/REFERENCIAS-API.md`, corrija os arquivos e
   registre o desvio em `docs/DECISOES.md`.
3. Confirme que os `.epr` usados estão em `presets/`.
