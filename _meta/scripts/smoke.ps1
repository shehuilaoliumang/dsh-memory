# 规则层冒烟测试（kb.mjs）
#
# 为什么是 PowerShell 而不是 node:test：DSH 沙箱禁止 node 子进程用管道 stdio
# 再 spawn 子进程（EPERM），而 kb.mjs 是独立脚本、需要真实执行。这里用 pwsh
# 直接调用 node，只依赖退出码与 stdout，不依赖任何测试框架。
#
# 用法（任意目录）：
#   pwsh -File _meta/scripts/smoke.ps1
#
# 行为：把 vault 复制到临时目录跑全部命令，绝不触碰真实库；结束时清理。

$ErrorActionPreference = 'Stop'
# Run from a file, or inline (`Invoke-Expression`) when the machine's execution
# policy blocks .ps1 — in that case pass the vault root through KB_REPO.
$repo = if ($env:KB_REPO) {
  (Resolve-Path $env:KB_REPO).Path
} elseif ($PSScriptRoot) {
  (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
} else {
  (Get-Location).Path
}
$base = Join-Path $env:TEMP ("kb-smoke-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$script = Join-Path $base '_meta\scripts\kb.mjs'
$passed = 0
$failed = 0

function Check($name, $condition, $detail) {
  if ($condition) {
    $script:passed += 1
    Write-Host ("  PASS  " + $name)
  } else {
    $script:failed += 1
    Write-Host ("  FAIL  " + $name + $(if ($detail) { " :: " + $detail } else { '' }))
  }
}

function Kb([string[]]$kbArgs) {
  # Several assertions EXPECT a non-zero exit (validation guards, invalid
  # transitions). Under `$ErrorActionPreference = 'Stop'` PowerShell would turn
  # the native stderr into a terminating error before we can inspect it, so the
  # call runs with a local Continue preference and restores it afterwards.
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & node $script @kbArgs 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  return @{ code = $code; text = ($out -join "`n") }
}

try {
  New-Item -ItemType Directory -Path $base | Out-Null
  robocopy $repo $base /E /XD ".git" "state" /NFL /NDL /NJH /NJS /NP | Out-Null

  Write-Host "`n[1] validate / rebuild"
  $r = Kb @('validate')
  Check 'validate 在干净副本上通过' ($r.code -eq 0) $r.text
  $r = Kb @('rebuild')
  Check 'rebuild 返回 0' ($r.code -eq 0) $r.text
  # Snapshot the copy's live state: the rest of the run must not introduce any
  # new uncovered atom. Comparing against the baseline keeps the assertion
  # absolute without depending on whatever inbox items the real vault carries.
  $baselineJson = (Kb @('consolidate', '--json')).text | ConvertFrom-Json
  $baselineUncovered = @($baselineJson.uncoveredAtoms)

  Write-Host "`n[2] id-next / add-atom dry-run"
  $r = Kb @('id-next', '--kind', 'a')
  Check 'id-next 产出合法 id' ($r.text -match '^\d{4}-\d{2}-\d{2}-a-\d{4}$') $r.text
  $spec = Join-Path $base 'spec.json'
  @{
    title = '冒烟测试原子'; type = 'fact'; scope = 'global'
    summary = '冒烟测试用，副本内产生'; points = @('只在副本里')
    tags = @('测试')
  } | ConvertTo-Json -Depth 4 | Set-Content $spec -Encoding UTF8
  $r = Kb @('add-atom', '--json-file', $spec, '--json', '--dry-run')
  Check 'add-atom --dry-run 不落盘' ($r.text -match '"dryRun":true') $r.text
  $atomsBefore = (Get-ChildItem (Join-Path $base '20_Digest\atoms') -File).Count

  Write-Host "`n[3] add-atom 真实写入（默认 inbox）"
  $r = Kb @('add-atom', '--json-file', $spec, '--json')
  Check 'add-atom 返回 ok' ($r.text -match '"ok":true') $r.text
  $atomId = ([regex]::Match($r.text, '"id":"([^"]+)"')).Groups[1].Value
  Check '生成的 id 合法' ($atomId -match '^\d{4}-\d{2}-\d{2}-a-\d{4}$') $atomId
  $atomFile = Join-Path (Join-Path $base '20_Digest\atoms') ($atomId + '.md')
  Check '原子文件已创建' (Test-Path $atomFile)
  $atomText = Get-Content $atomFile -Raw -Encoding UTF8
  Check '默认 status=inbox' ($atomText -match '(?m)^status: inbox$') $atomText
  Check 'scope 已写入' ($atomText -match '(?m)^scope: global$')
  $atomsAfter = (Get-ChildItem (Join-Path $base '20_Digest\atoms') -File).Count
  Check '原子数量 +1' ($atomsAfter -eq ($atomsBefore + 1))
  $r = Kb @('add-atom', '--json-file', $spec, '--json')
  Check '同 summary 去重' ($r.text -match '"duplicate":true') $r.text

  Write-Host "`n[4] set-status / clear-scope"
  $r = Kb @('set-status', '--id', $atomId, '--status', 'active', '--json')
  Check 'set-status 改状态' ($r.text -match '"changed":true') $r.text
  $r = Kb @('set-status', '--id', $atomId, '--status', 'active', '--clear-scope', '--json')
  Check 'clear-scope 删除字段' ($r.text -match '"cleared":true') $r.text
  $atomText = Get-Content $atomFile -Raw -Encoding UTF8
  Check 'scope 行确实消失' (-not ($atomText -match '(?m)^scope:')) $atomText

  Write-Host "`n[5] batch-status"
  $r = Kb @('batch-status', '--ids', "$atomId,2026-10-20-a-0009", '--status', 'review', '--json')
  Check 'batch-status 改到 2 条' ($r.text -match '"changed":2') $r.text
  $r = Kb @('batch-status', '--ids', "$atomId,2026-10-20-a-0009", '--status', 'active', '--json')
  Check 'batch-status 改回' ($r.text -match '"changed":2') $r.text

  Write-Host "`n[6] promote"
  $r = Kb @('promote', '--id', $atomId, '--to', '2026-10-20-c-0001', '--json')
  Check 'promote 到 canon' ($r.text -match '"changed":true') $r.text
  $atomText = Get-Content $atomFile -Raw -Encoding UTF8
  Check 'status=promoted' ($atomText -match '(?m)^status: promoted$')
  Check 'up 回指 canon' ($atomText -match 'up: \["\[\[2026-10-20-c-0001\]\]"\]')

  Write-Host "`n[7] access 与热度"
  $r = Kb @('access', '--id', '2026-10-20-a-0009', '--how', 'inject', '--json')
  Check 'access 追加记录' ($r.text -match '"ok":true') $r.text
  $accessLines = (Get-Content (Join-Path $base '_meta\access.jsonl')).Count
  Check 'access.jsonl 有内容' ($accessLines -ge 1) "$accessLines"
  $r = Kb @('consolidate', '--json')
  $json = $r.text | ConvertFrom-Json
  Check 'consolidate 输出 hot' ($null -ne $json.hot) $r.text
  Check 'consolidate 输出 readCandidates' ($null -ne $json.readCandidates) $r.text
  $baselineText = (@($baselineUncovered | Sort-Object) -join ',')
  $currentText = (@($json.uncoveredAtoms | Sort-Object) -join ',')
  Check 'uncovered 与基线一致（无新增）' ($baselineText -eq $currentText) "baseline=$baselineText now=$currentText"

  Write-Host "`n[8] 工作页（工作层）"
  $r = Kb @('work-new', '--scope', 'project:smoke-app', '--json')
  Check 'work-new 返回 ok' ($r.text -match '"ok":true') $r.text
  $workId = ([regex]::Match($r.text, '"id":"([^"]+)"')).Groups[1].Value
  Check '工作页 id 合法（w 段）' ($workId -match '^\d{4}-\d{2}-\d{2}-w-\d{4}$') $workId
  Check '工作页文件已创建' (Test-Path (Join-Path $base "20_Digest\work\$workId.md"))
  $r = Kb @('work-new', '--scope', 'project:smoke-app', '--json')
  Check '同 scope 不重复建' ($r.text -match '"existing":true') $r.text
  $r = Kb @('work-brief', '--scope', 'project:smoke-app', '--json')
  Check 'work-brief 返回简报' ($r.text -match '项目简报') $r.text
  # Idempotence must not depend on whether the copied vault already has a global
  # focus page: call twice and require the second call to return the same page.
  $r = Kb @('work-new', '--scope', 'global', '--json')
  $globalFirst = ([regex]::Match($r.text, '"id":"([^"]+)"')).Groups[1].Value
  $r = Kb @('work-new', '--scope', 'global', '--json')
  $globalSecond = ([regex]::Match($r.text, '"id":"([^"]+)"')).Groups[1].Value
  Check 'global 工作页幂等' ($r.text -match '"existing":true' -and $globalFirst -eq $globalSecond) "first=$globalFirst second=$globalSecond"
  $r = Kb @('set-status', '--id', $workId, '--status', 'inbox', '--json')
  Check '工作页拒绝退回 inbox' ($r.code -ne 0 -and $r.text -match '工作页') $r.text
  $r = Kb @('set-status', '--id', $workId, '--status', 'active', '--clear-scope', '--json')
  Check '工作页拒绝清空 scope' ($r.code -ne 0 -and $r.text -match '保留 scope') $r.text
  $r = Kb @('batch-status', '--ids', $workId, '--status', 'active', '--scope', 'system', '--json')
  Check '工作页拒绝 system scope' ($r.code -ne 0 -and $r.text -match 'global 或 project') $r.text
  $r = Kb @('promote', '--id', $workId, '--to', '2026-10-20-c-0001', '--json')
  Check '工作页拒绝晋升' ($r.code -ne 0 -and $r.text -match '不能晋升') $r.text
  $dupId = '2099-01-01-w-0001'
  $dupFile = Join-Path $base "20_Digest\work\$dupId.md"
  @"
---
id: $dupId
title: 重复工作页
level: digest
type: work
scope: project:smoke-app
status: active
summary: 同 scope 的第二个 active 工作页
updated: 2026-10-29
---
"@ | Set-Content $dupFile -Encoding UTF8
  $r = Kb @('validate')
  Check '同 scope 两个 active 工作页被 validate 拒绝' ($r.code -ne 0 -and $r.text -match '同一 scope') $r.text
  Remove-Item $dupFile -Force
  $wrongKind = Join-Path $base "20_Digest\work\2099-01-01-a-0001.md"
  @"
---
id: 2099-01-01-a-0001
title: 用错 id 段的工作页
level: digest
type: work
scope: project:smoke-app
status: active
summary: id 段与类型不符
updated: 2026-10-29
---
"@ | Set-Content $wrongKind -Encoding UTF8
  $r = Kb @('validate')
  Check '工作页必须用 w 段 id' ($r.code -ne 0 -and $r.text -match 'w 段') $r.text
  Remove-Item $wrongKind -Force
  $r = Kb @('validate')
  Check '移除重复工作页后 validate 恢复' ($r.code -eq 0) $r.text
  $r = Kb @('consolidate', '--json')
  $json = $r.text | ConvertFrom-Json
  Check 'consolidate 输出 work 段' ($null -ne $json.work) $r.text
  Check '工作页登记进 work.pages' ((@($json.work.pages | Where-Object { $_.id -eq $workId }).Count) -eq 1) ($json.work.pages | ConvertTo-Json -Compress)
  Check '工作页不计入 uncovered' (-not ($json.uncoveredAtoms -contains $workId)) ($json.uncoveredAtoms -join ',')
  $r = Kb @('set-status', '--id', $workId, '--status', 'archived', '--json')
  Check '工作页可归档' ($r.text -match '"changed":true') $r.text
  $r = Kb @('consolidate', '--json')
  $jsonArchived = $r.text | ConvertFrom-Json
  Check '归档工作页不再计入 pages' (-not ($jsonArchived.work.pages | Where-Object { $_.id -eq $workId })) ($jsonArchived.work.pages | ConvertTo-Json -Compress)
  Check '归档工作页不算缺页' (-not ($jsonArchived.work.missing -contains 'project:smoke-app')) ($jsonArchived.work.missing -join ',')
  $r = Kb @('set-status', '--id', $workId, '--status', 'active', '--json')
  Check '工作页可恢复' ($r.text -match '"changed":true') $r.text
  # Batch must validate the whole set before writing: the mixed batch is invalid
  # because a work page cannot move to inbox, so the atom must stay untouched.
  $r = Kb @('batch-status', '--ids', "2026-10-20-a-0009,$workId", '--status', 'inbox', '--json')
  Check '非法批量整体拒绝' ($r.code -ne 0 -and $r.text -match '工作页') $r.text
  $r = Kb @('validate')
  Check '被拒绝的批量没有半写' ($r.code -eq 0) $r.text
  # Archive, create a new active page for the scope, then restoring the old one
  # must be rejected instead of silently producing two active pages.
  $r = Kb @('set-status', '--id', $workId, '--status', 'archived', '--json')
  Check '工作页再次归档' ($r.text -match '"changed":true') $r.text
  $r = Kb @('work-new', '--scope', 'project:smoke-app', '--json')
  Check '归档后可以新建同 scope 工作页' ($r.text -match '"ok":true') $r.text
  $r = Kb @('set-status', '--id', $workId, '--status', 'active', '--json')
  Check '恢复旧工作页被拒（同 scope 已有 active）' ($r.code -ne 0 -and $r.text -match '已有 active 工作页') $r.text
  $r = Kb @('validate')
  Check '冲突恢复后 validate 仍通过' ($r.code -eq 0) $r.text

  Write-Host "`n[9] 删除清理与容错"
  # Deleting one note must only strip its links, never the prose sharing the line.
  $topic = Join-Path $base '20_Digest\topics\2026-10-20-t-0001.md'
  $mixedLine = "混合行：[[2026-10-20-a-0009]] 和 [[2026-10-20-a-0011]] 都应保留后者"
  [System.IO.File]::AppendAllText($topic, "`n$mixedLine`n", [System.Text.UTF8Encoding]::new($false))
  $req = (Kb @('delete-request', '--ids', '2026-10-20-a-0009', '--json')).text | ConvertFrom-Json
  $null = (Kb @('delete', '--ticket', $req.ticket, '--key', $req.key, '--json')).text
  $after = [System.IO.File]::ReadAllText($topic, [System.Text.Encoding]::UTF8)
  Check '删除只移除链接、保留混合行正文' ($after -match '混合行' -and $after -match '\[\[2026-10-20-a-0011\]\]' -and $after -notmatch '\[\[2026-10-20-a-0009\]\]') $after
  Check '删除后 validate 通过' ((Kb @('validate')).code -eq 0)
  # A note without frontmatter must be reported, not crash the validator.
  $broken = Join-Path $base '20_Digest\atoms\broken-note.md'
  [System.IO.File]::WriteAllText($broken, "# 没有 frontmatter`n", [System.Text.UTF8Encoding]::new($false))
  $r = Kb @('validate')
  Check '无 frontmatter 的笔记被报告而不是崩溃' ($r.code -ne 0 -and $r.text -match '缺少 frontmatter') $r.text
  Remove-Item $broken -Force
  $r = Kb @('validate')
  Check '移除坏笔记后 validate 恢复' ($r.code -eq 0) $r.text

  Write-Host "`n[10] 收尾校验"
  $r = Kb @('validate')
  Check '全部操作后 validate 仍通过' ($r.code -eq 0) $r.text
}
finally {
  if (Test-Path $base) { Remove-Item $base -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host ""
Write-Host ("规则层冒烟：" + $passed + " 通过 / " + $failed + " 失败")
if ($failed -gt 0) { exit 1 } else { exit 0 }
