# Subtitle Fixer — painel para Adobe Premiere Pro

Corrige legendas geradas pelo Speech-to-Text do Premiere usando Claude, aplicando
o glossário e o tom de voz de cada cliente. **Os timestamps nunca são tocados** e
o `.srt` original nunca é sobrescrito.

Este é o equivalente da **Fase 1** do `subtitle-fixer-plan.md`, embalado como plugin
em vez de script de linha de comando: perfis em JSON local, sem n8n e sem Postgres.

---

## Instalação

1. Feche o Premiere Pro.
2. Clique com o botão direito em `install.ps1` → **Executar com PowerShell**.
   (ou `powershell -ExecutionPolicy Bypass -File install.ps1`)
3. Abra o Premiere → menu **Janela → Extensões → Subtitle Fixer**.
4. Na aba da engrenagem, cole a chave da API da Anthropic e salve.

O instalador liga o `PlayerDebugMode` do CEP (necessário porque a extensão não é
assinada) e copia o painel para
`%APPDATA%\Adobe\CEP\extensions\com.eve.subtitlefixer`.

---

## Uso

1. No Premiere, exporte as legendas da sequência como `.srt`
   (**Arquivo → Exportar → Legendas**, ou botão direito na faixa de legendas).
2. No painel: escolha o **cliente**, arraste o `.srt` (ou clique para procurar).
3. **Corrigir legendas**.
4. O painel salva `nome_corrigido.srt` na mesma pasta, mostra a lista de blocos
   alterados (antes → depois) e, se a opção estiver marcada, importa o arquivo
   para uma bin **Legendas Corrigidas** no projeto.
5. Revise a lista de alterações antes de reimportar na timeline.

---

## Perfis de cliente

Aba do bonequinho. Cada cliente tem:

| Campo | Para que serve |
|---|---|
| **Glossário** | o que o Premiere costuma errar → a forma correta (`"de teif"` → `"DTF"`) |
| **Termos protegidos** | marcas, nomes e produtos que nunca podem ser alterados |
| **Tom de voz** | voz, formalidade, o que evitar, notas sobre o público |
| **Exemplos antes/depois** | uma ou duas legendas reais já aprovadas — calibra melhor que qualquer descrição |

Os perfis ficam em `%APPDATA%\SubtitleFixer\profiles\<cliente>.json`, no mesmo
formato JSONB previsto para a tabela `client_profiles` do Eve Hub — quando a
Fase 2 chegar, é `INSERT` direto, sem reescrever nada.

---

## Configurações

- **Chave da API** — fica só nesta máquina, em `%APPDATA%\SubtitleFixer\settings.json`.
- **Modelo** — Opus 5 (padrão), Sonnet 5 ou Haiku 4.5. O plano sugeria Sonnet por custo;
  como o volume de texto de uma legenda é pequeno, vale rodar Opus 5 em um vídeo real e
  comparar antes de decidir.
- **Blocos por lote** — 20 é o padrão. Lote maior = menos chamadas, mais risco de o
  modelo perder o alinhamento dos índices.
- **Sufixo** — `_corrigido` por padrão.
- **Pasta de saída** — mesma do original, ou uma pasta fixa (ex.: a pasta compartilhada
  do servidor).

---

## Como funciona por dentro

```
.srt  →  SRT.parse()          blocos { num, timing, text }
      →  lotes de 20          só o texto vai para a API; timing fica aqui
      →  Messages API         system prompt = perfil do cliente
                              output_config.format = JSON schema com { index, text }
      →  remapeia por index   bloco sem resposta mantém o texto original
      →  SRT.build()          timing line reescrita byte a byte
      →  nome_corrigido.srt
```

Arquivos:

| Arquivo | Responsabilidade |
|---|---|
| `js/srt.js` | parse / build do `.srt` |
| `js/claude.js` | prompt do cliente, lotes, chamada à API, retry |
| `js/store.js` | perfis e configurações em `%APPDATA%\SubtitleFixer` |
| `js/main.js` | UI |
| `jsx/host.jsx` | único ponto que fala com o Premiere (importar no projeto) |

O system prompt é idêntico em todos os lotes e vai marcado com `cache_control`,
então do segundo lote em diante ele é lido do cache.

Falha de rede ou 429 tem 3 tentativas com espera crescente. Se o lote falhar de
vez, nada é gravado e o original continua intacto.

---

## Limitações conhecidas

- Só `.srt` (é o que o Premiere exporta). `.vtt` é aceito no seletor mas não foi testado.
- O painel não lê a faixa de legendas da sequência direto — precisa do export.
- Perfis são locais desta máquina. Compartilhar entre editores = copiar a pasta
  `%APPDATA%\SubtitleFixer\profiles` (ou esperar a Fase 2 com o Postgres).
- Windows apenas (o "abrir pasta" usa `explorer.exe`).
