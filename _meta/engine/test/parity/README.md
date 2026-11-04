# 3.0 P1 parity baseline (legacy note)

This directory stores a *point-in-time behavioural baseline* captured from the
2.4.1 Host before the unified read model landed. It is not a golden truth: the
store content changes as the vault gains memories, so the comparison script
allows new notes/rows while requiring that shared candidates keep the same
selection, labels and source order.

- `baseline-2.4.1.json` — captured 2026-11-04 from
  `http://127.0.0.1:1518` with session
  `session-<redacted>71-5777-473a-859d-880e2132bb91`.
- `capture-parity.mjs` — regenerate the baseline from a running Host:
  `node _meta/engine/test/capture-parity.mjs --base http://127.0.0.1:1518 --session <id> --out _meta/engine/test/parity/baseline-2.4.1.json`

## Compare

`node _meta/engine/test/compare-parity.mjs` loads the baseline and the engine
read model on the current vault, then checks:

- workspace id/label/kind list (order may change only if stores are added);
- default session view;
- injection entries for the session scope (`a-0004,a-0002,a-0003` in the
  baseline) — exact ids, order and sources;
- note ids that exist in both the baseline and the current vault: level,
  status, updated and injection state/label must match; new notes are reported
  as drift, not failures;
- search `jiyi` and `zzqqxx` for `all` and `legacy`: exact total/strategy/row
  ids/workspace/matchedBy; `发布` allows extra newly added rows but requires the
  baseline rows to remain in the same relative order.

A failure means the read model changed observable behaviour; a drift line is
content added after the baseline and is expected.
