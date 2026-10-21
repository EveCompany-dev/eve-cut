# Referências de API

Trechos para não precisar adivinhar. O que está marcado **[confirmar]** não foi testado num Premiere
real e é coberto por uma prova técnica da F0-05. Quando a prova contradisser este arquivo, corrija o
arquivo.

Fonte principal do ExtendScript: <https://ppro-scripting.docsforadobe.dev/>.
Exemplos oficiais da Adobe: <https://github.com/Adobe-CEP/Samples/tree/master/PProPanel>.

---

## 1. Manifest do CEP

Base: `legacy/subtitle-fixer-panel/CSXS/manifest.xml`. Mudanças:

```xml
<ExtensionManifest Version="7.0" ExtensionBundleId="com.eve.evecut" ExtensionBundleVersion="0.1.0"
                   ExtensionBundleName="eve-cut" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <ExtensionList><Extension Id="com.eve.evecut.panel" Version="0.1.0" /></ExtensionList>
  <ExecutionEnvironment>
    <HostList><Host Name="PPRO" Version="[25.0,99.9]" /></HostList>
    <LocaleList><Locale Code="All" /></LocaleList>
    <RequiredRuntimeList><RequiredRuntime Name="CSXS" Version="12.0" /></RequiredRuntimeList>
  </ExecutionEnvironment>
  <!-- DispatchInfoList: igual ao protótipo, com Menu "eve-cut" e ScriptPath ./host/index.jsx -->
</ExtensionManifest>
```

- **[confirmar]** a versão do CSXS no Premiere 2026. Se o painel não aparecer em Janela → Extensões,
  tente `11.0`.
- Parâmetros do CEF (iguais ao protótipo): `--enable-nodejs`, `--mixed-context`,
  `--allow-file-access-from-files`.
- `.debug` na raiz da extensão:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ExtensionList><Extension Id="com.eve.evecut.panel"><HostList><Host Name="PPRO" Port="8088"/></HostList></Extension></ExtensionList>
```

## 2. Chamar o ExtendScript a partir do painel

```ts
// packages/panel/src/premiere/host.ts
declare global { interface Window { __adobe_cep__?: { evalScript(script: string, cb: (r: string) => void): void } } }

export function callHost<T>(fn: string, arg: unknown): Promise<T> {
  // The argument travels as a JS string literal. JSON.stringify twice makes it one;
  // U+2028/U+2029 are line terminators in ES3 string literals and must be escaped.
  const literal = JSON.stringify(JSON.stringify(arg ?? null))
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return new Promise((resolve, reject) => {
    const cep = window.__adobe_cep__;
    if (!cep) return reject(new Error('Fora do Premiere'));
    cep.evalScript(`${fn}(${literal})`, (raw) => {
      let res: { ok: boolean; data?: T; error?: string };
      try { res = JSON.parse(raw); } catch { return reject(new Error(`Resposta inválida do host: ${raw}`)); }
      if (res.ok) resolve(res.data as T); else reject(new Error(res.error));
    });
  });
}
```

Lado do host (ES3):

```js
// packages/panel/host/index.jsx
//@include "json2.js"   // [confirmar] caminho relativo ao arquivo; alternativa: $.evalFile(...)

function eveOk(data) { return JSON.stringify({ ok: true, data: data }); }
function eveErr(e) { return JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }); }

function evePing(argJson) {
  try {
    var seq = app.project ? app.project.activeSequence : null;
    return eveOk({ appVersion: app.version, projectPath: app.project ? app.project.path : null,
                   sequence: seq ? { name: seq.name, id: seq.sequenceID } : null });
  } catch (e) { return eveErr(e); }
}
```

## 3. ExtendScript do Premiere

### Sequência, tempo, cursor

```js
var seq = app.project.activeSequence;          // null se não houver
var zero = seq.zeroPoint;                       // ticks (string): início da timeline (ex.: 01:00:00:00)
var t = new Time(); t.seconds = 12.5;           // t.ticks -> string
seq.setPlayerPosition(t.ticks);                 // move o cursor
var tb = seq.timebase;                          // ticks por quadro (string)
var TICKS_PER_SECOND = 254016000000;
```

### Importar arquivo numa bin

```js
function eveFindOrCreateBin(parent, name) {
  for (var i = 0; i < parent.children.numItems; i++) {
    var c = parent.children[i];
    if (c.type === ProjectItemType.BIN && c.name === name) return c;
  }
  return parent.createBin(name);
}
var bin = eveFindOrCreateBin(eveFindOrCreateBin(app.project.rootItem, "eve-cut"), "Legendas");
app.project.importFiles([path], true /* suppressUI */, bin, false);
// Depois procure em bin.children o item com item.getMediaPath() === path.
```

### Faixa de legenda (P2)

```js
// startAtTime em segundos (Number). captionFormat opcional, padrão SUBTITLE.
var ok = seq.createCaptionTrack(projectItem, 0, Sequence.CAPTION_FORMAT_SUBTITLE);
```

Confirmado na P2 (26.5.2): `startAtTime` é um **deslocamento em segundos a partir do começo da
sequência**, não um tempo absoluto. Numa sequência que começa em 01;00;00;00, `0` põe o 1º bloco em
01;00;00;00 e passar o `zeroPoint` (3599,9964 s) empurra a faixa para 02;00;00;00. Valor negativo é
aceito. Como o `.srt` exportado pelo Premiere tem tempos absolutos (P1), use `-zeroPoint` em
segundos (`Number(seq.zeroPoint) / 254016000000`): com o `.srt` exportado de uma sequência em
01;00;00;00, `-3599.9964` pôs o 1º bloco em 01;00;00;00. A função
devolve `true` mesmo quando os blocos caem fora da sequência, e `sequence.captionTracks` não existe:
não dá para conferir a faixa criada por script. A P3 confirmou com reflexão (`obj.reflect.properties`
e `obj.reflect.methods`) que nem a `Sequence` do DOM nem a sequência da QE expõem faixas de legenda:
o único membro com "caption" é `createCaptionTrack`. Não há como ler o texto nem contar as faixas.

Reflexão no ExtendScript: `obj.reflect.properties` e `obj.reflect.methods` listam os membros (cada
um com `.name`). Todo objeto já tem uma propriedade `reflect` só de leitura: `data.reflect = x` é
ignorado sem erro, então use outro nome de chave nos objetos que voltam como JSON.

### Exportar (P1, P5)

```js
// workAreaType: 0 = sequência inteira, 1 = in/out, 2 = área de trabalho
var ok = seq.exportAsMediaDirect(outPath, eprPath, 0);
var ok2 = seq.exportAsFinalCutProXML(xmlPath);
```

O preset `.epr` é criado pelo José no Media Encoder e salvo em `presets/`. Para a P1, o preset usa a
aba Legendas com "Criar arquivo sidecar" no formato SubRip (.srt) e "Incluir SRT Styling" desmarcado.
Confirmado na P1 (26.5.2): a exportação direta gera o sidecar como `<saída>.srt` (ex.: `x.wav.srt`)
e devolve a string `"No Error"`. A pasta de saída precisa existir antes: a função não cria pasta.

### Marcadores (P4)

```js
var m = seq.markers.createMarker(12.5);   // segundos
m.end = 12.84;                            // [confirmar] aceita segundos (Number) ou precisa de Time
m.name = "eve-cut · suspiro";
m.comments = "confiança 0,82 · 340 ms";
m.setColorByIndex(4);                     // [confirmar] índices 0–7 e a cor de cada um

var cur = seq.markers.getFirstMarker();
while (cur) {
  // cur.start.seconds, cur.end.seconds, cur.name, cur.comments
  var next = seq.markers.getNextMarker(cur);
  // seq.markers.deleteMarker(cur);  // apagar
  cur = next;
}
```

### Faixas e clipes

```js
for (var v = 0; v < seq.videoTracks.numTracks; v++) {
  var track = seq.videoTracks[v];
  for (var c = 0; c < track.clips.numItems; c++) {
    var clip = track.clips[c];  // clip.start.seconds, clip.end.seconds, clip.projectItem, clip.name
  }
}
// Remover um trackItem: clip.remove(true /* ripple */, true /* alinhar ao vídeo */);
```

### Duplicar a sequência (backup)

```js
var ok = seq.clone();   // cria "<nome> Copy" no projeto; procure pelo nome e renomeie o projectItem
```

### Corte com a QE (P6, não documentada)

```js
app.enableQE();
var qeSeq = qe.project.getActiveSequence();
// timecode no formato da sequência: "00;00;12;03" (drop-frame) ou "00:00:12:03"
qeSeq.getVideoTrackAt(0).razor(timecode);
qeSeq.getAudioTrackAt(0).razor(timecode);
// Depois do razor nas duas bordas, remova o trecho do meio com clip.remove(true, true).
```

**[confirmar]** tudo deste bloco. A alternativa (B) é exportar o FCP XML, remover os trechos no XML
com Node e importar o XML como sequência nova (`app.project.importFiles([xmlPath], ...)`).

### MOGRT (P8)

```js
var ti = seq.importMGT(mogrtPath, startTicks /* string */, videoTrackOffset, audioTrackOffset);
var comp = ti.getMGTComponent();
var p = comp.properties.getParamForDisplayName("Source Text");
// [confirmar] nas versões recentes o valor é um JSON com textEditValue
var v = JSON.parse(p.getValue()); v.textEditValue = "texto da legenda"; p.setValue(JSON.stringify(v), true);
var end = new Time(); end.seconds = 14.1; ti.end = end;
```

### Media Encoder (F3)

```js
app.encoder.launchEncoder();
app.encoder.encodeSequence(seq, outPath, eprPath, 0 /* inteira */, 1 /* remover da fila ao terminar */);
app.encoder.startBatch();
```

## 4. Empacotar o painel com esbuild

```js
// packages/panel/build.mjs
import { build } from 'esbuild';
await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  platform: 'node',          // CEP com --mixed-context: require() do Node existe no painel
  target: 'chrome99',        // [confirmar] versão do Chromium do CEP 12
  external: ['fs', 'path', 'os', 'crypto', 'child_process', 'http', 'net', 'events', 'url', 'util'],
  outfile: 'dist/js/main.js',
});
```

O `ws` (servidor da ponte) e o `zod` entram no bundle. `host/*.jsx`, `index.html`, `css/`, `CSXS/`,
`icons/` e `.debug` são copiados para `dist/` como estão.

## 5. Servidor MCP (TypeScript SDK)

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'eve-cut', version: '0.1.0' });

server.registerTool(
  'get_client_profile',
  { description: 'Perfil de legendas de um cliente (glossário, termos protegidos, tom).', inputSchema: { slug: z.string() } },
  async ({ slug }) => ({ content: [{ type: 'text', text: JSON.stringify(await loadProfile(slug)) }] }),
);

await server.connect(new StdioServerTransport());
```

- Nada pode ser escrito no stdout além do protocolo MCP. Logs vão para o stderr ou para
  `%APPDATA%\eve-cut\logs\mcp.log`.
- Registro: `claude mcp add --scope user eve-cut -- node "C:\…\mcp-server\dist\index.js"`.

## 6. Claude Code em modo não interativo

Verificado no PC do José (Claude Code 2.1.300, 20/10/2026), pelo `claude --help`:
`-p`, `--safe-mode`, `--tools`, `--model`, `--output-format json`, `--json-schema`,
`--no-session-persistence`, `--system-prompt`, `--strict-mcp-config`, `--mcp-config`.
`--system-prompt-file` aparece citado na ajuda do `--bare`. P7 (21/10/2026): aceito sem `--bare`
(a chamada chegou à API, sem erro de opção); **[confirmar]** que o conteúdo do arquivo é usado.

Executável: o `claude.cmd` da pasta global do npm chama
`…\node_modules\@anthropic-ai\claude-code\bin\claude.exe`. Use o `.exe` direto:

```ts
import { spawn } from 'node:child_process';
const child = spawn(claudeExe, [
  '-p', '--safe-mode', '--tools', '', '--no-session-persistence',
  '--output-format', 'json', '--model', model,
  '--system-prompt-file', promptFile,
  '--json-schema', JSON.stringify(schema),
], { cwd: workDir, windowsHide: true });
child.stdin.end(userPrompt);
```

Saída **real** quando o limite da assinatura acabou (exit code 1, campos irrelevantes omitidos):

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": true,
  "api_error_status": 429,
  "api_error": "usage_limit_reached",
  "result": "You've hit your weekly limit · resets Oct 23, 2am (America/Sao_Paulo)",
  "terminal_reason": "api_error",
  "num_turns": 1,
  "duration_ms": 939,
  "total_cost_usd": 0,
  "session_id": "…"
}
```

Note que `subtype` vem `"success"` mesmo com erro: decida pelo `is_error`.

Saída de sucesso com `--json-schema`: **[confirmar] na P7**. O esperado é `is_error: false` e o objeto
validado num campo `structured_output`. Se ele não existir, faça `JSON.parse(result)`.

## 7. MCP do Eve Hub (F3)

- Endpoint: `<URL do Hub>/api/mcp`, JSON-RPC por HTTP, com `Authorization: Bearer evh_…`. O token é
  criado no Hub em Perfil → Acesso de agentes. Há limite de chamadas por token.
- Ferramentas úteis que já existem: `list_clients`, `get_client` e
  `get_client_acervo(clientId, section?)`. Esta última devolve identidade visual, paleta, fontes,
  plugins e presets, templates, links e as anotações de Configurações (tom de voz, tamanhos de
  exportação, o que o cliente não quer).

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({ name: 'eve-cut', version: '0.1.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(`${hubUrl}/api/mcp`), {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
}));
const res = await client.callTool({ name: 'get_client_acervo', arguments: { clientId: '4S Estampas', section: 'Templates' } });
```

**[confirmar]** se o endpoint do Hub aceita o transporte Streamable HTTP do SDK. Se não aceitar, faça
`POST` JSON-RPC direto com `fetch` (`initialize`, depois `tools/call`).

## 8. Silero VAD (F2)

- Modelo: `silero_vad.onnx` (v5) de <https://github.com/snakers4/silero-vad>, licença MIT. Vai junto
  do pacote em `packages/core/assets/`.
- Execução: `onnxruntime-node`. Entrada: janelas de 512 amostras a 16 kHz (`input` float32 [1,512]),
  `state` float32 [2,1,128] (que passa de uma janela para a seguinte) e `sr` int64 = 16000. Saída:
  probabilidade de fala por janela + `stateN`. **[confirmar]** os nomes dos tensores no modelo baixado
  (inspecione `session.inputNames`).

## 9. WAV

Leia o cabeçalho RIFF à mão: `fmt ` com `audioFormat` 1 (PCM), 3 (float) ou `0xFFFE` (extensible,
olhe o subformato), `numChannels`, `sampleRate`, `bitsPerSample`. Os dados estão no chunk `data`.
Pule chunks desconhecidos (`LIST`, `bext`…) pelo tamanho.
