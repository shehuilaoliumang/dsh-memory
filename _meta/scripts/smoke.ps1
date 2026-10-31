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
# Node writes UTF-8. Windows PowerShell 5.1 decodes native stdout with the
# console code page (936 here), which corrupts Chinese assertions ("45/55").
# Pin the console decoder and the native pipeline writer to UTF-8; keep the
# file itself BOM-prefixed so Windows PowerShell reads these Chinese comments.
$utf8 = New-Object System.Text.UTF8Encoding -ArgumentList $false
try { [Console]::OutputEncoding = $utf8 } catch { }
try { [Console]::InputEncoding = $utf8 } catch { }
$OutputEncoding = $utf8
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

  Write-Host "`n[7.5] 当前真相（supersedes）"
  # A pending replacement may point at a live claim, but must not retire it
  # before confirmation. Once confirmed, the old claim becomes superseded and
  # stops being injectable; both bodies stay on disk.
  $oldSpec = Join-Path $base 'spec-old.json'
  @{
    title = '冒烟旧结论'; type = 'fact'; scope = 'global'
    summary = '冒烟旧结论：只在副本里'; points = @('旧结论'); tags = @('测试')
    subject = 'smoke-truth'
  } | ConvertTo-Json -Depth 4 | Set-Content $oldSpec -Encoding UTF8
  $r = Kb @('add-atom', '--json-file', $oldSpec, '--json')
  $oldId = ([regex]::Match($r.text, '"id":"([^"]+)"')).Groups[1].Value
  $r = Kb @('set-status', '--id', $oldId, '--status', 'active', '--json')
  Check '旧结论已确认 active' ($r.text -match '"changed":true') $r.text
  $newSpec = Join-Path $base 'spec-new.json'
  @{
    title = '冒烟新结论'; type = 'fact'; scope = 'global'
    summary = '冒烟新结论：取代旧结论'; points = @('新结论'); tags = @('测试')
    subject = 'smoke-truth'; supersedes = @("[[$oldId]]")
  } | ConvertTo-Json -Depth 4 | Set-Content $newSpec -Encoding UTF8
  $r = Kb @('add-atom', '--json-file', $newSpec, '--json')
  $newId = ([regex]::Match($r.text, '"id":"([^"]+)"')).Groups[1].Value
  Check '新结论默认 inbox 写入' ($r.text -match '"ok":true') $r.text
  $oldText = Get-Content (Join-Path (Join-Path $base '20_Digest\atoms') ($oldId + '.md')) -Raw -Encoding UTF8
  Check '确认前旧结论仍 active' ($oldText -match '(?m)^status: active$') $oldText
  Check '待确认取代关系不阻塞 validate' ((Kb @('validate')).code -eq 0)
  $json = (Kb @('consolidate', '--json')).text | ConvertFrom-Json
  Check 'consolidate 报告待确认取代' (@($json.truth.pendingSupersedes) -contains $newId) ($json.truth.pendingSupersedes -join ',')
  # Feedback telemetry: the queue row is the only source of the prompt version,
  # so seed one before the confirmation and assert the label is appended.
  $stateDir = Join-Path $base '_meta\state'
  New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
  $queueRow = @{ id = 'smoke-judge-job'; sessionId = 'smoke'; promptVersion = 'smoke'; ids = @($newId) } | ConvertTo-Json -Compress
  Set-Content (Join-Path $stateDir 'judge-queue.jsonl') $queueRow -Encoding UTF8
  $r = Kb @('set-status', '--id', $newId, '--status', 'active', '--json')
  Check '确认新结论时旧结论退场' (($r.text -match '"retired":\["') -and ($r.text -match [regex]::Escape($oldId))) $r.text
  $feedbackFile = Join-Path $stateDir 'judge-feedback.jsonl'
  Check '确认写入裁判反馈' ((Test-Path $feedbackFile) -and ((Get-Content $feedbackFile -Raw -Encoding UTF8) -match [regex]::Escape($newId)) -and ((Get-Content $feedbackFile -Raw -Encoding UTF8) -match '"accepted":true'))

  Write-Host "`n[7.6] 裁判黄金集回归"
  # The committed predictions are model output for the committed prompt. This
  # check is deterministic and guards precision from prompt/config drift.
  $evalScript = Join-Path $base '_meta\scripts\eval-judge.mjs'
  $goldenFile = Join-Path $base '_meta\rules\golden.jsonl'
  $predictionFile = Join-Path $base '_meta\rules\judge-predictions-2026-10-29.jsonl'
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $evalOut = & node $evalScript --golden $goldenFile --adapter predictions --predictions $predictionFile --min-cases 100 --fail-below 0.8 2>&1
    $evalCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  Check '黄金集 precision 仍 ≥0.8' ($evalCode -eq 0 -and (($evalOut -join "`n") -match 'precision=([0-9.]+)')) (($evalOut -join "`n") -split "`n" | Select-Object -First 2 | Out-String)

  # A stale prediction file must fail closed: promptVersion alone is a label,
  # promptHash is the content fingerprint, so mutate the label and require
  # rejection rather than silently reusing old predictions.
  $stalePredictions = Join-Path $stateDir 'judge-predictions-stale.jsonl'
  (Get-Content $predictionFile -Raw -Encoding UTF8) -replace '"promptVersion":"[^"]+"', '"promptVersion":"stale"' | Set-Content -NoNewline -Encoding UTF8 $stalePredictions
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $staleOut = & node $evalScript --golden $goldenFile --adapter predictions --predictions $stalePredictions --min-cases 100 --fail-below 0.8 2>&1
    $staleCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  Check '预测版本不符时评估失败' ($staleCode -ne 0 -and (($staleOut -join "`n") -match 'promptVersion|promptHash|不一致')) (($staleOut -join "`n") -split "`n" | Select-Object -First 2 | Out-String)
  $oldText = Get-Content (Join-Path (Join-Path $base '20_Digest\atoms') ($oldId + '.md')) -Raw -Encoding UTF8
  Check '旧结论变为 superseded' ($oldText -match '(?m)^status: superseded$') $oldText
  Check '退场后 validate 通过' ((Kb @('validate')).code -eq 0)

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
  # The real command refuses non-TTY input; no environment variable may bypass
  # that. Successful deletion is covered only by a manual TTY run.
  $r = Kb @('delete-request', '--ids', '2026-10-20-a-0009', '--json')
  Check '非交互终端拒绝生成删除密钥' ($r.code -ne 0 -and $r.text -match '交互终端') $r.text
  $smokeKey = 'SMOKE-DELETE-KEY'
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $hashBytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($smokeKey)) } finally { $sha.Dispose() }
  $keyHash = ([System.BitConverter]::ToString($hashBytes)).Replace('-', '').ToLowerInvariant()
  $now = [DateTime]::UtcNow
  $ticketId = 'del-smoke'
  $ticketJson = @{
    ticket = $ticketId
    keyHash = $keyHash
    ids = @('2026-10-20-a-0009')
    createdAt = $now.ToString('o')
    expiresAt = $now.AddMinutes(5).ToString('o')
  } | ConvertTo-Json -Compress
  $ticketFile = Join-Path $base '_meta\state\delete-ticket.json'
  [System.IO.Directory]::CreateDirectory((Split-Path $ticketFile -Parent)) | Out-Null
  [System.IO.File]::WriteAllText($ticketFile, $ticketJson, [System.Text.UTF8Encoding]::new($false))
  $r = Kb @('delete', '--ticket', $ticketId, '--key', $smokeKey, '--json')
  Check 'delete 非 TTY 拒绝' ($r.code -ne 0 -and $r.text -match '交互终端') $r.text
  $oldNonInteractive = $env:KB_NONINTERACTIVE_TEST
  $env:KB_NONINTERACTIVE_TEST = '1'
  try {
    $r = Kb @('delete', '--ticket', $ticketId, '--key', $smokeKey, '--json')
  } finally {
    if ($null -eq $oldNonInteractive) { Remove-Item Env:\KB_NONINTERACTIVE_TEST -ErrorAction SilentlyContinue } else { $env:KB_NONINTERACTIVE_TEST = $oldNonInteractive }
  }
  Check 'delete 忽略测试环境变量' ($r.code -ne 0 -and $r.text -match '交互终端') $r.text
  Check '失败删除保留票据与目标笔记' ((Test-Path $ticketFile) -and (Test-Path (Join-Path $base '20_Digest\atoms\2026-10-20-a-0009.md')))
  # A note without frontmatter must be reported, not crash the validator.
  $broken = Join-Path $base '20_Digest\atoms\broken-note.md'
  [System.IO.File]::WriteAllText($broken, "# 没有 frontmatter`n", [System.Text.UTF8Encoding]::new($false))
  $r = Kb @('validate')
  Check '无 frontmatter 的笔记被报告而不是崩溃' ($r.code -ne 0 -and $r.text -match '缺少 frontmatter') $r.text
  Remove-Item $broken -Force
  $r = Kb @('validate')
  Check '移除坏笔记后 validate 恢复' ($r.code -eq 0) $r.text

  Write-Host "`n[10] 索引容错"
  # A truncated catalog line must produce a clean, actionable error, not a stack.
  $catalog = Join-Path $base '_meta\catalog.jsonl'
  $backup = "$catalog.bak"
  Copy-Item $catalog $backup -Force
  $raw = [System.IO.File]::ReadAllText($catalog, [System.Text.Encoding]::UTF8)
  $newline = $raw.IndexOf("`n")
  $truncated = '{"broken":' + $(if ($newline -ge 0) { $raw.Substring($newline) } else { '' })
  [System.IO.File]::WriteAllText($catalog, $truncated, [System.Text.UTF8Encoding]::new($false))
  $r = Kb @('validate')
  Check '截断索引报明确错误而不是崩溃' ($r.code -ne 0 -and $r.text -match '索引损坏' -and $r.text -match '第 1 行') $r.text
  Move-Item $backup $catalog -Force
  Check '恢复索引后 validate 通过' ((Kb @('validate')).code -eq 0)

  Write-Host "`n[10.5] 只读检索"
  $r = Kb @('search', '--query', '删除 密钥', '--limit', '3', '--json')
  $search = $r.text | ConvertFrom-Json
  Check 'search 返回命中且首位是删除闸偏好' ($r.code -eq 0 -and @($search.results).Count -ge 1 -and $search.results[0].id -eq '2026-10-28-a-0002') $r.text
  $r = Kb @('search', '--query', '不存在的词xyz', '--json')
  $none = $r.text | ConvertFrom-Json
  Check 'search 无意义查询不误命中' ($r.code -eq 0 -and $none.total -eq 0) $r.text
  $r = Kb @('search', '--json')
  Check 'search 缺少 query 时报错' ($r.code -ne 0 -and $r.text -match '需要 --query') $r.text

  Write-Host "`n[10.55] 触发词不误伤"
  $r = Kb @('candidates', '--text', '这只是一段普通的笔记，个别地方需要检查。', '--json')
  $plainNote = $r.text | ConvertFrom-Json
  Check '“笔记/个别”不误触触发词' ($r.code -eq 0 -and $plainNote.gate.skip -eq $true) $r.text
  $r = Kb @('candidates', '--text', '我的天，这个界面真好看。', '--json')
  $plainMine = $r.text | ConvertFrom-Json
  Check '“我的天”不误触触发词' ($r.code -eq 0 -and $plainMine.gate.skip -eq $true) $r.text

  Write-Host "`n[10.6] 脱敏"
  $fakeSk = 'sk-' + 'proj-abcdefghijklmnopqrstuvwx'
  $cnPassword = 'Abcd' + '1234'
  $dbUrl = 'postgres://app:' + 's3cretpw' + '@db.example/app'
  $mobile = '138' + '00138000'
  $idCard = '110105' + '19491231' + '002X'
  $secretPath = Join-Path $base 'secret.txt'
  Set-Content $secretPath (('api_key = "abcdEFGH12345678" and token ' + $fakeSk) + "`n密码是 $cnPassword`n连接串 $dbUrl`n电话 $mobile`n身份证 $idCard") -Encoding UTF8
  $r = Kb @('append-session', '--slug', 'redact-smoke', '--session-id', 'smoke-redact', '--title', '脱敏测试', '--text-file', $secretPath)
  Check 'append-session 成功' ($r.code -eq 0) $r.text
  $sessionFile = Get-ChildItem (Join-Path $base '10_Raw\sessions') -Recurse -Filter '*redact-smoke*' | Select-Object -First 1
  Check 'append-session 已创建原文' ($null -ne $sessionFile)
  if ($sessionFile) {
    $sessionText = Get-Content $sessionFile.FullName -Raw -Encoding UTF8
    Check 'append-session 写入前脱敏' ($sessionText -match '\[REDACTED') $sessionText
    $fakeSkPrefix = 'sk-' + 'proj-'
    Check 'append-session 不落盘密钥' ($sessionText -notmatch 'abcdEFGH12345678' -and $sessionText -notmatch $fakeSkPrefix) $sessionText
    Check 'append-session 脱敏中文/短值/连接串' ($sessionText -notmatch $cnPassword -and $sessionText -notmatch 's3cretpw' -and $sessionText -match '\[REDACTED') $sessionText
    Check 'append-session 脱敏手机号/身份证' ($sessionText -notmatch $mobile -and $sessionText -notmatch $idCard -and $sessionText -match '\[REDACTED:phone\]' -and $sessionText -match '\[REDACTED:id-card\]') $sessionText
  }
  # The Host trigger rebuilds after append-session; standalone callers must do the same.
  $null = Kb @('rebuild')

  Write-Host "`n[10.7] Phase 4 契约"
  $r = Kb @('append-session', '--slug', 'json-smoke', '--session-id', 'smoke-json-1', '--title', 'JSON 契约', '--text', '决定保持 JSON 契约', '--json')
  $json1 = $r.text | ConvertFrom-Json
  Check 'append-session --json 返回文件路径' ($r.code -eq 0 -and $json1.ok -eq $true -and $json1.file -match 'json-smoke') $r.text
  $r = Kb @('append-session', '--slug', 'json-smoke', '--session-id', 'smoke-json-2', '--title', 'JSON 契约 2', '--text', '决定保持 JSON 契约 2', '--json')
  $json2 = $r.text | ConvertFrom-Json
  Check '同分钟新建会话不撞文件' ($r.code -eq 0 -and $json2.file -ne $json1.file) $r.text
  $expectedVersion = (Get-Content (Join-Path $base 'VERSION') -Raw).Trim()
  $r = Kb @('version')
  Check 'version 返回 VERSION' ($r.code -eq 0 -and $r.text.Trim() -eq $expectedVersion) $r.text
  $r = Kb @('init')
  Check 'init 幂等创建目录' ($r.code -eq 0 -and $r.text -match '就绪') $r.text
  $null = Kb @('rebuild')

  Write-Host "`n[10.8] Phase 5 多项目库"
  $project = Join-Path $base 'phase5-project'
  $store = Join-Path $project '.dsh-memory'
  $registry = Join-Path $base 'phase5-projects.json'
  $r = Kb @('--root', $store, 'init', '--slug', 'smoke-project', '--title', 'Smoke Project')
  Check 'init --root 创建项目库' ($r.code -eq 0 -and (Test-Path (Join-Path $store 'project.json'))) $r.text
  $meta = Get-Content (Join-Path $store 'project.json') -Raw | ConvertFrom-Json
  Check 'project.json 写入 slug' ($meta.slug -eq 'smoke-project') $r.text
  $r = Kb @('--root', $store, 'validate')
  Check '新项目库 validate 通过' ($r.code -eq 0) $r.text
  $r = Kb @('--root', $store, 'version')
  Check '--root 读取项目版本' ($r.code -eq 0 -and $r.text.Trim() -eq $expectedVersion) $r.text
  $newConfig = Get-Content (Join-Path $store '_meta\config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  Check 'init 默认触发词 20 项' (@($newConfig.extract.trigger_words).Count -eq 20) ''
  Check 'init 默认 meta 关键词 10 项' (@($newConfig.extract.meta_keywords).Count -eq 10) ''
  $r = Kb @('--root', $store, 'attach', '--registry', $registry, '--json')
  $attach = $r.text | ConvertFrom-Json
  Check 'attach 登记项目库' ($r.code -eq 0 -and $attach.ok -eq $true -and (Test-Path $registry)) $r.text
  $r = Kb @('--root', $store, 'attach', '--registry', $registry, '--json')
  $reg = Get-Content $registry -Raw | ConvertFrom-Json
  Check 'attach 幂等且不重复登记' ($r.code -eq 0 -and @($reg.projects).Count -eq 1) $r.text

  $r = Kb @('--root', $store, 'attach', '--registry', $registry, '--write', '--json')
  Check 'attach --write 非 TTY 拒绝' ($r.code -ne 0 -and $r.text -match '交互终端') $r.text
  $oldNonInteractive = $env:KB_NONINTERACTIVE_TEST
  $env:KB_NONINTERACTIVE_TEST = '1'
  try {
    $r = Kb @('--root', $store, 'attach', '--registry', $registry, '--write', '--json')
    $cfgAfter = Get-Content (Join-Path $store '_meta\config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $regAfter = Get-Content $registry -Raw | ConvertFrom-Json
  } finally {
    if ($null -eq $oldNonInteractive) { Remove-Item Env:\KB_NONINTERACTIVE_TEST -ErrorAction SilentlyContinue } else { $env:KB_NONINTERACTIVE_TEST = $oldNonInteractive }
  }
  Check 'attach --write 忽略测试环境变量' ($r.code -ne 0 -and $r.text -match '交互终端') $r.text
  Check '失败的 attach --write 不改写权限' ($regAfter.projects[0].writable -eq $false -and $cfgAfter.ingest.enabled -eq $false -and $cfgAfter.judge.enabled -eq $false)
  $r = Kb @('--root', $store, 'attach', '--registry', $registry, '--read-only', '--json')
  $cfgReadOnly = Get-Content (Join-Path $store '_meta\config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $regReadOnly = Get-Content $registry -Raw | ConvertFrom-Json
  Check 'attach --read-only 关闭写入并登记只读' ($r.code -eq 0 -and $cfgReadOnly.ingest.enabled -eq $false -and $cfgReadOnly.judge.enabled -eq $false -and $regReadOnly.projects[0].writable -eq $false) $r.text
  $missing = Join-Path $base 'not-a-store'
  $r = Kb @('--root', $missing, 'validate')
  Check '缺配置根报错而不是崩溃' ($r.code -ne 0 -and $r.text -match '不是知识库') $r.text

  Write-Host "`n[10.9] N5 同 subject 当前真相"
  $n5Spec = Join-Path $base 'n5-atom.json'
  $n5Write = { param($path, $value) [System.IO.File]::WriteAllText($path, ($value | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false))) }
  & $n5Write $n5Spec @{ title = 'N5 A'; type = 'decision'; summary = 'N5 claim a'; points = @('a'); status = 'active'; scope = 'global'; subject = 'smoke-subject' }
  $r = Kb @('--root', $store, 'add-atom', '--json-file', $n5Spec, '--json')
  $n5First = $r.text | ConvertFrom-Json
  Check 'N5 首条 active 写入' ($r.code -eq 0 -and $n5First.ok -eq $true) $r.text
  & $n5Write $n5Spec @{ title = 'N5 B'; type = 'decision'; summary = 'N5 claim b'; points = @('b'); status = 'active'; scope = 'global'; subject = 'smoke-subject' }
  $r = Kb @('--root', $store, 'add-atom', '--json-file', $n5Spec, '--json')
  Check 'N5 第二条 active 同 subject 被拒绝' ($r.code -ne 0 -and $r.text -match 'subject') $r.text
  & $n5Write $n5Spec @{ title = 'N5 B2'; type = 'decision'; summary = 'N5 claim b2'; points = @('b2'); status = 'active'; scope = 'global'; subject = 'smoke-subject'; supersedes = @($n5First.id) }
  $r = Kb @('--root', $store, 'add-atom', '--json-file', $n5Spec, '--json')
  $n5Second = $r.text | ConvertFrom-Json
  Check 'N5 supersedes 明确取代并退场旧条' ($r.code -eq 0 -and $n5Second.retired -contains $n5First.id) $r.text
  $r = Kb @('--root', $store, 'validate')
  Check 'N5 取代后 validate 通过' ($r.code -eq 0) $r.text

  Write-Host "`n[11] 收尾校验"
  $r = Kb @('validate')
  Check '全部操作后 validate 仍通过' ($r.code -eq 0) $r.text
}
finally {
  if (Test-Path $base) { Remove-Item $base -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host ""
Write-Host ("规则层冒烟：" + $passed + " 通过 / " + $failed + " 失败")
if ($failed -gt 0) { exit 1 } else { exit 0 }
