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
