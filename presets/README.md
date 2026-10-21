# presets

Presets de exportação (`.epr`) usados por script. Foram criados pelo José no Premiere 26.5.2
(Arquivo → Exportar → Mídia, formato "Forma de onda de áudio", salvar preset) em 21/10/2026. Não
edite à mão: para mudar, crie de novo no Premiere e substitua o arquivo.

| arquivo | para quê | configuração |
|---|---|---|
| `eve-cut-audio.epr` | exportar o áudio da sequência para a detecção de suspiros (P5, F2) | WAV, 48 kHz, 16 bits, mono |
| `eve-cut-legendas.epr` | exportar as legendas em `.srt` por script (P1, F1-08) | igual ao de cima + aba Legendas → "Create Sidecar File", SubRip (.srt), faixa C1, "Incluir SRT Styling" desmarcado |

O build do painel copia os `.epr` para `dist/presets/`; o painel usa a cópia que vai junto da
extensão instalada.
