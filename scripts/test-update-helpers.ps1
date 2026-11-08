$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'update-helpers.ps1')
$taskFixture = @(
  [pscustomobject]@{ Name='jupiter.exe'; ProcessId=101; ParentProcessId=1; ExecutablePath='D:\My Apps\Jupiter\jupiter.exe' },
  [pscustomobject]@{ Name='node.exe'; ProcessId=102; ParentProcessId=101; ExecutablePath='D:\My Apps\Jupiter\runtime\node.exe' },
  [pscustomobject]@{ Name='powershell.exe'; ProcessId=103; ParentProcessId=102; ExecutablePath='C:\Windows\powershell.exe' },
  [pscustomobject]@{ Name='node.exe'; ProcessId=104; ParentProcessId=1; ExecutablePath='C:\Program Files\nodejs\node.exe' }
)
if (-not (Test-JupiterAncestor $taskFixture 103)) { throw 'Managed terminal was not detected.' }
if (Test-JupiterAncestor $taskFixture 104) { throw 'Unrelated process was blocked.' }
$taskRunning = @(Get-JupiterUpdateProcesses $taskFixture @('D:\My Apps\Jupiter'))
if ($taskRunning.Count -ne 2) { throw 'Custom install/service matching failed.' }
$taskOrphan = @(Get-JupiterUpdateProcesses @($taskFixture[1], $taskFixture[3]) @('D:\My Apps\Jupiter'))
if ($taskOrphan.Count -ne 1 -or $taskOrphan[0].ProcessId -ne 102) { throw 'Service tail was missed or an unrelated node process was included.' }
'Updater process checks passed; no installation or process termination performed.'
