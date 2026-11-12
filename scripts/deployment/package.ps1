param([string]$Version = '', [string]$Output = '', [switch]$SkipBuild, [switch]$Resume)
. "$PSScriptRoot/common.ps1"
Assert-Docker
if (-not $Version) { $Version = Get-Date -Format 'yyyy.MM.dd-HHmmss' }
if ($Version -notmatch '^[a-z0-9][a-z0-9_.-]{0,100}$') { throw 'Version must be a valid lowercase Docker tag.' }
if (-not $Output) { $Output = Join-Path $script:RepoRoot "releases/ms-editor-$Version" }
$Output = [IO.Path]::GetFullPath($Output)
if (Test-Path -LiteralPath ($Output + '.zip')) { throw "Release ZIP already exists: $Output.zip" }
if ($Resume) {
    if (-not (Test-Path -LiteralPath (Join-Path $Output 'images.tar.gz')) -or (Test-Path -LiteralPath (Join-Path $Output 'release.json'))) {
        throw 'Resume requires an incomplete release folder with an image archive.'
    }
    # Loading validates the archive and restores its saved image tags.
    Invoke-Docker -DockerArgs @('load','--input',(Join-Path $Output 'images.tar.gz'))
} elseif (Test-Path -LiteralPath $Output) { throw "Release folder already exists: $Output" }
[IO.Directory]::CreateDirectory($Output) | Out-Null
$images = Get-ImageConfig
$sourceImages = Get-ImageConfig
foreach ($key in @('APP_IMAGE','OSM_WORKER_IMAGE','RENDER_WORKER_IMAGE','ENC_WORKER_IMAGE')) { $images[$key] = $images[$key] -replace ':local$', ":$Version" }
if ($Resume) { $images = Read-Env (Join-Path $Output 'deploy/images.env') }
if (-not $Resume) {
$buildEnv = [IO.Path]::GetTempFileName()
try {
    $buildConfig = @{}
    foreach ($key in $images.Keys) { $buildConfig[$key] = $images[$key] }
    foreach ($key in @('POSTGRES_PASSWORD','CANONICAL_DB_PASSWORD','RENDER_DB_PASSWORD','ENC_DB_PASSWORD')) { $buildConfig[$key] = New-Secret }
    Write-Utf8 $buildEnv ((@($buildConfig.Keys | Sort-Object | ForEach-Object { "$_=$($buildConfig[$_])" }) -join "`n") + "`n")
    if ($SkipBuild) {
        foreach ($key in @('APP_IMAGE','OSM_WORKER_IMAGE','RENDER_WORKER_IMAGE','ENC_WORKER_IMAGE')) { Invoke-Docker -DockerArgs @('tag', $sourceImages[$key], $images[$key]) }
    } else {
        Invoke-Docker -DockerArgs @('compose','--env-file',$buildEnv,'--file',$script:RuntimeCompose,'--file',(Join-Path $script:RepoRoot 'deploy/build.yaml'),'build')
    }
    foreach ($key in @('POSTGIS_IMAGE','TILE_SERVER_IMAGE')) {
        if (-not (Test-Image $images[$key])) { Invoke-Docker -DockerArgs @('pull', $images[$key]) }
        $name = if ($key -eq 'POSTGIS_IMAGE') { 'postgres' } else { 'tiles' }
        $tag = "ms-editor/${name}:$Version"
        Invoke-Docker -DockerArgs @('tag', $images[$key], $tag)
        $images[$key] = $tag
    }
} finally { Remove-Item -LiteralPath $buildEnv }
}

foreach ($folder in @('deploy','scripts/deployment','infra/init','infra/ops','docs')) { [IO.Directory]::CreateDirectory((Join-Path $Output $folder)) | Out-Null }
foreach ($folder in @('infra/init','infra/ops','deploy/tile-server')) { Copy-Tree (Join-Path $script:RepoRoot $folder) (Join-Path $Output $folder) }
foreach ($file in @('deploy/compose.yaml','scripts/deployment/common.ps1','scripts/deployment/setup.ps1','scripts/deployment/control.ps1','scripts/deployment/doctor.ps1','Setup.cmd','Start.cmd','Stop.cmd','Doctor.cmd','Logs.cmd','docs/setup-new-machine.md','docs/deployment-verification.md','docs/pbf-export.md')) {
    Copy-Item -LiteralPath (Join-Path $script:RepoRoot $file) -Destination (Join-Path $Output $file)
}
Write-Utf8 (Join-Path $Output 'deploy/images.env') ((@($images.Keys | Sort-Object | ForEach-Object { "$_=$($images[$_])" }) -join "`n") + "`n")
$imageInfo = @(foreach ($reference in ($images.Values | Sort-Object -Unique)) {
    $info = (Read-JsonContent (Get-Docker -DockerArgs @('image','inspect',$reference)))[0]
    [ordered]@{reference=$reference;id=$info.Id;os=$info.Os;architecture=$info.Architecture}
})
$arch = $imageInfo[0].architecture
foreach ($info in $imageInfo) { if ($info.architecture -ne $arch -or $info.os -ne 'linux') { throw 'All release images must use the same Linux architecture.' } }

if (-not $Resume) {
Write-Host 'Compressing Docker images into images.tar.gz...'
# Stream binary stdout directly into gzip. PowerShell 5 redirection would
# decode/re-encode docker save output and corrupt the archive.
$start = New-Object Diagnostics.ProcessStartInfo
$start.FileName = 'docker'
$start.Arguments = 'image save ' + (($imageInfo | ForEach-Object { $_.reference }) -join ' ')
$start.UseShellExecute = $false
$start.RedirectStandardOutput = $true
$start.CreateNoWindow = $true
$process = [Diagnostics.Process]::Start($start)
$fileStream = [IO.File]::Create((Join-Path $Output 'images.tar.gz'))
$gzip = New-Object IO.Compression.GZipStream($fileStream, [IO.Compression.CompressionLevel]::Optimal)
try { $process.StandardOutput.BaseStream.CopyTo($gzip); $process.WaitForExit(); if ($process.ExitCode -ne 0) { throw 'docker save failed.' } }
finally { $gzip.Dispose(); $fileStream.Dispose(); $process.Dispose() }
}

# Include source and documentation for the thesis, excluding datasets, local
# configuration, caches and build products. Installation does not unpack it.
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$sourceZip = Join-Path $Output 'source.zip'
if (Test-Path -LiteralPath $sourceZip) { Remove-Item -LiteralPath $sourceZip }
$archive = [IO.Compression.ZipFile]::Open($sourceZip, [IO.Compression.ZipArchiveMode]::Create)
try {
    $files = @(& git -C $script:RepoRoot ls-files --cached --others --exclude-standard)
    if ($LASTEXITCODE -ne 0) { throw 'Git is required on the machine building the release.' }
    foreach ($relative in ($files | Sort-Object -Unique)) {
        if ($relative -match '(^|/)(data|backups|releases|node_modules|dist|__pycache__|\.git)(/|$)' -or $relative -match '(^|/)\.env($|\.)' -and $relative -notmatch '\.env\.example$') { continue }
        if ($relative.StartsWith('infra/tile-server-data/') -and $relative -notmatch '^infra/tile-server-data/(config|seed|cleanup)\.json$') { continue }
        $source = Get-SafeChild $script:RepoRoot $relative
        if (Test-Path -LiteralPath $source -PathType Leaf) { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $source, $relative, [IO.Compression.CompressionLevel]::Optimal) | Out-Null }
    }
} finally { $archive.Dispose() }
Copy-Item -LiteralPath (Join-Path $script:RepoRoot 'docs/setup-new-machine.md') -Destination (Join-Path $Output 'READ-ME-FIRST.md')
Write-Json (Join-Path $Output 'release.json') ([ordered]@{
    format=1; type='map-service-system'; version=$Version; architecture=$arch
    created_at=[DateTime]::UtcNow.ToString('o'); includes_datasets=$false; images=$imageInfo
})
Write-Json (Join-Path $Output 'checksums.json') ([ordered]@{files=@(Get-Inventory $Output @('checksums.json'))})
[IO.Compression.ZipFile]::CreateFromDirectory($Output, ($Output + '.zip'), [IO.Compression.CompressionLevel]::NoCompression, $true)
Write-Utf8 ($Output + '.zip.sha256') ((Get-FileHash -LiteralPath ($Output + '.zip') -Algorithm SHA256).Hash.ToLowerInvariant())
Write-Host "Release ready: $Output"
Write-Host "Transfer $Output.zip, extract it, open Docker Desktop, then double-click Setup.cmd."
