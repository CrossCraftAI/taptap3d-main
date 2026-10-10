param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$ProjectId,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-z][a-z0-9-]+$')][string]$SqlInstance,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$')][string]$Bucket,
  [Parameter(Mandatory=$true)][string]$PublicOrigin,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9_.-]+$')][string]$ImageTag,
  [ValidatePattern('^[a-z]+-[a-z]+[0-9]$')][string]$Region = 'asia-east2'
)
$ErrorActionPreference = 'Stop'
$serviceUri = [Uri]$PublicOrigin
if ($serviceUri.Scheme -ne 'https' -or $serviceUri.UserInfo -or $serviceUri.AbsolutePath -ne '/' -or $serviceUri.Query -or $serviceUri.Fragment) {
  throw 'PublicOrigin must be an HTTPS origin without credentials, path, query or fragment.'
}
$outputDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../.data/gcp'))
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$encoding = New-Object System.Text.UTF8Encoding($false)
foreach ($manifest in @('service.yaml', 'migration-job.yaml')) {
  $content = [IO.File]::ReadAllText((Join-Path $PSScriptRoot $manifest))
  $content = $content.Replace('PROJECT_ID', $ProjectId).Replace('SQL_INSTANCE', $SqlInstance).Replace('PRIVATE_BUCKET_NAME', $Bucket).Replace('COMMIT_SHA', $ImageTag).Replace('https://PUBLIC_HOSTNAME', $serviceUri.GetLeftPart([UriPartial]::Authority)).Replace('asia-east2', $Region)
  [IO.File]::WriteAllText((Join-Path $outputDirectory $manifest), $content, $encoding)
}
Write-Output "Rendered manifests in $outputDirectory. No cloud resources were changed."
