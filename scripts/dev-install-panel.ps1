# eve-cut - instala o build de desenvolvimento do painel no Premiere deste PC.
#
# Uso: pnpm dev:panel
#   1. liga o PlayerDebugMode do CEP (extensao nao assinada nao carrega sem isso)
#   2. copia packages/panel/dist para %APPDATA%\Adobe\CEP\extensions\eve-cut

$ErrorActionPreference = 'Stop'

$source = Join-Path $PSScriptRoot '..\packages\panel\dist'
$dest = Join-Path $env:APPDATA 'Adobe\CEP\extensions\eve-cut'

if (-not (Test-Path (Join-Path $source 'index.html'))) {
    throw "Build do painel nao encontrado em $source. Rode pnpm build primeiro."
}

Write-Host ''
Write-Host '  eve-cut - instalacao de desenvolvimento' -ForegroundColor Cyan
Write-Host ''

foreach ($v in 9..13) {
    $key = "HKCU:\Software\Adobe\CSXS.$v"
    if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
    Set-ItemProperty -Path $key -Name 'PlayerDebugMode' -Value '1' -Type String
}
Write-Host '  [ok] PlayerDebugMode habilitado (CSXS 9-13)' -ForegroundColor Green

if (Test-Path $dest) {
    Remove-Item $dest -Recurse -Force
}
New-Item -ItemType Directory -Path $dest -Force | Out-Null
Copy-Item (Join-Path $source '*') -Destination $dest -Recurse -Force
Write-Host "  [ok] Painel copiado para $dest" -ForegroundColor Green

Write-Host ''
Write-Host '  Agora:' -ForegroundColor Cyan
Write-Host '    1. Feche o Premiere Pro e abra de novo'
Write-Host '    2. Menu  Janela > Extensoes > eve-cut'
Write-Host '    3. DevTools em http://localhost:8088'
Write-Host ''
