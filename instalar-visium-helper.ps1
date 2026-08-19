param(
  [string]$CentralBackendUrl = $env:CENTRAL_BACKEND_URL,
  [string]$BasicAuthUser = $env:CENTRAL_BACKEND_AUTH_USER
)

$ErrorActionPreference = "Stop"

$repoRef = if ($env:VISIUM_HELPER_REF) { $env:VISIUM_HELPER_REF } else { "main" }
$repoRaw = "https://raw.githubusercontent.com/nlsoarez/divisao-equipe-madrugada/$repoRef"
$cacheBust = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$destino = Join-Path $env:USERPROFILE "visium-helper"
$backend = Join-Path $destino "backend"

if ([string]::IsNullOrWhiteSpace($CentralBackendUrl)) {
  $CentralBackendUrl = Read-Host "Informe a URL HTTPS do backend OCI (ex.: https://painel.exemplo.com)"
}

if ($CentralBackendUrl -notmatch '^https://[^/]+') {
  Write-Host "URL invalida. O helper exige o dominio HTTPS do backend OCI." -ForegroundColor Red
  exit 1
}

$CentralBackendUrl = $CentralBackendUrl.TrimEnd('/')

if ([string]::IsNullOrWhiteSpace($BasicAuthUser)) {
  $BasicAuthUser = Read-Host "Informe o usuario Basic Auth do painel OCI"
}

$securePassword = Read-Host "Informe a senha Basic Auth do painel OCI" -AsSecureString
$passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr)
  if ([string]::IsNullOrWhiteSpace($plainPassword)) {
    Write-Host "Senha Basic Auth vazia." -ForegroundColor Red
    exit 1
  }
  $basicAuthToken = [Convert]::ToBase64String(
    [Text.Encoding]::UTF8.GetBytes("${BasicAuthUser}:${plainPassword}")
  )
}
finally {
  if ($passwordPtr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr)
  }
  $plainPassword = $null
}

Write-Host ""
Write-Host "Instalando helper local do Visium em: $destino" -ForegroundColor Cyan
Write-Host "Origem: $repoRef" -ForegroundColor DarkGray

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "Node.js nao encontrado." -ForegroundColor Red
  Write-Host "Instale o Node.js LTS em https://nodejs.org/ e rode este instalador novamente."
  exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "npm nao encontrado. Reinstale o Node.js LTS marcando npm." -ForegroundColor Red
  exit 1
}

New-Item -ItemType Directory -Force -Path $backend | Out-Null

Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like "*local-visium-helper.js*" } |
  ForEach-Object {
    Write-Host "Encerrando helper antigo (PID $($_.ProcessId))..." -ForegroundColor Yellow
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

Invoke-WebRequest "$repoRaw/backend/local-visium-helper.js?v=$cacheBust" -OutFile (Join-Path $backend "local-visium-helper.js")
Invoke-WebRequest "$repoRaw/backend/topologia.js?v=$cacheBust" -OutFile (Join-Path $backend "topologia.js")
Invoke-WebRequest "$repoRaw/backend/package.json?v=$cacheBust" -OutFile (Join-Path $backend "package.json")
Invoke-WebRequest "$repoRaw/backend/package-lock.json?v=$cacheBust" -OutFile (Join-Path $backend "package-lock.json")

$bat = Join-Path $destino "iniciar-visium-helper.bat"
@"
@echo off
cd /d "%USERPROFILE%\visium-helper\backend"
set CENTRAL_BACKEND_URL=$CentralBackendUrl
set CENTRAL_BACKEND_AUTH_TOKEN=$basicAuthToken
set CENTRAL_BACKEND_TLS_INSEGURO=0
set NODE_TLS_REJECT_UNAUTHORIZED=1
set VISIUM_LOGIN_URL=http://201.55.234.76/
set VISIUM_BASE_URL=http://201.55.234.76/Consultas_/ConsultaInterfaceNode
set VISIUM_GPON_LOGIN_URL=http://201.55.234.76:8080/Login
set VISIUM_GPON_CONSULTA_URL=http://201.55.234.76:8080/ConsultasGPON_/ConsultaOntLista
npm run visium-helper
pause
"@ | Set-Content -Encoding ASCII $bat

Write-Host ""
Write-Host "Instalando dependencias..." -ForegroundColor Cyan
Push-Location $backend
npm install --omit=dev
Pop-Location

Write-Host ""
Write-Host "Instalacao concluida." -ForegroundColor Green
Write-Host "Para usar:"
Write-Host "1. Conecte a VPN nessa maquina."
Write-Host "2. Abra: $bat"
Write-Host "3. Deixe a janela aberta."
Write-Host "4. No site, clique em Testar incidentes."
Write-Host ""
Write-Host "Iniciando helper agora..." -ForegroundColor Cyan
Start-Process -FilePath $bat
