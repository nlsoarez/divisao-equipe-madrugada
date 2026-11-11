[CmdletBinding()]
param(
    [string]$HostIp = '163.176.155.119',
    [string]$RemoteUser = 'ubuntu',
    [string]$KeyFile = 'C:\Users\nlsoa\.ssh\dashboard-oci-20260808',
    [string]$Domain = 'divisao.163-176-155-119.sslip.io',
    [string]$AppContainer = 'divisao-equipe-madrugada',
    [string]$DockerNetwork = 'dashboard-indicadores-cop_default',
    [string]$AppEnvFile = '/opt/divisao/.env',
    [string]$AppDataDir = '/opt/divisao/data',
    [string]$CaddyContainer = 'dashboard-indicadores-cop-caddy-1'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$remoteScript = Join-Path $PSScriptRoot 'update-existing-vm.sh'
if (-not (Test-Path -LiteralPath $remoteScript)) { throw "Atualizador remoto nao encontrado: $remoteScript" }
if (-not (Test-Path -LiteralPath $KeyFile)) { throw "Chave SSH nao encontrada: $KeyFile" }

$dirty = & git -C $repositoryRoot status --porcelain
if ($dirty) { throw 'O deploy usa o commit atual e o repositorio possui alteracoes nao commitadas.' }

$revision = (& git -C $repositoryRoot rev-parse --short=12 HEAD).Trim()
if (-not $revision) { throw 'Nao foi possivel identificar o commit atual.' }
$imageTag = "divisao-equipe-madrugada:$revision"
$archivePath = Join-Path ([IO.Path]::GetTempPath()) "divisao-$revision.zip"
$remoteTarget = "$RemoteUser@$HostIp"

try {
    & git -C $repositoryRoot archive --format=zip --output=$archivePath HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao empacotar o commit atual.' }

    & scp.exe -q -i $KeyFile $archivePath "${remoteTarget}:/tmp/divisao-update.zip"
    if ($LASTEXITCODE -ne 0) { throw "Falha ao copiar o codigo (scp: $LASTEXITCODE)." }
    & scp.exe -q -i $KeyFile $remoteScript "${remoteTarget}:/tmp/update-divisao-existing-vm.sh"
    if ($LASTEXITCODE -ne 0) { throw "Falha ao copiar o atualizador (scp: $LASTEXITCODE)." }

    & ssh.exe -T -o BatchMode=yes -i $KeyFile $remoteTarget sudo bash /tmp/update-divisao-existing-vm.sh `
        $imageTag $AppContainer $DockerNetwork $AppEnvFile $AppDataDir $CaddyContainer $Domain
    if ($LASTEXITCODE -ne 0) { throw "Atualizacao falhou e solicitou rollback (ssh: $LASTEXITCODE)." }
}
finally {
    if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath -Force }
}

Write-Host "Atualizacao validada: $imageTag" -ForegroundColor Green

