# Session Notes — Usage Limit

## What happened
This session hit a usage-limit problem: an hourly PR check-in loop (watching
PR #4) kept firing and re-checking status even when nothing changed, burning
through the token budget on repeated no-op turns.

## Rule going forward
**Single pass only, per request.** Do the requested work once, report the
result, and stop — no automatic recurring check-ins or background polling
loops unless explicitly asked for.

## Action taken
- Stopped scheduling further automatic check-ins on PR #4.
- This file documents the reason so future sessions don't reintroduce
  the same polling pattern.
