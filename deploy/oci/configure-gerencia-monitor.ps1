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
    [string]$GroupId = '5521993571609-1390687807@g.us'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function ConvertFrom-SecureValue {
    param([Parameter(Mandatory)][Security.SecureString]$Value)
    $pointer = [IntPtr]::Zero
    try {
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    }
}

$remoteScript = Join-Path $PSScriptRoot 'configure-gerencia-monitor.sh'
if (-not (Test-Path -LiteralPath $remoteScript)) { throw "Configurador remoto nao encontrado: $remoteScript" }
if (-not (Test-Path -LiteralPath $KeyFile)) { throw "Chave SSH nao encontrada: $KeyFile" }

do {
    $passwordSecure = Read-Host 'Crie a senha exclusiva do Monitor da Gerencia (minimo 12 caracteres)' -AsSecureString
    $confirmSecure = Read-Host 'Repita a senha exclusiva' -AsSecureString
    $passwordPlain = ConvertFrom-SecureValue $passwordSecure
    $confirmPlain = ConvertFrom-SecureValue $confirmSecure
    $valid = $passwordPlain.Length -ge 12 -and $passwordPlain -ceq $confirmPlain
    $confirmPlain = $null
    if (-not $valid) { Write-Host 'As senhas nao coincidem ou possuem menos de 12 caracteres.' -ForegroundColor Yellow }
} until ($valid)

$remoteTarget = "$RemoteUser@$HostIp"
& scp.exe -q -i $KeyFile $remoteScript "${remoteTarget}:/tmp/configure-gerencia-monitor.sh"
if ($LASTEXITCODE -ne 0) { throw "Falha ao copiar o configurador (scp: $LASTEXITCODE)." }

$arguments = @(
    '-T', '-o', 'BatchMode=yes', '-i', $KeyFile, $remoteTarget,
    'sudo', 'bash', '/tmp/configure-gerencia-monitor.sh',
    $AppContainer, $DockerNetwork, $AppEnvFile, $AppDataDir, $Domain, $GroupId
)
$processInfo = [Diagnostics.ProcessStartInfo]::new()
$processInfo.FileName = 'ssh.exe'
$processInfo.ArgumentList.Clear()
foreach ($argument in $arguments) { [void]$processInfo.ArgumentList.Add($argument) }
$processInfo.UseShellExecute = $false
$processInfo.RedirectStandardInput = $true

$process = [Diagnostics.Process]::Start($processInfo)
$process.StandardInput.WriteLine($passwordPlain)
$process.StandardInput.Close()
$passwordPlain = $null
$passwordSecure.Dispose()
$confirmSecure.Dispose()
$process.WaitForExit()

if ($process.ExitCode -ne 0) {
    throw "Configuracao recusada ou restaurada pela VM (ssh: $($process.ExitCode))."
}
Write-Host 'Monitor configurado, validado e mantido desligado.' -ForegroundColor Green

