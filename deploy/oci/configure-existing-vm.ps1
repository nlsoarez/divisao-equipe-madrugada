[CmdletBinding()]
param(
    [string]$HostIp = '163.176.155.119',
    [string]$RemoteUser = 'ubuntu',
    [string]$KeyFile = 'C:\Users\nlsoa\.ssh\dashboard-oci-20260808',
    [string]$Domain = 'divisao.163-176-155-119.sslip.io',
    [string]$ImageTag = 'divisao-equipe-madrugada:34511a9',
    [string]$DockerNetwork = 'dashboard-indicadores-cop_default',
    [string]$CaddyContainer = 'dashboard-indicadores-cop-caddy-1',
    [string]$CaddyfilePath = '/opt/dashboard/releases/4f676b7/deploy/Caddyfile',
    [string]$SupabaseUrl = 'https://aaxdcpftynjphzitigrv.supabase.co',
    [switch]$ReuseExistingSupabaseConfig,
    [switch]$ReuseExistingAdminPassword
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

$remoteScript = Join-Path $PSScriptRoot 'configure-existing-vm.sh'
if (-not (Test-Path -LiteralPath $remoteScript)) {
    throw "Instalador remoto nao encontrado: $remoteScript"
}
if (-not (Test-Path -LiteralPath $KeyFile)) {
    throw "Chave SSH nao encontrada: $KeyFile"
}

Write-Host ''
Write-Host 'Configuracao segura do Divisao Equipe Madrugada na OCI' -ForegroundColor Cyan
Write-Host 'Os valores secretos nao aparecem na tela e nao serao salvos no Git.' -ForegroundColor DarkGray
Write-Host ''

$secretSecure = $null
$secretPlain = $null
if (-not $ReuseExistingSupabaseConfig) {
    do {
        $secretSecure = Read-Host 'Cole a Supabase Secret key (sb_secret_...)' -AsSecureString
        $secretPlain = (ConvertFrom-SecureValue $secretSecure) -replace '\s', ''
        if (-not $secretPlain.StartsWith('sb_secret_')) {
            Write-Host 'Chave invalida. Use a Secret key, nao a publishable/anon key.' -ForegroundColor Yellow
        }
    } until ($secretPlain.StartsWith('sb_secret_'))
}
else {
    Write-Host 'Reutilizando a configuracao Supabase segura existente na VM.' -ForegroundColor DarkGray
}

$passwordSecure = $null
$passwordConfirmSecure = $null
$passwordPlain = $null
if (-not $ReuseExistingAdminPassword) {
    do {
        $passwordSecure = Read-Host 'Crie a senha de acesso administrativo (minimo 12 caracteres)' -AsSecureString
        $passwordConfirmSecure = Read-Host 'Repita a senha administrativa' -AsSecureString
        $passwordPlain = ConvertFrom-SecureValue $passwordSecure
        $passwordConfirmPlain = ConvertFrom-SecureValue $passwordConfirmSecure
        $passwordIsValid = $passwordPlain.Length -ge 12 -and $passwordPlain -ceq $passwordConfirmPlain
        if (-not $passwordIsValid) {
            Write-Host 'As senhas nao coincidem ou possuem menos de 12 caracteres.' -ForegroundColor Yellow
        }
        $passwordConfirmPlain = $null
    } until ($passwordIsValid)
}
else {
    Write-Host 'Reutilizando a senha administrativa ja configurada no Caddy.' -ForegroundColor DarkGray
}

$remoteTarget = '{0}@{1}:/tmp/configure-divisao.sh' -f $RemoteUser, $HostIp
Write-Host ''
Write-Host 'Enviando o instalador para a VM...' -ForegroundColor Cyan
& scp.exe -q -i $KeyFile $remoteScript $remoteTarget
if ($LASTEXITCODE -ne 0) {
    throw "Falha ao enviar o instalador (scp: $LASTEXITCODE)."
}

$sshArguments = @(
    '-T',
    '-o', 'BatchMode=yes',
    '-i', $KeyFile,
    ('{0}@{1}' -f $RemoteUser, $HostIp),
    'sudo', 'bash', '/tmp/configure-divisao.sh',
    $Domain,
    $ImageTag,
    $DockerNetwork,
    $CaddyContainer,
    $CaddyfilePath,
    $SupabaseUrl,
    $ReuseExistingSupabaseConfig.IsPresent.ToString().ToLowerInvariant(),
    $ReuseExistingAdminPassword.IsPresent.ToString().ToLowerInvariant()
)

$processInfo = New-Object Diagnostics.ProcessStartInfo
$processInfo.FileName = 'ssh.exe'
$processInfo.Arguments = (($sshArguments | ForEach-Object { Quote-NativeArgument $_ }) -join ' ')
$processInfo.UseShellExecute = $false
$processInfo.RedirectStandardInput = $true

Write-Host 'Configurando banco, container, HTTPS e acesso administrativo...' -ForegroundColor Cyan
$process = [Diagnostics.Process]::Start($processInfo)
$process.StandardInput.NewLine = "`n"
if (-not $ReuseExistingSupabaseConfig) {
    $process.StandardInput.WriteLine($secretPlain)
}
if (-not $ReuseExistingAdminPassword) {
    $process.StandardInput.WriteLine($passwordPlain)
}
$process.StandardInput.Close()

$secretPlain = $null
$passwordPlain = $null
if ($null -ne $secretSecure) {
    $secretSecure.Dispose()
}
if ($null -ne $passwordSecure) {
    $passwordSecure.Dispose()
}
if ($null -ne $passwordConfirmSecure) {
    $passwordConfirmSecure.Dispose()
}

$process.WaitForExit()
if ($process.ExitCode -ne 0) {
    throw "Implantacao falhou na VM (ssh: $($process.ExitCode))."
}

Write-Host ''
Write-Host "Consulta publica: https://$Domain/" -ForegroundColor Green
Write-Host "Administracao: https://$Domain/admin" -ForegroundColor Green
Write-Host 'Usuario administrativo: operacao' -ForegroundColor Green
if ($ReuseExistingAdminPassword) {
    Write-Host 'Use a senha administrativa ja configurada.' -ForegroundColor Green
}
else {
    Write-Host 'Use a senha que voce acabou de criar.' -ForegroundColor Green
}
