<#
  Private, user-level MySQL 8 instance for local development (no admin rights needed).
  Uses the installed MySQL Server binaries but its own data directory and port, so it never
  touches the MySQL80 Windows service or its data.

  Usage:  powershell -File scripts/mysql-dev.ps1 init|start|stop|status
#>
param([Parameter(Mandatory)][ValidateSet('init', 'start', 'stop', 'status')][string]$Action)

$ErrorActionPreference = 'Stop'
$MysqlHome = 'C:\Program Files\MySQL\MySQL Server 8.0'
$Mysqld = Join-Path $MysqlHome 'bin\mysqld.exe'
$Base = Join-Path $env:LOCALAPPDATA 'TransAxis\mysql-dev'
$DataDir = Join-Path $Base 'data'
$Ini = Join-Path $Base 'my.ini'
$Port = 3307

function Test-Listening { [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) }

function Write-Ini {
  New-Item -ItemType Directory -Force $Base | Out-Null
  $d = $DataDir -replace '\\', '/'
  $b = $MysqlHome -replace '\\', '/'
  @"
[mysqld]
basedir=$b
datadir=$d
port=$Port
bind-address=127.0.0.1
mysqlx=OFF
character-set-server=utf8mb4
collation-server=utf8mb4_0900_ai_ci
default-time-zone='+00:00'
log_bin_trust_function_creators=1
skip-log-bin
max_connections=200
log-error=$($Base -replace '\\', '/')/mysqld.err
"@ | Set-Content -Path $Ini -Encoding ascii
}

switch ($Action) {
  'init' {
    if (Test-Path (Join-Path $DataDir 'mysql')) { Write-Output "Already initialised at $DataDir"; break }
    if (-not (Test-Path $Mysqld)) { throw "mysqld not found at $Mysqld" }
    Write-Ini
    if (Test-Path $DataDir) { Remove-Item -Recurse -Force $DataDir }  # leftover from a failed init
    # mysqld writes progress to stderr; run it as a separate process so that isn't treated as failure.
    $p = Start-Process -FilePath $Mysqld -ArgumentList "--defaults-file=`"$Ini`"", '--initialize-insecure' `
      -Wait -PassThru -WindowStyle Hidden
    if ($p.ExitCode -ne 0 -or -not (Test-Path (Join-Path $DataDir 'mysql'))) {
      Get-Content (Join-Path $Base 'mysqld.err') -Tail 20
      throw "mysqld --initialize failed (exit $($p.ExitCode))"
    }
    Write-Output "Initialised data directory $DataDir (root@localhost has no password until bootstrap sets one)"
  }
  'start' {
    if (Test-Listening) { Write-Output "Already running on port $Port"; break }
    Write-Ini
    Start-Process -FilePath $Mysqld -ArgumentList "--defaults-file=`"$Ini`"" -WindowStyle Hidden | Out-Null
    for ($i = 0; $i -lt 30 -and -not (Test-Listening); $i++) { Start-Sleep -Milliseconds 500 }
    if (Test-Listening) { Write-Output "MySQL dev instance listening on 127.0.0.1:$Port" }
    else { Get-Content (Join-Path $Base 'mysqld.err') -Tail 20; throw 'mysqld did not start' }
  }
  'stop' {
    $procs = Get-CimInstance Win32_Process -Filter "Name='mysqld.exe'" |
      Where-Object { $_.CommandLine -like "*$Ini*" }
    if (-not $procs) { Write-Output 'Not running'; break }
    $procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    Write-Output 'Stopped'
  }
  'status' {
    if (Test-Listening) { Write-Output "Running on 127.0.0.1:$Port (data: $DataDir)" } else { Write-Output 'Not running' }
  }
}
