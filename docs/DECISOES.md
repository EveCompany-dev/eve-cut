# Decisões

Registro do que foi decidido e por quê. O que foi decidido pelo José na conversa de planejamento de
20/10/2026 está marcado **(José)**. O que é recomendação técnica do plano está marcado **(plano)** e
pode mudar com as provas técnicas da F0-05.

## Produto

| # | decisão | por quê |
|---|---|---|
| 1 | **(José)** A correção é disparada de dois jeitos: botão no painel e conversa com o Claude. | Botão para o dia a dia; conversa para pedidos livres. As ferramentas são as mesmas. |
| 2 | **(José)** O texto das legendas vem do Speech-to-Text do Premiere, exportado automaticamente. | Mantém o fluxo atual de legendas do Premiere. Se a exportação por script não for possível (P1), entra a pasta vigiada. |
| 3 | **(José)** Suspiros: primeiro só marca; quando o José confirma, corta todos os marcados. | Ele revisa na própria timeline antes de qualquer corte. |
| 4 | **(José)** Usuário único, 1 PC Windows. | Perfis locais bastam; instalação manual é aceitável. |
| 5 | **(José)** Ordem: cortar antes de legendar. | As legendas já nascem no tempo certo. |
| 6 | **(José)** "Template do cliente" = MOGRT de legenda + estilo nativo + regras de formato + presets de sequência e de exportação. | Os quatro são usados conforme o cliente. |
| 7 | **(José)** Glossário local agora, sincronizado com o Hub depois. Exporta `.json` + `.md`. | A extensão não espera a feature do Hub. |
| 8 | **(José)** Análise de suspiros e silêncios **só por áudio**, sem transcrição própria. | Mantém a instalação leve. Consequência: tomadas repetidas ficam para depois das legendas (F4), usando o texto do SRT. |
| 9 | **(José)** A limpeza roda no início da edição, com só a fala na timeline. | Corte com ripple é seguro sem trilha e B-roll; a ferramenta bloqueia se achar outras faixas. |
| 10 | **(José)** Os templates ainda serão organizados. | O plano define a estrutura do pacote (SPEC §8.1). |
| 11 | **(José)** O desenvolvimento será feito pelo Freebuff com DeepSeek. | Por isso as tarefas são pequenas, com aceite e testes que rodam sem o Premiere, e há referências de API prontas. |
| 12 | **(José)** Repositório novo `EveCompany-dev/eve-cut`, separado do evehub. | É um app desktop, com ciclo próprio; fala com o Hub só pelo MCP. |
| 13 | **(José)** A v1 é a correção de legendas. Suspiros e silêncios vêm na v2. | |
| 14 | **(José)** Revisão por diff no painel (aceitar, recusar, editar) com sugestão de glossário. | Ele controla cada mudança, e o glossário cresce com o uso. |
| 15 | **(José)** Nome: eve-cut. | |

## Técnica

| # | decisão | por quê |
|---|---|---|
| T1 | **(plano)** Painel em **CEP**, não UXP, com o acesso ao Premiere isolado num adaptador. | Até a versão 26.5, o UXP do Premiere não lê nem escreve legendas e não tem corte (razor). O CEP com ExtendScript tem `createCaptionTrack`, marcadores e, pela QE, corte. A Adobe fechou o CEP para desenvolvimento novo, então o adaptador permite trocar depois. |
| T2 | **(plano)** Sem chave de API: o botão usa `claude -p --safe-mode` com saída estruturada; a conversa usa MCP. | A Eve não tem API da Anthropic; o José tem a assinatura. `--safe-mode` impede que o CLAUDE.md e os plugins do usuário interfiram na correção. |
| T3 | **(plano)** O botão chama o Claude direto com `--json-schema` (sem loop de ferramentas). A conversa usa as ferramentas MCP. Os dois passam pela mesma validação do `core`. | O botão fica rápido e previsível; a conversa fica flexível. |
| T4 | **(plano)** O painel CEP é o servidor da ponte WebSocket; o mcp-server é cliente. | O Node do CEP consegue escutar uma porta, então dispensa um processo a mais. No UXP isso muda (o plugin só pode ser cliente), e aí a ponte vira um processo separado. |
| T5 | **(plano)** O modelo devolve só os blocos alterados, com o tipo da mudança. | Menos saída, diff mais limpo, e o tipo alimenta as sugestões de glossário. Bloco ausente fica com o original. |
| T6 | **(plano)** Glossário de correspondência exata é aplicado por código antes do modelo. | Previsível, grátis e funciona mesmo sem o Claude (modo só-glossário). |
| T7 | **(plano)** Lotes de 40 blocos com 3 blocos de contexto antes e depois, só para leitura. | Frases cortadas entre blocos deixam de ser corrigidas às cegas. |
| T8 | **(plano)** Os marcadores são a fonte da verdade do corte. | O José revisa e ajusta no próprio Premiere, e nada se perde se o painel fechar. |
| T9 | **(plano)** O corte sempre deixa um backup da sequência. | Desfazer fica trivial, qualquer que seja a técnica de corte (P6). |
| T10 | **(plano)** Detecção com Silero VAD (ONNX, CPU) + medidas de energia e espectro, calibradas com gravações reais. | Sem Python nem ffmpeg; roda dentro do Node. |
| T11 | **(plano)** Templates do Hub lidos pelo MCP que o Hub já tem (`get_client_acervo`). | Não precisa de nada novo no Hub para ler. Gravar o glossário no Hub precisa de uma feature (F4). |

## Desvios durante o desenvolvimento

O agente que desenvolve registra aqui quando a realidade não bater com a spec: data, tarefa, o que a
spec dizia, o que foi feito e por quê.

| data | tarefa | spec dizia | foi feito | por quê |
|---|---|---|---|---|
| 20/10/2026 | F0-02 | ida e volta (`build(parse(x))`) byte a byte idêntica para o `.srt` de exemplo | `fixtures/srt/premiere-exemplo.srt` termina com um único CRLF, sem linha em branco depois do último bloco | o `build` do protótipo (mantido igual) não escreve essa linha em branco; com ela a ida e volta perderia 2 bytes. Arquivo real com linha em branco no fim é normalizado, sem mexer em nenhum tempo. |
| 21/10/2026 | F1-01 | semente da primeira execução converte `legacy/subtitle-fixer-panel/profiles/*.json` | os dois perfis do protótipo estão copiados, no formato v1, em `packages/core/src/profile/seed.ts` e passam pela mesma `migrate()`; um teste garante que a cópia continua igual aos arquivos de `legacy/` | o painel instalado não leva a pasta `legacy/`, e o AGENTS.md proíbe importar dela |
| 21/10/2026 | F1-01 | `toMarkdown` igual ao exemplo da SPEC §6 para a 4S | o teste usa o perfil da 4S do protótipo só com os 2 termos que o exemplo mostra (o perfil tem 5); "Nunca alterar" junta `proper_nouns` e `product_names`; `notes` do tom não entra; seção vazia é omitida | o exemplo mostra só parte dos termos e não traz as notas; o resto do texto bate linha a linha |
| 21/10/2026 | F1-02 | "cada troca gera `{ index, before, after, kind, source }`" | uma mudança por bloco, com o texto inteiro antes e depois de todas as trocas daquele bloco; termos mais longos têm prioridade e um trecho já trocado ou que encosta num termo protegido não é trocado de novo | a revisão (§5.6) e a validação (§5.5) trabalham por bloco; duas mudanças no mesmo bloco com o texto inteiro ficariam contraditórias no diff |
| 21/10/2026 | F1-05 | `runClaude(opts)` com `systemPrompt, userPrompt, schema, model, timeoutMs, claudeExe, workDir` | três opções a mais: `exeArgs` (argumentos antes das flags, para os testes rodarem `node fake-claude.mjs`), `systemPromptMode` (`file` padrão, `inline` se a P7 mostrar que `--system-prompt-file` exige `--bare`) e `validate` (o runner não valida JSON Schema sozinho: quem chama passa `checkModelResponse`, um zod com o mesmo contrato do `RESPONSE_SCHEMA`); a falha traz também `retryable` | testar sem o Claude real, não depender da P7 para escrever o código e não carregar um validador de JSON Schema inteiro |
| 21/10/2026 | F1-05 | – | o runner tira `ANTHROPIC_API_KEY` do ambiente do `claude.exe` | com a variável definida, o Claude Code cobraria a API em vez da assinatura (invariante 4) |
