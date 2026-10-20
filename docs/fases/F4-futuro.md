# F4 — Futuro (ainda não são tarefas)

Itens decididos para depois da v3. Cada um vira tarefas detalhadas, no mesmo formato das outras
fases, quando chegar a vez.

## Tomadas repetidas depois das legendas

- Entrada: os blocos aceitos da última correção (ou o `.srt` da faixa nova).
- Junta os blocos em frases (pontuação final + pausa entre blocos) e compara frases vizinhas
  (até 3 de distância) por semelhança de tokens normalizados (≥ 0,7).
- A ocorrência anterior ganha o marcador `eve-cut · repetição`, com a frase no comentário.
- Confirmar corta com o mesmo fluxo da F2 (backup + cortes do fim para o começo). A checagem de
  segurança passa a aceitar a faixa de legenda, e o corte leva junto as legendas do trecho.
- Precisa de uma prova antes: o corte com ripple remove e desloca os itens da faixa de legenda?

## Glossário no Eve Hub

- Depende de uma feature no Hub (repositório `EveCompany-dev/evehub`, pelo fluxo `/feature-evehub`):
  - um lugar para o perfil de legenda do cliente (glossário, termos protegidos, tom), por exemplo um
    campo JSON no `Client` ou uma tabela `ClientSubtitleProfile`;
  - ferramentas MCP de leitura e escrita (`get_client_subtitle_profile`,
    `update_client_subtitle_profile`), com a escrita confirmada pela pessoa como as outras
    ferramentas de escrita do Hub;
  - exibição e edição no Acervo do cliente.
- Do lado do eve-cut: "Exportar" vira "Enviar ao Hub", e ao abrir o perfil ele compara com o Hub e
  oferece puxar o que mudou lá.

## Migração para UXP

- Gatilho: o UXP do Premiere ganhar leitura e escrita de legendas e corte (razor). Acompanhar as
  notas de API de cada versão no fórum de desenvolvedores da Adobe.
- Trabalho: `UxpAdapter` com a mesma interface do `PremiereAdapter`, e a ponte vira um processo
  separado (plugin UXP só pode ser cliente de WebSocket), iniciado pelo mcp-server ou pelo instalador.
