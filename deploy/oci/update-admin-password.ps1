[CmdletBinding()]
param(
    [string]$HostIp = '163.176.155.119',
    [string]$RemoteUser = 'ubuntu',
    [string]$KeyFile = 'C:\Users\nlsoa\.ssh\dashboard-oci-20260808',
    [string]$AppContainer = 'divisao-equipe-madrugada',
    [string]$CaddyContainer = 'dashboard-indicadores-cop-caddy-1',
    [string]$AppEnvFile = '/opt/divisao/.env',
    [string]$DockerNetwork = 'dashboard-indicadores-cop_default',
    [string]$AppDataDir = '/opt/divisao/data'
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
        if ($pointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        }
    }
}

function Quote-NativeArgument {
    param([Parameter(Mandatory)][string]$Value)
    return '"' + $Value.Replace('"', '\"') + '"'
}

$remoteScript = Join-Path $PSScriptRoot 'update-admin-password.sh'
if (-not (Test-Path -LiteralPath $remoteScript)) {
    throw "Atualizador remoto nao encontrado: $remoteScript"
}
if (-not (Test-Path -LiteralPath $KeyFile)) {
    throw "Chave SSH nao encontrada: $KeyFile"
}

do {
    $passwordSecure = Read-Host 'Digite a nova senha administrativa (minimo 12 caracteres)' -AsSecureString
    $passwordConfirmSecure = Read-Host 'Repita a nova senha administrativa' -AsSecureString
    $passwordPlain = ConvertFrom-SecureValue $passwordSecure
    $passwordConfirmPlain = ConvertFrom-SecureValue $passwordConfirmSecure
    $passwordIsValid = $passwordPlain.Length -ge 12 -and $passwordPlain -ceq $passwordConfirmPlain
    if (-not $passwordIsValid) {
        Write-Host 'As senhas nao coincidem ou possuem menos de 12 caracteres.' -ForegroundColor Yellow
    }
    $passwordConfirmPlain = $null
} until ($passwordIsValid)

$remoteTarget = '{0}@{1}:/tmp/update-divisao-admin-password.sh' -f $RemoteUser, $HostIp
Write-Host 'Enviando o atualizador seguro para a VM...' -ForegroundColor Cyan
& scp.exe -q -i $KeyFile $remoteScript $remoteTarget
if ($LASTEXITCODE -ne 0) {
    throw "Falha ao enviar o atualizador (scp: $LASTEXITCODE)."
}

$sshArguments = @(
    '-T',
    '-o', 'BatchMode=yes',
    '-i', $KeyFile,
    ('{0}@{1}' -f $RemoteUser, $HostIp),
    'sudo', 'bash', '/tmp/update-divisao-admin-password.sh',
    $AppContainer,
    $CaddyContainer,
    $AppEnvFile,
    $DockerNetwork,
    $AppDataDir
)

$processInfo = New-Object Diagnostics.ProcessStartInfo
$processInfo.FileName = 'ssh.exe'
$processInfo.Arguments = (($sshArguments | ForEach-Object { Quote-NativeArgument $_ }) -join ' ')
$processInfo.UseShellExecute = $false
$processInfo.RedirectStandardInput = $true

Write-Host 'Atualizando e validando a senha administrativa...' -ForegroundColor Cyan
$process = [Diagnostics.Process]::Start($processInfo)
$process.StandardInput.NewLine = "`n"
$process.StandardInput.WriteLine($passwordPlain)
$process.StandardInput.Close()

$passwordPlain = $null
$passwordSecure.Dispose()
$passwordConfirmSecure.Dispose()

$process.WaitForExit()
if ($process.ExitCode -ne 0) {
    throw "Atualizacao da senha falhou na VM (ssh: $($process.ExitCode))."
}

Write-Host 'Senha administrativa atualizada e validada.' -ForegroundColor Green
