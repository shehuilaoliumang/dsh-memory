<#
.SYNOPSIS
  Initialize the global preference store from this project library.

.DESCRIPTION
  This is the explicit, human-run half of the migration. It does not run
  automatically and it refuses to overwrite an existing target.

  The global store receives:
    - a copy of 30_Canon/core.md (称谓 / 硬偏好 / 禁区)
    - every 20_Digest atom whose frontmatter has `scope: global`
    - source links are stripped: raw conversations stay in the project library

  The current project library is then attached to the user-level registry via
  `kb.mjs attach`, so the plugin discovers it without scanning the filesystem.

.EXAMPLE
  pwsh -File scripts\install-global.ps1

.EXAMPLE
  pwsh -File scripts\install-global.ps1 `
    -Target "$env:TEMP\dsh-global-test" `
    -Registry "$env:TEMP\dsh-global-test\projects.json"
#>
[CmdletBinding()]
param(
  [string]$Target = (Join-Path $HOME '.dsh-memory\global'),
  [string]$Registry = (Join-Path $HOME '.dsh-memory\projects.json'),
  [string]$ProjectRoot = ''
)

$ErrorActionPreference = 'Stop'
if (-not $ProjectRoot) {
  $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

$node = (Get-Command node -ErrorAction Stop).Source
$kb = Join-Path $ProjectRoot '_meta\scripts\kb.mjs'
$sourceCore = Join-Path $ProjectRoot '30_Canon\core.md'
$sourceAtoms = Join-Path $ProjectRoot '20_Digest\atoms'

foreach ($required in @($kb, $sourceCore)) {
  if (-not (Test-Path -LiteralPath $required)) {
    throw "缺少文件：$required"
  }
}
if (-not (Test-Path -LiteralPath $sourceAtoms)) {
  throw "缺少目录：$sourceAtoms"
}

$Target = [IO.Path]::GetFullPath($Target)
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
if (Test-Path -LiteralPath $Target) {
  throw "目标已存在：$Target。本脚本不覆盖、不删除；请先人工确认后换一个路径。"
}

$targetParent = Split-Path -Parent $Target
if ($targetParent) { New-Item -ItemType Directory -Force -Path $targetParent | Out-Null }

Write-Host "初始化全局库：$Target"
& $node $kb init --root $Target
if ($LASTEXITCODE -ne 0) { throw "kb init 失败：$LASTEXITCODE" }

Copy-Item -LiteralPath $sourceCore -Destination (Join-Path $Target '30_Canon\core.md') -Force

$copied = @()
foreach ($atom in Get-ChildItem -LiteralPath $sourceAtoms -Filter '*.md' -File) {
  $text = Get-Content -LiteralPath $atom.FullName -Raw -Encoding UTF8
  if ($text -notmatch '(?m)^scope:\s*global\s*$') { continue }
  # Raw transcripts stay project-local; drop links that would dangle in the
  # global store. The atom body itself is preserved.
  $text = [regex]::Replace($text, '(?m)^source\s*:.*\r?\n', '')
  $destination = Join-Path $Target ('20_Digest\atoms\' + $atom.Name)
  [IO.File]::WriteAllText($destination, $text, (New-Object System.Text.UTF8Encoding($false)))
  $copied += $atom.BaseName
}

Write-Host ("复制全局偏好：{0} 条" -f $copied.Count)
if ($copied.Count -eq 0) {
  Write-Warning '没有找到 scope: global 的偏好；全局库只有 core.md。'
}

& $node $kb --root $Target rebuild
if ($LASTEXITCODE -ne 0) { throw "全局库 rebuild 失败：$LASTEXITCODE" }
& $node $kb --root $Target validate
if ($LASTEXITCODE -ne 0) { throw "全局库 validate 失败：$LASTEXITCODE" }

$registryParent = Split-Path -Parent $Registry
if ($registryParent) { New-Item -ItemType Directory -Force -Path $registryParent | Out-Null }
& $node $kb attach --root $ProjectRoot --registry $Registry --json
if ($LASTEXITCODE -ne 0) { throw "attach 失败：$LASTEXITCODE" }

Write-Host ''
Write-Host '完成。下一步：在 GUI 侧栏「重新加载」或禁用/启用 @local/kb-panel，让插件读取新的全局库。'
Write-Host "全局库：$Target"
Write-Host "项目登记：$Registry"
