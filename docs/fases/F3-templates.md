# F3 — Templates do cliente (v3)

**Meta:** a legenda sai com o formato e o visual de cada cliente, e os templates podem vir do Acervo
do Eve Hub.

**Base:** SPEC §8. **Pré-requisitos:** F1, P8 e P9, e um cliente piloto organizado (F3-00).

---

## [ ] F3-00 Pacote do cliente piloto · (José)

**O que fazer:** escolher a raiz dos templates (sugestão: `Y:\Eve\Templates`) e montar o pacote de
um cliente piloto (4S Estampas) com a estrutura da SPEC §8.1: `eve-cut.template.json` + o `.mogrt`
de legenda e/ou o `.prtextstyle` + presets, se houver. Subir os mesmos arquivos no Acervo do Hub,
na categoria de templates do cliente.

---

## [ ] F3-01 Carregar e validar templates

**Arquivos:** `packages/core/src/template/{schema.ts,load.ts,index.ts}` (+ testes).

**Passos:** schema zod do `eve-cut.template.json`; `loadTemplate(root, slug)` confere se os arquivos
citados existem; mensagens claras para o que falta. O perfil ganha `template.package` (caminho).

**Aceite:** template válido, arquivo citado faltando, `caption_mode` inválido, pacote inexistente.

---

## [ ] F3-02 Regras de formato e "dividir bloco"

**Arquivos:** `packages/core/src/format/{case.ts,linebreak.ts,split.ts,index.ts}` (+ testes).

**Passos:** SPEC §8.2. Quebra equilibrada: dentre as quebras possíveis em bordas de palavra, a que
minimiza a diferença de tamanho entre as linhas respeitando `max_chars_per_line`. "Dividir bloco"
gera uma proposta `divisao` que entra na revisão (F1-09) e só é aplicada se aceita.

**Aceite:** quebra em 1 e 2 linhas; palavra maior que o limite (fica sozinha na linha e o bloco é
sinalizado); `text_case: "upper"` com acentos; ponto final removido mas reticências e "?" mantidos;
divisão com tempos dentro do intervalo original e alinhados aos quadros; o `.srt` final mantém
idênticos os tempos dos blocos não divididos.

---

## [ ] F3-03 Legenda nativa com estilo · Teste manual

**Arquivos:** `packages/panel/host/style.jsx`, `packages/panel/src/jobs/apply.ts`.

**Passos:** SPEC §8.3, com o resultado da P9.

**Teste manual (José):** aplicar no cliente piloto e conferir o estilo (ou a instrução de 1 passo).

---

## [ ] F3-04 Legenda em MOGRT · Teste manual

**Arquivos:** `packages/panel/host/mogrt.jsx`, `insertMogrtCaptions` no `CepAdapter`,
`packages/core/src/template/mogrt-plan.ts` (+ teste).

**Passos:** SPEC §8.4. `mogrt-plan.ts` (puro): de blocos + formato → lista
`{ startTicks, endTicks, text }` e a faixa de destino. O host aplica com progresso. "Remover MOGRTs
do eve-cut".

**Aceite automático:** `mogrt-plan` com blocos colados, blocos curtos (abaixo de `min_block_ms`) e
caixa alta.

**Teste manual (José):** 40 blocos viram 40 MOGRTs com texto e tempo certos; remover apaga só os do
eve-cut.

---

## [ ] F3-05 Presets de sequência e exportação · Teste manual · opcional

**Arquivos:** `packages/panel/host/presets.jsx`.

**Passos:** SPEC §8.5. Fazer só o que a API permitir; se "Nova sequência do cliente" não tiver API,
registrar em `docs/DECISOES.md` e pular.

---

## [ ] F3-06 Acervo do Eve Hub

**Arquivos:** `packages/core/src/hub/{client.ts,acervo.ts,index.ts}` (+ testes com servidor HTTP
falso), aba Clientes ("Vincular ao Hub", "Baixar templates do Acervo"), ⚙ (URL e token).

**Passos:** SPEC §8.6 e `REFERENCIAS-API.md` §7. O token fica em `settings.json`. Nunca sobrescrever
arquivo local sem perguntar. Mostrar as anotações de Configurações do Acervo no perfil, com "Copiar
para o perfil".

**Aceite automático:** servidor falso responde `list_clients` e `get_client_acervo`; token errado →
"Token do Hub inválido. Gere outro em Perfil → Acesso de agentes."; limite de chamadas → mensagem
própria; download para a pasta certa sem sobrescrever.

**Teste manual (José):** vincular a 4S, baixar o pacote do Acervo e aplicar uma legenda com ele.
