# eve-cut

Painel para o Adobe Premiere Pro (Windows) que tira o trabalho repetitivo da edição de vídeos
falados dos clientes da Eve Company:

- **v1 — legendas:** corrige o texto das legendas geradas pelo Speech-to-Text do Premiere com o
  glossário e o tom de cada cliente, usando o Claude da assinatura (sem chave de API), com revisão
  bloco a bloco antes de aplicar;
- **v2 — limpeza:** marca suspiros e silêncios na timeline e, depois da confirmação, corta todos os
  marcados;
- **v3 — templates:** aplica o visual e o formato de legenda de cada cliente (MOGRT, estilo nativo,
  regras de formato, presets), puxando do Acervo do Eve Hub.

**Status:** planejamento. Ainda não há código. O desenvolvimento segue as fases em `docs/fases/`.

## Por onde começar

| arquivo | o que tem |
|---|---|
| [`AGENTS.md`](AGENTS.md) | regras para o agente que desenvolve (leia primeiro) |
| [`docs/SPEC.md`](docs/SPEC.md) | especificação completa |
| [`docs/DECISOES.md`](docs/DECISOES.md) | o que foi decidido e por quê |
| [`docs/REFERENCIAS-API.md`](docs/REFERENCIAS-API.md) | trechos de API: ExtendScript, CEP, Claude Code, MCP |
| [`docs/fases/`](docs/fases/) | tarefas por fase, com critério de aceite |
| [`docs/PROVAS.md`](docs/PROVAS.md) | resultados das provas técnicas (preenchido na F0) |
| [`docs/PENDENCIAS-JOSE.md`](docs/PENDENCIAS-JOSE.md) | o que só o José pode fazer |
| [`legacy/subtitle-fixer-panel/`](legacy/subtitle-fixer-panel/) | protótipo original (referência, não editar) |
