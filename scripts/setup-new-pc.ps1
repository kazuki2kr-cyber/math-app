#Requires -Version 5.1

[CmdletBinding()]
param(
  [ValidateSet('check', 'setup', 'verify')]
  [string]$Mode = 'setup',
  [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$repoRoot = Split-Path -Parent $PSScriptRoot
$expectedRemote = 'https://github.com/kazuki2kr-cyber/math-app.git'
$expectedFirebaseProject = 'math-app-26c77'
$script:Problems = [System.Collections.Generic.List[string]]::new()
$script:Warnings = [System.Collections.Generic.List[string]]::new()

function Write-Step([string]$Message) {
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Add-Problem([string]$Message) {
  $script:Problems.Add($Message)
  Write-Host "[NG] $Message" -ForegroundColor Red
}

function Add-Warning([string]$Message) {
  $script:Warnings.Add($Message)
  Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-Ok([string]$Message) {
  Write-Host "[OK] $Message" -ForegroundColor Green
}

function Test-RequiredCommand([string]$Name, [string]$InstallHint) {
  if (Get-Command $Name -ErrorAction SilentlyContinue) {
    Write-Ok "$Name found"
    return $true
  }

  Add-Problem "$Name was not found. $InstallHint"
  return $false
}

function Get-Java21Home {
  $candidates = [System.Collections.Generic.List[string]]::new()

  if (-not [string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
    $candidates.Add($env:JAVA_HOME)
  }

  $javaCommand = Get-Command 'java' -ErrorAction SilentlyContinue
  if ($javaCommand -and $javaCommand.Source) {
    $candidates.Add((Split-Path -Parent (Split-Path -Parent $javaCommand.Source)))
  }

  @(
    'C:\Program Files\Microsoft\jdk-21.0.10.7-hotspot',
    'C:\Program Files\Eclipse Adoptium\jdk-21',
    'C:\Program Files\Java\jdk-21'
  ) | ForEach-Object { $candidates.Add($_) }

  @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Eclipse Adoptium'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Microsoft'),
    'C:\Program Files\Eclipse Adoptium',
    'C:\Program Files\Microsoft'
  ) | ForEach-Object {
    if (Test-Path -LiteralPath $_ -PathType Container) {
      Get-ChildItem -LiteralPath $_ -Directory -Filter 'jdk-21*' |
        Sort-Object Name -Descending |
        ForEach-Object { $candidates.Add($_.FullName) }
    }
  }

  foreach ($candidate in ($candidates | Select-Object -Unique)) {
    $javaExe = Join-Path $candidate 'bin\java.exe'
    if (-not (Test-Path -LiteralPath $javaExe -PathType Leaf)) {
      continue
    }

    $javaLine = (& $javaExe --version 2>&1 | Select-Object -First 1).ToString()
    $match = [regex]::Match($javaLine, '(?:openjdk|java)\s+([0-9]+)')
    if ($match.Success -and [int]$match.Groups[1].Value -ge 21) {
      return $candidate
    }
  }

  return $null
}

function Get-EnvKeys([string]$Path) {
  $keys = @{}
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
      $keys[$Matches[1]] = $Matches[2]
    }
  }
  return $keys
}

function Test-EnvFile([string]$RelativePath, [string[]]$RequiredKeys, [string[]]$OptionalKeys) {
  $fullPath = Join-Path $repoRoot $RelativePath
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
    Add-Problem "$RelativePath is missing. Restore the securely copied original; do not recreate it from chat."
    return
  }

  $keys = Get-EnvKeys $fullPath
  $missing = @($RequiredKeys | Where-Object { -not $keys.ContainsKey($_) })
  $empty = @($RequiredKeys | Where-Object { $keys.ContainsKey($_) -and [string]::IsNullOrWhiteSpace([string]$keys[$_]) })

  if ($missing.Count -gt 0) {
    Add-Problem "$RelativePath is missing required keys: $($missing -join ', ')"
  } elseif ($empty.Count -gt 0) {
    Add-Problem "$RelativePath has empty required keys: $($empty -join ', ')"
  } else {
    Write-Ok "$RelativePath required keys found (values hidden)"
  }

  $presentOptional = @($OptionalKeys | Where-Object { $keys.ContainsKey($_) })
  if ($presentOptional.Count -gt 0) {
    Write-Host "[INFO] $RelativePath optional keys found: $($presentOptional -join ', ')"
  }
}

function Invoke-Checked([string]$Label, [string]$Command, [string[]]$Arguments) {
  Write-Step $Label
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE."
  }
  Write-Ok $Label
}

function Test-RepositoryState {
  Write-Step 'Checking repository and migrated local files'

  if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'AGENTS.md'))) {
    Add-Problem 'AGENTS.md is missing. Confirm that the complete math.app folder was copied.'
    return
  }

  $remote = (& git -C $repoRoot remote get-url origin 2>$null | Select-Object -First 1)
  if ([string]::IsNullOrWhiteSpace($remote)) {
    Add-Problem 'Git origin is not configured.'
  } elseif ($remote.Trim() -ne $expectedRemote) {
    Add-Warning "Unexpected Git origin: $($remote.Trim())"
  } else {
    Write-Ok "Git origin: $expectedRemote"
  }

  $branch = (& git -C $repoRoot branch --show-current 2>$null | Select-Object -First 1)
  if ([string]::IsNullOrWhiteSpace($branch)) {
    Add-Warning 'Could not determine the current Git branch.'
  } else {
    Write-Ok "Git branch: $($branch.Trim())"
  }

  Test-EnvFile '.env.local' @(
    'NEXT_PUBLIC_FIREBASE_API_KEY',
    'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
    'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
    'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
    'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
    'NEXT_PUBLIC_FIREBASE_APP_ID',
    'NEXT_PUBLIC_FIREBASE_DATABASE_URL'
  ) @(
    'NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID',
    'NEXT_PUBLIC_FIREBASE_VAPID_KEY',
    'TEST_USER_EMAIL',
    'TEST_USER_PASSWORD',
    'NEXT_PUBLIC_BATTLE_ACCESS_PASSWORD',
    'NEXT_PUBLIC_KANJI_BATTLE_ACCESS_PASSWORD'
  )

  Test-EnvFile 'functions/.env' @(
    'KANJI_ACCESS_PASSWORD',
    'GEMINI_API_KEY'
  ) @(
    'GEMINI_MODEL'
  )

  if (Test-Path -LiteralPath (Join-Path $repoRoot '.vercel/project.json')) {
    Write-Ok '.vercel/project.json found (CLI project link)'
  } else {
    Add-Warning '.vercel/project.json is absent. GitHub push works without it; relink only if Vercel CLI is needed.'
  }
}

function Test-Toolchain {
  Write-Step 'Checking required tools'
  $hasGit = Test-RequiredCommand 'git' 'Install Git for Windows.'
  $hasNode = Test-RequiredCommand 'node' 'Install Node.js 22.'
  $hasNpm = Test-RequiredCommand 'npm.cmd' 'Install npm with Node.js 22.'
  $javaHome = Get-Java21Home
  $hasJava = -not [string]::IsNullOrWhiteSpace($javaHome)
  if ($hasJava) {
    $env:JAVA_HOME = $javaHome
    $env:Path = (Join-Path $javaHome 'bin') + ';' + $env:Path
    Write-Ok "Java 21+: $javaHome"
  } else {
    Add-Problem 'Java 21+ was not found. Install JDK 21 or set JAVA_HOME.'
  }

  if ($hasNode) {
    $nodeVersion = (& node --version).Trim()
    $nodeMajor = [int](($nodeVersion -replace '^v', '').Split('.')[0])
    if ($nodeMajor -ne 22) {
      Add-Problem "Node.js 22 is required. Current: $nodeVersion"
    } else {
      Write-Ok "Node.js $nodeVersion"
    }
  }

  if ($hasJava) {
    $javaHomeExe = Join-Path $javaHome 'bin\java.exe'
    $javaLine = (& $javaHomeExe --version 2>&1 | Select-Object -First 1).ToString()
    $match = [regex]::Match($javaLine, '(?:openjdk|java)\s+([0-9]+)')
    if (-not $match.Success -or [int]$match.Groups[1].Value -lt 21) {
      Add-Problem "JDK 21 or newer is required. Current: $javaLine"
    } else {
      Write-Ok "Java: $javaLine"
    }

    Write-Ok "JAVA_HOME for this setup run: $env:JAVA_HOME"
  }

  return ($hasGit -and $hasNode -and $hasNpm -and $hasJava)
}

function Write-AuthChecklist {
  Write-Step 'Machine-local authentication still to check'
  Write-Host 'Codex should run these checks on the new PC and request user interaction only when login is required:'
  Write-Host '  1. GitHub: git ls-remote origin HEAD'
  Write-Host "  2. Firebase: npx.cmd --no-install firebase login:list and projects:list (expect $expectedFirebaseProject)"
  Write-Host '  3. Vercel CLI only when needed: npx.cmd vercel whoami (then login/link if needed)'
  Write-Host 'Never print environment values, auth tokens, or credential files in the terminal/chat.'
}

Push-Location $repoRoot
try {
  Write-Host "math.app new-PC setup ($Mode)" -ForegroundColor White
  $toolchainReady = Test-Toolchain
  if ($toolchainReady) {
    Test-RepositoryState
  }

  if ($script:Problems.Count -gt 0) {
    Write-Step 'Preflight action required'
    $script:Problems | ForEach-Object { Write-Host "- $_" }
    Write-AuthChecklist
    exit 2
  }

  if ($Mode -eq 'check') {
    if (-not (Test-Path -LiteralPath 'node_modules')) {
      Add-Warning 'Root dependencies are absent. Run again with -Mode setup.'
    }
    if (-not (Test-Path -LiteralPath 'functions/node_modules')) {
      Add-Warning 'Functions dependencies are absent. Run again with -Mode setup.'
    }
    Write-AuthChecklist
    Write-Step 'Check complete; no files or dependencies were changed'
    exit 0
  }

  if ($Mode -eq 'setup') {
    Invoke-Checked 'Installing root dependencies from package-lock.json' 'npm.cmd' @('ci')
    Invoke-Checked 'Installing Functions dependencies from package-lock.json' 'npm.cmd' @('--prefix', 'functions', 'ci')
  } elseif (-not (Test-Path -LiteralPath 'node_modules') -or -not (Test-Path -LiteralPath 'functions/node_modules')) {
    throw 'Dependencies are absent. Run -Mode setup first.'
  }

  Invoke-Checked 'Mojibake check' 'npm.cmd' @('run', 'check:mojibake')
  Invoke-Checked 'Next.js production build' 'npm.cmd' @('run', 'build')
  Invoke-Checked 'Cloud Functions TypeScript build' 'npm.cmd' @('--prefix', 'functions', 'run', 'build')

  if (-not $SkipTests) {
    Invoke-Checked 'Unit tests with Firebase Emulator' 'npm.cmd' @('test')
    Invoke-Checked 'Firestore security rules tests' 'npm.cmd' @('run', 'test:security')
  } else {
    Add-Warning 'Tests were skipped. Run npm.cmd test and npm.cmd run test:security before declaring migration complete.'
  }

  Write-AuthChecklist
  Write-Step 'Local setup and verification complete'
  Write-Host 'Complete the three authentication checks above to finish the migration.' -ForegroundColor Green
} finally {
  Pop-Location
}
