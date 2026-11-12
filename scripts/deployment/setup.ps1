param([int]$Port = 0, [string]$ProjectName = '', [switch]$NoBrowser)
. "$PSScriptRoot/common.ps1"
Assert-Docker
if ($Port -and ($Port -lt 1024 -or $Port -gt 65535)) { throw 'Port must be between 1024 and 65535.' }
$releasePath = Join-Path $script:RepoRoot 'release.json'
if (Test-Path -LiteralPath $releasePath) {
    $release = Read-Json $releasePath
    if ($release.format -ne 1 -or $release.type -ne 'map-service-system') { throw 'Unsupported release format.' }
    $arch = Get-Docker -DockerArgs @('info', '--format', '{{.Architecture}}')
    $arch = @{x86_64='amd64';aarch64='arm64';amd64='amd64';arm64='arm64'}[$arch]
    if ($arch -ne $release.architecture) { throw "This release is for $($release.architecture). Build a release on a machine matching the target architecture." }
    Write-Host 'Checking release files...'
    $inventory = Read-Json (Join-Path $script:RepoRoot 'checksums.json')
    Assert-Inventory $script:RepoRoot $inventory.files
    $loadImages = $false
    foreach ($image in $release.images) {
        $localId = @(& docker image ls --quiet --no-trunc $image.reference) -join ''
        if ($LASTEXITCODE -ne 0 -or $localId -ne $image.id) { $loadImages = $true; break }
    }
    if ($loadImages) {
        Write-Host 'Loading packaged Docker images. No download is required...'
        Invoke-Docker -DockerArgs @('load', '--input', (Join-Path $script:RepoRoot 'images.tar.gz'))
    }
    foreach ($image in $release.images) {
        if ((Get-Docker -DockerArgs @('image','inspect','--format','{{.Id}}',$image.reference)) -ne $image.id) { throw "Image mismatch: $($image.reference)" }
    }
}
Initialize-Config $Port $ProjectName
Initialize-DataDirectories
foreach ($name in @('config.json','seed.json','cleanup.json')) {
    $target = Join-Path $script:RepoRoot "data/runtime/tiles/$name"
    if (-not (Test-Path -LiteralPath $target)) { Copy-Item -LiteralPath (Join-Path $script:RepoRoot "deploy/tile-server/$name") -Destination $target }
}
$compose = @(Get-ComposeArgs)
if (-not (Test-Path -LiteralPath $releasePath)) {
    Write-Host 'Building the system from source (first setup needs Internet access)...'
    Invoke-Docker -DockerArgs ($compose + @('--file', (Join-Path $script:RepoRoot 'deploy/build.yaml'), 'build'))
    $imageConfig = Read-Env (Join-Path $script:RepoRoot 'deploy/.env')
    foreach ($key in @('POSTGIS_IMAGE','TILE_SERVER_IMAGE')) {
        if (-not (Test-Image $imageConfig[$key])) { Invoke-Docker -DockerArgs @('pull', $imageConfig[$key]) }
    }
}
Invoke-Docker -DockerArgs ($compose + @('up', '-d', '--pull', 'never', 'postgres'))
$container = Wait-Postgres $compose
Write-Host 'Applying database migrations...'
Invoke-Docker -DockerArgs @('exec', $container, 'bash', '/ops/migrate.sh')
Invoke-Docker -DockerArgs ($compose + @('up', '-d', '--pull', 'never', '--wait', '--wait-timeout', '180'))
& "$PSScriptRoot/doctor.ps1"
$envValues = Read-Env (Join-Path $script:RepoRoot 'deploy/.env')
$url = 'http://127.0.0.1:' + $envValues.EDITOR_API_PORT
Write-Json (Join-Path $script:RepoRoot 'deploy/.installed.json') ([ordered]@{url=$url;installed_at=[DateTime]::UtcNow.ToString('o')})
Write-Host "Ready: $url"
Write-Host 'Upload/manage OSM .osm.pbf and ENC .zip/.000 through the application. Existing datasets are preserved.'
if (-not $NoBrowser) { Start-Process $url }
