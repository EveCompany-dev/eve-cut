# Subtitle Fixer - instalador para Adobe Premiere Pro (Windows)
#
# Uso:  clique com o botao direito neste arquivo > "Executar com PowerShell"
#       ou:  powershell -ExecutionPolicy Bypass -File install.ps1
#
# O que ele faz:
#   1. Liga o PlayerDebugMode do CEP (necessario para extensoes nao assinadas)
#   2. Copia o painel para %APPDATA%\Adobe\CEP\extensions\com.eve.subtitlefixer

$ErrorActionPreference = 'Stop'

$source = $PSScriptRoot
$dest   = Join-Path $env:APPDATA 'Adobe\CEP\extensions\com.eve.subtitlefixer'

Write-Host ''
Write-Host '  Subtitle Fixer - instalacao' -ForegroundColor Cyan
Write-Host ''

# 1. PlayerDebugMode para todas as versoes de CEP instaladas
$versions = @('9','10','11','12')
foreach ($v in $versions) {
    $key = "HKCU:\Software\Adobe\CSXS.$v"
    if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
    Set-ItemProperty -Path $key -Name 'PlayerDebugMode' -Value '1' -Type String
}
Write-Host '  [ok] PlayerDebugMode habilitado (CSXS 9-12)' -ForegroundColor Green

# 2. Copia dos arquivos
if (Test-Path $dest) {
    Remove-Item $dest -Recurse -Force
}
New-Item -ItemType Directory -Path $dest -Force | Out-Null

$items = @('CSXS','css','js','jsx','profiles','icons','index.html','.debug')
foreach ($item in $items) {
    $src = Join-Path $source $item
    if (Test-Path $src) {
        Copy-Item $src -Destination $dest -Recurse -Force
    }
}
Write-Host "  [ok] Painel copiado para $dest" -ForegroundColor Green

Write-Host ''
Write-Host '  Feito. Agora:' -ForegroundColor Cyan
Write-Host '    1. Feche o Premiere Pro (se estiver aberto) e abra de novo'
Write-Host '    2. Menu  Janela > Extensoes > Subtitle Fixer'
Write-Host '    3. Na aba de configuracoes, cole a chave da API da Anthropic'
Write-Host ''
