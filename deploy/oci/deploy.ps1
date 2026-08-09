param(
  [Parameter(Mandatory = $true)]
  [string]$HostIp,

  [string]$SshUser = "ubuntu",
  [string]$KeyFile,
  [string]$EnvironmentFile = "$PSScriptRoot\.env"
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$environmentPath = (Resolve-Path $EnvironmentFile).Path

foreach ($commandName in @("git", "ssh", "scp")) {
  if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) {
    throw "Comando obrigatorio nao encontrado: $commandName"
  }
}

$environmentText = Get-Content -Raw $environmentPath
if ($environmentText -match "troque-|substitua|example\.com") {
  throw "O arquivo de ambiente ainda contem placeholders. Corrija antes do deploy."
}

foreach ($requiredName in @("SITE_ADDRESS", "BASIC_AUTH_USER", "BASIC_AUTH_HASH", "SUPABASE_URL", "SUPABASE_SECRET_KEY")) {
  if ($environmentText -notmatch "(?m)^$requiredName=.+$") {
    throw "Variavel obrigatoria ausente ou vazia: $requiredName"
  }
}

$dirty = git -C $repositoryRoot status --porcelain
if ($dirty) {
  throw "O deploy usa o commit atual e o repositorio possui alteracoes nao commitadas."
}

$releaseId = Get-Date -Format "yyyyMMddHHmmss"
$archivePath = Join-Path ([System.IO.Path]::GetTempPath()) "divisao-madrugada-$releaseId.zip"
$remoteRoot = "/opt/divisao-equipe-madrugada"
$remoteRelease = "$remoteRoot/releases/$releaseId"
$remoteTarget = "$SshUser@$HostIp"

$sshOptions = @("-o", "StrictHostKeyChecking=accept-new")
if ($KeyFile) {
  $resolvedKey = (Resolve-Path $KeyFile).Path
  $sshOptions += @("-i", $resolvedKey)
}

try {
  git -C $repositoryRoot archive --format=zip --output=$archivePath HEAD
  if ($LASTEXITCODE -ne 0) { throw "Falha ao empacotar o commit atual." }

  & ssh @sshOptions $remoteTarget "sudo mkdir -p '$remoteRelease' && sudo chown -R '${SshUser}:${SshUser}' '$remoteRoot'"
  if ($LASTEXITCODE -ne 0) { throw "Falha ao preparar a release remota." }

  & scp @sshOptions $archivePath "${remoteTarget}:/tmp/divisao-madrugada.zip"
  if ($LASTEXITCODE -ne 0) { throw "Falha ao copiar o codigo." }

  & scp @sshOptions $environmentPath "${remoteTarget}:/tmp/divisao-madrugada.env"
  if ($LASTEXITCODE -ne 0) { throw "Falha ao copiar o ambiente." }

  $remoteCommand = @"
set -eu
unzip -q /tmp/divisao-madrugada.zip -d '$remoteRelease'
install -m 600 /tmp/divisao-madrugada.env '$remoteRelease/deploy/oci/.env'
cd '$remoteRelease/deploy/oci'
docker compose up -d --build --remove-orphans
ln -sfn '$remoteRelease' '$remoteRoot/current'
rm -f /tmp/divisao-madrugada.zip /tmp/divisao-madrugada.env
curl -fsS http://127.0.0.1/health
"@

  & ssh @sshOptions $remoteTarget $remoteCommand
  if ($LASTEXITCODE -ne 0) { throw "Deploy executado, mas o health check falhou." }

  Write-Host "Deploy concluido: release $releaseId"
}
finally {
  if (Test-Path $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
  }
}
