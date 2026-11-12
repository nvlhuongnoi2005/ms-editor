param([switch]$Docker)
. "$PSScriptRoot/common.ps1"
foreach ($file in @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.ps1')) {
    $parseErrors = $null
    [Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$null, [ref]$parseErrors) | Out-Null
    if ($parseErrors) { throw ($parseErrors | Out-String) }
}
Write-Host 'PASS PowerShell 5 syntax'
$originalRoot = $script:RepoRoot
$testRoot = Join-Path $originalRoot ('releases/.verify-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory((Join-Path $testRoot 'deploy')) | Out-Null
try {
    $script:RepoRoot = $testRoot
    Initialize-Config
    $values = Read-Env (Join-Path $testRoot 'deploy/.env')
    foreach ($name in @('POSTGRES_PASSWORD','CANONICAL_DB_PASSWORD','RENDER_DB_PASSWORD','ENC_DB_PASSWORD')) {
        if ($values[$name] -notmatch '^[a-f0-9]{48}$') { throw 'Secret generation failed.' }
    }
    $before = (Get-FileHash -LiteralPath (Join-Path $testRoot 'deploy/.env')).Hash
    Initialize-Config
    if ($before -ne (Get-FileHash -LiteralPath (Join-Path $testRoot 'deploy/.env')).Hash) { throw 'Setup overwrote existing credentials.' }
    Write-Host 'PASS random credentials and repeat setup preservation'
    foreach ($relative in @('../escape','data/../../escape','C:/escape','/escape')) {
        $rejected = $false
        try { Get-SafeChild $testRoot $relative | Out-Null } catch { $rejected = $true }
        if (-not $rejected) { throw "Path traversal accepted: $relative" }
    }
    Write-Host 'PASS manifest path traversal rejection'
    $inventory = @(Get-Inventory $testRoot)
    Assert-Inventory $testRoot $inventory
    Write-Utf8 (Join-Path $testRoot 'deploy/.env') 'changed'
    $rejected = $false
    try { Assert-Inventory $testRoot $inventory } catch { $rejected = $true }
    if (-not $rejected) { throw 'Tampered package was accepted.' }
    Write-Host 'PASS checksum corruption detection'
    if ($Docker) {
        Assert-Docker
        $info = (Read-JsonContent (Get-Docker -DockerArgs @('image','inspect','alpine:3.22')))[0]
        if (-not $info.Id.StartsWith('sha256:')) { throw 'Docker inspect parsing failed.' }
        Write-Host 'PASS Docker argument passing and JSON inspection'
    }
} finally {
    $script:RepoRoot = $originalRoot
    $allowed = [IO.Path]::GetFullPath((Join-Path $originalRoot 'releases')) + [IO.Path]::DirectorySeparatorChar
    if ([IO.Path]::GetFullPath($testRoot).StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
