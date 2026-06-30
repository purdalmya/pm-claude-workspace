# Otto — Product Backlog

> Living backlog. Claude maintains and re-prioritizes this as items are added and the product evolves.
> Last prioritized: 2026-06-30

> **Name:** **Otto** — "your chief of staff for product management." (Decided 2026-06-30.) Repo/dir and `pm-claude-*` storage keys keep their old names intentionally — renaming the keys would wipe users' saved PRDs.

## North Star
A **PM thinking partner that accumulates context** about your product and decisions. You sell the *thinking*, not the document — the PRD is disposable exhaust that gets copied into Confluence within the hour. The moat is **memory**: every PRD makes the next one smarter and more consistent.

## ICP
The **individual PM** who wants to bypass corporate red tape on AI tooling and just get their work done. Personal card, below expense-approval threshold ($35/mo), zero IT involvement. Land individual → expand to team later (don't poison that well).

---

## NOW (launch blockers + cheap high-leverage)

| # | Item | Why now | Notes |
|---|------|---------|-------|
| 1 | **Replace / secure API keys before launch** | Security + functional blocker. Hardcoded key in frontend (`API_KEY` in `PMClaudeWorkspace.jsx`) is exposed to every visitor; the current key is also invalid (401). | Remove ALL client-side keys + the dead `x-api-key` header; set a valid `ANTHROPIC_API_KEY` server-side in Vercel; rotate the leaked key. |
| 2 | **Rewrite copy for the new ICP** | Aligns the whole product to "individual PM bypassing red tape" before anyone sees it. Cheap, high-leverage. | Hero, taglines, footer ($35/mo line), empty states, button labels. Voice = "just do your work," speed, no corporate friction. |
| 3 | **Memory MVP — design** | The flagship differentiator; design can start in parallel with #1/#2. | See "Memory UX" exploration. Decide capture model, recall UX, and the "what I remember" profile. |
| 4 | **Verify "Otto" is ownable before committing** | Name is decided but unvalidated — "Otto" is a crowded brand stem and `otto.com` is gone. Cheap to check, expensive to get wrong after you print/market. | 30-min check: trademark search in software/SaaS class, domain availability (favorite: `otto.pm`; fallbacks getotto/useotto/askotto), App Store + search scan. If exact word is too crowded, fix with a modifier, not a new name. |

## NEXT (core differentiation)

| # | Item | Why | Notes |
|---|------|-----|-------|
| 5 | **Memory MVP — build** | This is the moat against the $0 substitute (ChatGPT + a pasted prompt). Without it you're a disposable prompt wrapper. | Built as vertical slices: ✅ #1 multi-PRD storage (localStorage array), ✅ #2 context chips → injected generation, ✅ #3 "What I remember" profile (Claude-synthesized, editable, injected). ⬜ #4 history/search drawer (low priority). |
| 6 | **Validate riskiest assumption** | Memory increases shadow-IT data exposure — the exact thing red tape exists to police. Could be moat or kill-switch. | 5 target PMs: "Would you paste confidential PRD context into an unapproved tool — and does it getting smarter make you more or less comfortable?" |

## LATER (depends on validation / scale)

| # | Item | Why | Notes |
|---|------|-----|-------|
| 7 | **Data ownership / export** ("your data leaves with you") | Defuses the shadow-IT risk; part of the pitch to the individual who's personally on the hook. | Easy export, clear deletion, possibly local-first storage as a selling point. |
| 8 | **Accounts / cross-device persistence** | Memory currently lives in `localStorage` (single browser). Real memory needs to follow the user. | Gates the memory moat at scale; keep auth friction near-zero to protect the wedge. |
| 9 | **Team memory** | The bigger monetization unlock (per-seat institutional memory). | Don't build now — it's the expansion path, not the wedge. |

---

## Engineering cleanups (small, opportunistic)

- [ ] Copy-to-clipboard uses rendered `innerText` (tab-separated tables) — switch to raw markdown for fidelity. (`PMClaudeWorkspace.jsx`)
- [ ] Remove the now-useless `x-api-key` header the frontend sends to `/api/generate` (folds into #1).

## Parked / someday

- Multi-PRD management UI (only if users actually want to live in the app — current behavior says they don't).
- Versioning / comments / sharing — explicitly **not** building; you'd lose to Notion/Confluence.

---

### How prioritization works here
- **NOW** = blocks launch or is cheap + high-leverage. **NEXT** = core differentiation. **LATER** = valuable but gated by a dependency or a validation result.
- Add anything to the bottom under "Inbox" (below) and Claude will slot + justify it on the next pass.

## Inbox (unsorted — drop new ideas here)
- **Memory empty / cold-start state** — the first PRD has nothing to remember. Design the first-run experience so memory feels valuable on PRD #1, not just #11 (e.g. "I'll start remembering from here," seed from a quick profile setup). Matters a lot for ICP first impression.
