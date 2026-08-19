[CmdletBinding()]
param(
    [string]$HostIp = '163.176.155.119',
    [string]$RemoteUser = 'ubuntu',
    [string]$KeyFile = 'C:\Users\nlsoa\.ssh\dashboard-oci-20260808'
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

$remoteScript = Join-Path $PSScriptRoot 'update-supabase-secret.sh'
if (-not (Test-Path -LiteralPath $remoteScript)) {
    throw "Atualizador remoto nao encontrado: $remoteScript"
}
if (-not (Test-Path -LiteralPath $KeyFile)) {
    throw "Chave SSH nao encontrada: $KeyFile"
}

Write-Host ''
Write-Host 'Correcao segura da Secret key do Supabase' -ForegroundColor Cyan
Write-Host 'Projeto correto: divisao-equipe-madrugada (aaxdcpftynjphzitigrv)' -ForegroundColor DarkGray
Write-Host ''

do {
    $secretSecure = Read-Host 'Cole a Secret key correta (sb_secret_...)' -AsSecureString
    $secretPlain = (ConvertFrom-SecureValue $secretSecure) -replace '\s', ''
    if (-not $secretPlain.StartsWith('sb_secret_')) {
        Write-Host 'Chave invalida. Use a Secret key, nao a publishable/anon key.' -ForegroundColor Yellow
    }
} until ($secretPlain.StartsWith('sb_secret_'))

$remoteTarget = '{0}@{1}:/tmp/update-divisao-supabase-secret.sh' -f $RemoteUser, $HostIp
& scp.exe -q -i $KeyFile $remoteScript $remoteTarget
if ($LASTEXITCODE -ne 0) {
    throw "Falha ao enviar o atualizador (scp: $LASTEXITCODE)."
}

$sshArguments = @(
    '-T',
    '-o', 'BatchMode=yes',
    '-i', $KeyFile,
    ('{0}@{1}' -f $RemoteUser, $HostIp),
    'sudo', 'bash', '/tmp/update-divisao-supabase-secret.sh'
)

$processInfo = New-Object Diagnostics.ProcessStartInfo
$processInfo.FileName = 'ssh.exe'
$processInfo.Arguments = (($sshArguments | ForEach-Object { Quote-NativeArgument $_ }) -join ' ')
$processInfo.UseShellExecute = $false
$processInfo.RedirectStandardInput = $true

Write-Host 'Atualizando a VM e validando /api/escala...' -ForegroundColor Cyan
$process = [Diagnostics.Process]::Start($processInfo)
$process.StandardInput.NewLine = "`n"
$process.StandardInput.WriteLine($secretPlain)
$process.StandardInput.Close()

$secretPlain = $null
$secretSecure.Dispose()

$process.WaitForExit()
if ($process.ExitCode -ne 0) {
    throw "A chave foi rejeitada; a configuracao anterior foi restaurada (ssh: $($process.ExitCode))."
}

Write-Host ''
Write-Host 'Supabase validado: leitura da escala confirmada pela API em producao.' -ForegroundColor Green
