# Pendências do José

Coisas que o agente de desenvolvimento não consegue fazer sozinho. Em ordem de quando travam o
trabalho.

## Antes da F0-03 (trava o desenvolvimento)
- [ ] **Consertar a instalação do Premiere Pro 2026** neste PC. Em 20/10/2026 não havia Premiere
      instalado de forma reconhecível (nem no registro do Windows, nem em `C:\Program Files\Adobe`),
      só o Creative Cloud.
- [ ] Conferir que o Claude Code do terminal está logado na conta certa (`claude` → `/status`). Em
      20/10/2026 o `claude -p` respondeu "You've hit your weekly limit · resets Oct 23, 2am".

## Teste manual da F0-03 (painel mínimo)
- [ ] Com o Premiere instalado e fechado: `pnpm dev:panel` (build + cópia para
      `%APPDATA%\Adobe\CEP\extensions\eve-cut` + `PlayerDebugMode=1` em CSXS.9 a CSXS.13).
- [ ] Abrir o Premiere → Janela → Extensões → eve-cut. O painel abre com as abas Legendas,
      Limpeza (desativada, "em breve"), Clientes e ⚙, e o rodapé mostra `Premiere 26.x · <sequência>`.
      Sem projeto ou sequência aberta, o rodapé mostra `Premiere 26.x · sem sequência`.
- [ ] `http://localhost:8088` abre o DevTools do painel.

## Teste manual da F0-04 (ponte local)
- [ ] Com o Premiere e o painel eve-cut abertos, rodar `node scripts/bridge-ping.mjs`. Deve imprimir
      `Premiere 26.x · <sequência>` e o JSON do status, e sair com código 0.
- [ ] Fechar o painel e rodar de novo: deve aparecer uma mensagem dizendo que a ponte não foi
      encontrada (ou que não falou com ela), sem travar.

## Durante a F0-05
- [ ] Criar no Media Encoder e salvar em `presets/`:
  - `eve-cut-audio.epr`: WAV, 48 kHz, 16 bits, mono (P5);
  - `eve-cut-legendas.epr`: igual ao de cima + aba Legendas com "Criar arquivo sidecar" em SubRip
    (.srt) (P1).
- [ ] Rodar as provas P1 a P9 pela aba Lab (Ctrl+Shift+L) e preencher `docs/PROVAS.md`, seguindo o
      roteiro passo a passo que está no próprio arquivo.
- [ ] Separar um `.mogrt` de legenda qualquer, com texto editável (P8).

## Para testar a v1
- [ ] 2 ou 3 sequências reais com legendas geradas pelo Premiere (de preferência com erros
      conhecidos), mais o `.srt` corrigido à mão de uma delas, para comparar.

## Antes da F2
- [ ] Gravações de teste com gabarito de suspiros e silêncios (tarefa F2-00).

## Antes da F3
- [ ] Definir a pasta raiz dos templates e montar o pacote do cliente piloto (tarefa F3-00).
- [ ] Criar um token `evh_…` no Hub (Perfil → Acesso de agentes) para o eve-cut.

## Depois (F4)
- [ ] Abrir no evehub a feature do perfil de legenda por cliente (`/feature-evehub`).
