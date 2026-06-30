# Oracle A1 (Ampere ARM) auto-grabber — Windows / PowerShell version.
#
# Retries `oci compute instance launch` until the free ARM capacity frees up, then stops. Run this on
# your PC to bootstrap an A1 when you have no other always-on machine: leave it running (and stop the
# PC from sleeping). The moment it lands an instance, that A1 becomes your permanent 24/7 host.
#
# Setup, OCI CLI auth, and how to find every OCID: see deploy/oracle-a1-retry.md (Windows section).
#
# Usage (after filling deploy\oracle-a1.env):
#   powershell -ExecutionPolicy Bypass -File deploy\oracle-a1-retry.ps1
#
param(
  [string]$EnvFile = "$PSScriptRoot\oracle-a1.env"
)
$ErrorActionPreference = 'Continue'   # we check $LASTEXITCODE ourselves; don't choke on oci stderr

if (-not (Test-Path $EnvFile)) { Write-Host "Missing $EnvFile — copy oracle-a1.env.example and fill it in."; exit 1 }

# --- parse simple KEY="value" lines from the env file ---
$cfg = @{}
foreach ($line in Get-Content $EnvFile) {
  if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
  if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
    $v = $matches[2]
    if ($v.StartsWith('"') -and $v.EndsWith('"')) { $v = $v.Substring(1, $v.Length - 2) }
    $cfg[$matches[1]] = $v
  }
}
function Req($k) { if (-not $cfg[$k]) { Write-Host "Set $k in $EnvFile"; exit 1 }; $cfg[$k] }
function Opt($k, $d) { if ($cfg[$k]) { $cfg[$k] } else { $d } }

$Compartment = Req 'COMPARTMENT_OCID'
$Subnet      = Req 'SUBNET_OCID'
$Image       = Req 'IMAGE_OCID'
$PubKeyPath  = Req 'SSH_PUBKEY_PATH'
$ADs         = (Req 'AVAILABILITY_DOMAINS') -split '\s+' | Where-Object { $_ }
$Shape     = Opt 'SHAPE' 'VM.Standard.A1.Flex'
$Ocpus     = [int](Opt 'OCPUS' '2')
$Mem       = [int](Opt 'MEM_GB' '12')
$Name      = Opt 'DISPLAY_NAME' 'lifeos-a1'
$Interval  = [int](Opt 'INTERVAL_SECONDS' '180')
$RateSleep = [int](Opt 'RATE_SLEEP_SECONDS' '600')

if (-not (Get-Command oci -ErrorAction SilentlyContinue)) {
  Write-Host "oci CLI not found. Install:  pip install oci-cli   then confirm  oci --version  works."; exit 1
}
if (-not (Test-Path $PubKeyPath)) { Write-Host "SSH public key not found at $PubKeyPath"; exit 1 }

# --- write the JSON args to temp files so PowerShell quoting can't mangle them ---
$pub = (Get-Content $PubKeyPath -Raw).Trim()
$metaFile  = Join-Path $env:TEMP 'a1-metadata.json'
$shapeFile = Join-Path $env:TEMP 'a1-shape.json'
(@{ ssh_authorized_keys = $pub } | ConvertTo-Json -Compress) | Set-Content $metaFile  -Encoding ascii
(@{ ocpus = $Ocpus; memoryInGBs = $Mem } | ConvertTo-Json -Compress) | Set-Content $shapeFile -Encoding ascii

function Ts { (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') }
Write-Host "[$(Ts)] A1 grabber started — $Shape $Ocpus OCPU / $Mem GB, ADs: $($ADs -join ', '), base interval ${Interval}s"

$attempt = 0
while ($true) {
  $attempt++
  $rateLimited = $false
  foreach ($AD in $ADs) {
    Write-Host "[$(Ts)] attempt #$attempt — launching in $AD ..."
    $tmp = Join-Path $env:TEMP 'a1-out.txt'
    & oci compute instance launch `
        --availability-domain $AD `
        --compartment-id $Compartment `
        --shape $Shape `
        --shape-config ("file://" + $shapeFile) `
        --image-id $Image `
        --subnet-id $Subnet `
        --assign-public-ip true `
        --display-name $Name `
        --metadata ("file://" + $metaFile) *> $tmp
    $code = $LASTEXITCODE
    $out = if (Test-Path $tmp) { Get-Content $tmp -Raw } else { '' }

    if ($code -eq 0) {
      Write-Host "[$(Ts)] SUCCESS — instance is launching!"
      $out | Tee-Object -FilePath (Join-Path $PSScriptRoot 'a1-success.json') | Out-Null
      Write-Host "[$(Ts)] Saved deploy\a1-success.json. Stopping — grab the public IP in the console."
      exit 0
    }
    if ($out -match '(?i)out of (host )?capacity|outofcapacity') {
      Write-Host "[$(Ts)]   ...no capacity in $AD yet."
    } elseif ($out -match '(?i)too ?many ?requests|\b429\b|rate') {
      Write-Host "[$(Ts)]   ...rate limited; backing off."; $rateLimited = $true
    } elseif ($out -match '(?i)limitexceeded|service limit|quota|already exists') {
      Write-Host "[$(Ts)] Quota/limit hit — you may already hold an A1. Stopping:`n$out"; exit 2
    } elseif ($out -match '(?i)notauthenticated|not authorized|authorization failed|signature|could not find config') {
      Write-Host "[$(Ts)] Auth/config error — fix the OCI CLI setup. Stopping:`n$out"; exit 3
    } else {
      Write-Host "[$(Ts)]   ...other error:"; ($out -split "`n" | Select-Object -First 4) | ForEach-Object { Write-Host "    $_" }
    }
  }
  $sleep = if ($rateLimited) { $RateSleep } else { $Interval }
  $sleep += Get-Random -Maximum 30
  Write-Host "[$(Ts)] sleeping ${sleep}s before next try..."
  Start-Sleep -Seconds $sleep
}
