# PowerShell 5.1+: end users only need Docker Desktop and the Windows shell.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:RepoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$script:RuntimeCompose = Join-Path $script:RepoRoot 'deploy/compose.yaml'
$script:Services = @('editor-api', 'import-worker', 'export-worker', 'render-sync-worker', 'enc-import-worker', 'tile-server')

function Write-Utf8([string]$Path, [string]$Content) {
    [IO.File]::WriteAllText($Path, $Content, (New-Object Text.UTF8Encoding($false)))
}
function Read-Json([string]$Path) { Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json }
function Read-JsonContent([string]$Content) { return ,($Content | ConvertFrom-Json) }
function Write-Json([string]$Path, $Value) { Write-Utf8 $Path ($Value | ConvertTo-Json -Depth 20) }
function Read-Env([string]$Path) {
    $values = @{}
    if (Test-Path -LiteralPath $Path) {
        foreach ($line in [IO.File]::ReadAllLines($Path)) {
            if ($line -match '^([A-Z_][A-Z_0-9]*)=(.*)$') { $values[$matches[1]] = $matches[2] }
        }
    }
    return $values
}
function Invoke-Docker {
    param([Parameter(ValueFromRemainingArguments=$true)][string[]]$DockerArgs)
    & docker @DockerArgs
    if ($LASTEXITCODE -ne 0) { throw "Docker command failed (exit $LASTEXITCODE). See the message above." }
}
function Get-Docker {
    param([Parameter(ValueFromRemainingArguments=$true)][string[]]$DockerArgs)
    $lines = @(& docker @DockerArgs)
    if ($LASTEXITCODE -ne 0) { throw "Docker command failed (exit $LASTEXITCODE)." }
    return ($lines -join "`n").Trim()
}
function Test-Image([string]$Reference) {
    # Missing images are expected before an online build/pull. PS5 can turn
    # redirected native stderr into errors unless this branch permits them.
    $ErrorActionPreference = 'Continue'
    & docker image inspect $Reference *> $null
    return ($LASTEXITCODE -eq 0)
}
function Assert-Docker {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Install Docker Desktop, enable Linux containers and open Docker Desktop, then run Setup.cmd again.' }
    $osType = Get-Docker -DockerArgs @('info', '--format', '{{.OSType}}')
    if ($osType -ne 'linux') { throw 'Switch Docker Desktop to Linux containers.' }
    Invoke-Docker -DockerArgs @('compose', 'version')
}
function Get-ComposeArgs([string]$ComposeFile = $script:RuntimeCompose, [string]$ProjectName = '') {
    $result = @('compose', '--file', $ComposeFile)
    $envPath = Join-Path (Split-Path -Parent $ComposeFile) '.env'
    if (Test-Path -LiteralPath $envPath) { $result += @('--env-file', $envPath) }
    if ($ProjectName) {
        if ($ProjectName -notmatch '^[a-z0-9][a-z0-9_-]*$') { throw 'ProjectName must use lowercase letters, digits, underscores or hyphens.' }
        $result += @('--project-name', $ProjectName)
    }
    return $result
}
function Get-Container([string[]]$ComposeArgs, [string]$Service) {
    return Get-Docker -DockerArgs ($ComposeArgs + @('ps', '-q', $Service))
}
function Invoke-Sql([string]$Container, [string]$Database, [string]$Sql) {
    return Get-Docker -DockerArgs @('exec', $Container, 'psql', '-X', '-U', 'postgres', '-d', $Database, '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', $Sql)
}
function Get-ImageConfig {
    return @{
        APP_IMAGE='ms-editor/app:local'; OSM_WORKER_IMAGE='ms-editor/osm-worker:local'
        RENDER_WORKER_IMAGE='ms-editor/render-worker:local'; ENC_WORKER_IMAGE='ms-editor/enc-worker:local'
        POSTGIS_IMAGE='postgis/postgis@sha256:8d6a1acd2a491f8c1db758cf6515e7b2ac3d04269eb0aefe6fa497c6971102b7'
        TILE_SERVER_IMAGE='ghcr.io/nvlhuongnoi2005/webgis/tile-server@sha256:7540d6ae6016efb35cecf33d30343236fd6d76ec02ff5afdc8a9dbd49f2ff7d5'
    }
}
function New-Secret {
    $bytes = New-Object byte[] 24
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes) } finally { $random.Dispose() }
    return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}
function Test-Port([int]$Port) {
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $Port)
    try { $listener.Start(); return $true } catch { return $false } finally { $listener.Stop() }
}
function Initialize-Config([int]$Port = 0, [string]$ProjectName = '') {
    $path = Join-Path $script:RepoRoot 'deploy/.env'
    if (Test-Path -LiteralPath $path) {
        $existing = Read-Env $path
        if ($Port -and $Port -ne [int]$existing.EDITOR_API_PORT) { throw 'This installation already has a port. Edit deploy/.env to change it.' }
        if ($ProjectName -and $ProjectName -ne $existing.COMPOSE_PROJECT_NAME) { throw 'Use a separate copy of the release folder for another installation.' }
        return
    }
    if (-not $ProjectName) { $ProjectName = 'ms-editor' }
    if ($ProjectName -notmatch '^[a-z0-9][a-z0-9_-]*$') { throw 'Invalid project name.' }
    if ($Port -and (-not (Test-Port $Port))) { throw "Port $Port is busy." }
    if (-not $Port) {
        $Port = 4173
        while ($Port -lt 4273 -and (-not (Test-Port $Port))) { $Port++ }
        if ($Port -eq 4273) { throw 'No free application port. Supply -Port.' }
    }
    $values = Get-ImageConfig
    $imagesPath = Join-Path $script:RepoRoot 'deploy/images.env'
    if (Test-Path -LiteralPath $imagesPath) { $values = Read-Env $imagesPath }
    $values.COMPOSE_PROJECT_NAME = $ProjectName
    $values.EDITOR_API_PORT = $Port
    foreach ($name in @('POSTGRES_PASSWORD','CANONICAL_DB_PASSWORD','RENDER_DB_PASSWORD','ENC_DB_PASSWORD')) { $values[$name] = New-Secret }
    $lines = foreach ($key in ($values.Keys | Sort-Object)) { "$key=$($values[$key])" }
    Write-Utf8 $path (($lines -join "`n") + "`n")
}
function Initialize-DataDirectories {
    foreach ($path in @('data/imports','data/exports','data/enc/uploads','data/runtime/tiles')) {
        [IO.Directory]::CreateDirectory((Join-Path $script:RepoRoot $path)) | Out-Null
    }
}
function Wait-Postgres([string[]]$ComposeArgs) {
    $container = Get-Container $ComposeArgs 'postgres'
    if (-not $container) { throw 'PostgreSQL container was not started.' }
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        $status = Get-Docker -DockerArgs @('inspect', '--format', '{{.State.Health.Status}}', $container)
        if ($status -eq 'healthy') { return $container }
        if ($status -eq 'unhealthy') { break }
        Start-Sleep -Seconds 2
    }
    Invoke-Docker -DockerArgs ($ComposeArgs + @('logs', '--tail', '60', 'postgres'))
    throw 'PostgreSQL initialization failed.'
}
function Wait-Http([string]$Url, [int]$Attempts = 60) {
    for ($i = 0; $i -lt $Attempts; $i++) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -eq 200) { return }
        } catch { }
        Start-Sleep -Seconds 2
    }
    throw "Cannot reach $Url. Run Doctor.cmd and inspect service logs."
}
function Get-SafeChild([string]$Root, [string]$Relative) {
    if ([IO.Path]::IsPathRooted($Relative) -or $Relative -match '(^|[/\\])\.\.([/\\]|$)' -or $Relative.Contains(':')) { throw "Unsafe manifest path: $Relative" }
    $base = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $path = [IO.Path]::GetFullPath((Join-Path $base $Relative))
    if (-not $path.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { throw "Path escapes package: $Relative" }
    return $path
}
function Get-Inventory([string]$Root, [string[]]$Exclude = @('manifest.json')) {
    $base = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $files = @(Get-ChildItem -LiteralPath $Root -Recurse -File -Force)
    foreach ($file in $files) {
        if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Symbolic links are not supported in a release: $($file.FullName)" }
        $relative = $file.FullName.Substring($base.Length).Replace([IO.Path]::DirectorySeparatorChar, [char]'/')
        if ($relative -in $Exclude) { continue }
        [ordered]@{path=$relative; bytes=$file.Length; sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
    }
}
function Assert-Inventory([string]$Root, $Files) {
    foreach ($file in $Files) {
        $path = Get-SafeChild $Root $file.path
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Package file missing: $($file.path)" }
        if ((Get-Item -LiteralPath $path).Length -ne $file.bytes -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) {
            throw "Package checksum mismatch: $($file.path). Copy the complete release again."
        }
    }
}
function Copy-Tree([string]$Source, [string]$Destination) {
    if (-not (Test-Path -LiteralPath $Source)) { return }
    [IO.Directory]::CreateDirectory($Destination) | Out-Null
    $base = [IO.Path]::GetFullPath($Source).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    foreach ($file in @(Get-ChildItem -LiteralPath $Source -Recurse -File -Force)) {
        if ($file.Name -match '(-wal|-shm|-journal)$') { continue }
        $target = Get-SafeChild $Destination $file.FullName.Substring($base.Length)
        [IO.Directory]::CreateDirectory((Split-Path -Parent $target)) | Out-Null
        Copy-Item -LiteralPath $file.FullName -Destination $target
    }
}
