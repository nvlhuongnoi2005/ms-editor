param()
. "$PSScriptRoot/common.ps1"
Assert-Docker
$envPath = Join-Path $script:RepoRoot 'deploy/.env'
if (-not (Test-Path -LiteralPath $envPath)) { throw 'Run Setup.cmd first.' }
$envValues = Read-Env $envPath
$compose = @(Get-ComposeArgs)
foreach ($service in (@('postgres') + $script:Services)) {
    $container = Get-Container $compose $service
    if (-not $container) { throw "Service is not running: $service. Run Start.cmd." }
    $info = (Read-JsonContent (Get-Docker -DockerArgs @('inspect', $container)))[0]
    if (-not $info.State.Running) { throw "Service is not running: $service" }
    if ($info.State.PSObject.Properties['Health'] -and $info.State.Health.Status -ne 'healthy') { throw "Service is not healthy: $service" }
    if ($info.RestartCount -gt 0) { Write-Warning "$service has restarted $($info.RestartCount) time(s); check Logs.cmd if this continues." }
    Write-Host "OK service: $service"
}
$base = 'http://127.0.0.1:' + $envValues.EDITOR_API_PORT
foreach ($path in @('/', '/healthz', '/api/datasets', '/api/enc/datasets', '/enc/assets/sprites/day_simplified@2x.json', '/enc/assets/sprites/day_simplified@2x.png', '/enc/assets/fonts/Roboto%20Bold/0-255.pbf', '/datas/satellite2.json')) {
    Wait-Http ($base + $path) 20
    Write-Host "OK HTTP: $path"
}
$container = Get-Container $compose 'postgres'
$expectedMigrations = @(Get-ChildItem -LiteralPath (Join-Path $script:RepoRoot 'infra/init') -Filter '*.sql' | Where-Object { $_.Name -match '^[0-9][0-9]-' -and [int]$_.Name.Substring(0,2) -ge 3 }).Count
if ([int](Invoke-Sql $container 'postgres' 'SELECT count(*) FROM public.map_service_migration') -ne $expectedMigrations) { throw 'Database migration ledger is incomplete.' }
# These are readiness checks, not just process checks: both DBs and the S-57
# driver must be usable, and the ENC consumer must own its queue lock.
$encQueue = Invoke-Sql $container 'enc_canonical' "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=713480191 AND granted)"
if ($encQueue -ne 't') { throw 'ENC import worker has not acquired its queue lock.' }
$encContainer = Get-Container $compose 'enc-import-worker'
Invoke-Docker -DockerArgs @('exec', $encContainer, 'python3', '-c', 'from osgeo import gdal; assert gdal.GetDriverByName(''S57'') is not None')
$online = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $imports = Invoke-RestMethod -Uri ($base + '/api/imports') -TimeoutSec 5
    if ($imports.workerOnline) { $online = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $online) { throw 'OSM import worker heartbeat is missing. Check Logs.cmd.' }
$exportOnline = Invoke-Sql $container 'canonical' "SELECT EXISTS(SELECT 1 FROM editor.export_worker_status WHERE heartbeat_at > now()-interval '30 seconds')"
if ($exportOnline -ne 't') { throw 'OSM export worker heartbeat is missing. Check Logs.cmd.' }
Write-Host 'OK import consumers: OSM heartbeat, ENC queue and GDAL S-57 driver'
Write-Host "System checks passed. Open $base"
