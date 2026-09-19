$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    & npm.cmd run test:written-grading
    if ($LASTEXITCODE -ne 0) { throw 'Written grading tests failed.' }

    & npm.cmd --prefix functions run build
    if ($LASTEXITCODE -ne 0) { throw 'Functions build failed.' }

    & npm.cmd --prefix functions run smoke:written-grading-api
    if ($LASTEXITCODE -ne 0) { throw 'Gemini API smoke test failed.' }

    $env:FUNCTIONS_DISCOVERY_TIMEOUT = '60'
    & npx.cmd firebase-tools deploy --only functions:submitWrittenDrillResult --project math-app-26c77
    if ($LASTEXITCODE -ne 0) { throw 'Firebase deployment failed.' }
} finally {
    Pop-Location
}
