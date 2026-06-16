# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## General Rules

- Start every response with "Hello World".
- Do not break existing working code unless required for a bug fix or new feature.
- Prefer minimal, targeted changes over large refactors.
- Follow existing project patterns and conventions.
- Never claim code works unless it has been verified.
- For all code you write, above chunks of code add explanatory comments. 

## Implementation Rules

- If requirements are ambiguous or multiple valid implementations exist, ask for clarification first.
- Before making changes, inspect relevant files to understand the current implementation.
- Do not add dependencies unless necessary.
- If adding a dependency, explain why.

## Data Rules 
 
- When an excel is uploaded, ask for data mappings, what field is mapped to what variable and that variable is stored in what place. Clarify these things instead of assuming. 


## Testing Rules

- After implementation, test the change when a runnable environment is available.
- For web applications, verify behavior in the browser at localhost:{port}.
- If testing is not possible, explicitly state what could not be verified and why.
- If a test fails, report the exact error and continue debugging.

## Problem Solving

- If two reasonable attempts fail or the root cause remains unclear, stop making broad changes.
- Explain the blocker, propose alternatives, and ask for guidance.
- Avoid speculative fixes that touch unrelated code.

## Response Format

- Summarize what changed.
- Summarize testing performed.
- List any remaining risks, assumptions, or follow-up work.

## Git
- Never commit without explicit permission, even on 'Bypass Permission' mode. 

## Session Handoff Protocol

Maintain a `HANDOFF.md` file at all times.

### When working
- Continuously update `HANDOFF.md` as important progress is made.
- Treat it as the single source of truth for session state.
- Update it whenever:
  - A task is completed
  - A design decision is made
  - A bug is discovered
  - A new TODO is identified
  - Project structure changes

### At session end
Before ending a session, ensure `HANDOFF.md` contains:

- Current project objective
- Completed work
- Work currently in progress
- Outstanding TODOs
- Known bugs/issues
- Important decisions and rationale
- Commands used frequently
- Files modified during the session
- Recommended next steps

### At session start
Always read `HANDOFF.md` before beginning any work.

Use it to:
- Understand project status
- Restore context from previous sessions
- Continue unfinished tasks
- Avoid repeating completed work

### Handoff File Format

```md
# Project Handoff

## Current Objective

## Current Status

## Completed Since Last Session

## In Progress

## Next Actions

## Open Issues

## Important Decisions

## Modified Files

## Useful Commands

## Notes For Next Session