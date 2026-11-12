param([ValidateSet('start','stop','logs')][string]$Action = 'start', [switch]$NoBrowser)
. "$PSScriptRoot/common.ps1"
Assert-Docker
if (-not (Test-Path (Join-Path $script:RepoRoot 'deploy/.env'))) { throw 'Run Setup.cmd first.' }
$compose = @(Get-ComposeArgs)
switch ($Action) {
    'stop' { Invoke-Docker -DockerArgs ($compose + @('stop')); Write-Host 'Stopped. Uploaded datasets are preserved.' }
    'logs' { Invoke-Docker -DockerArgs ($compose + @('logs', '--tail', '100')) }
    'start' {
        Invoke-Docker -DockerArgs ($compose + @('up', '-d', '--pull', 'never', '--wait', '--wait-timeout', '180'))
        & "$PSScriptRoot/doctor.ps1"
        $values = Read-Env (Join-Path $script:RepoRoot 'deploy/.env')
        if (-not $NoBrowser) { Start-Process ('http://127.0.0.1:' + $values.EDITOR_API_PORT) }
    }
}
