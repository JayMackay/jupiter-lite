# Launch only this repository's local build; return to the calling shell immediately.
[CmdletBinding()]
param()

$jupiterRepository = $PSScriptRoot
$jupiterExecutable = Join-Path $jupiterRepository 'src-tauri\target\release\jupiter.exe'
if (-not (Test-Path -LiteralPath $jupiterExecutable -PathType Leaf)) {
    Write-Error "Jupiter has not been built locally. In '$jupiterRepository', run: npm run desktop:build -- --no-bundle. Expected executable: $jupiterExecutable"
    return
}
if (-not (Test-Path -LiteralPath (Join-Path $jupiterRepository 'workspace\workspace.json') -PathType Leaf)) {
    Write-Error "Jupiter's workspace registry is missing from '$jupiterRepository'. Keep this launcher in the repository root."
    return
}

# Start-Process joins ArgumentList into one Windows command line, so quote the path.
# PSScriptRoot has no trailing slash, avoiding Windows' closing-quote escape rule.
Start-Process -FilePath $jupiterExecutable -ArgumentList @('--repo', ('"{0}"' -f $jupiterRepository)) -WorkingDirectory $jupiterRepository -ErrorAction Stop
