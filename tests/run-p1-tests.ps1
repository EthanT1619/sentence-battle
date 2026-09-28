$ErrorActionPreference = "Stop"
Push-Location (Split-Path $PSScriptRoot -Parent)
node "tests/p1-curriculum.mjs"
Pop-Location
