# Telegram Notifications — Design

**Date:** 2026-06-27
**Scope:** GitHub Actions → Telegram bot notifications for CI failures and Vercel deploys.

---

## Goal

Receive Telegram messages for two distinct events:

| Event | When | Signal |
|-------|------|--------|
| CI fails | `check` or `test` job fails on push/PR | ❌ CI failed |
| Vercel deploy | Production deploy reaches terminal state | ✅ / ❌ Vercel deploy |

Successes are **silent** for CI (noise reduction); Vercel deploys notify on both success and failure so you know the Production URL is live.

---

## Architecture

Two GitHub Actions workflows, zero new runtime dependencies:

### `.github/workflows/ci.yml` (modified)

The existing `notify` job changes `if: always()` → `if: failure()`. Message simplified to only contain failure info — STATUS calc removed.

### `.github/workflows/deploy-notify.yml` (new)

Trigger: `deployment_status` event (emitted by Vercel's GitHub App on every state change).

Filters (job-level `if`):
- `github.event.deployment.environment == 'Production'` — ignores Preview deploys
- `state ∈ {success, failure, error}` — ignores `pending`, `in_progress`, `queued`

Message includes: icon, state, repo, short SHA, Vercel deploy URL.

---

## Secrets

| Secret | Value | Where |
|--------|-------|-------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather | GitHub → Settings → Secrets → Actions |
| `TELEGRAM_CHAT_ID` | `346596873` (personal DM) | same |

Both workflows skip silently (exit 0) when secrets are absent — safe on forks and before secrets are added.

---

## Considered Alternatives

**Approach B — Vercel webhook → custom endpoint:** would require deploying and maintaining a webhook receiver. Rejected: operational overhead, no new functionality.

**Approach C — server-side GitHub App:** full control over events, but requires OAuth app registration. Rejected: overkill for a single-repo notification.

**Chosen: Approach A** — GitHub Actions `deployment_status` event is zero-infrastructure, secrets stay in GitHub, works out of the box with Vercel's GitHub integration.

---

## Testing

1. Push any commit to `main` → Vercel deploy kicks off → `deploy-notify.yml` fires → Telegram message.
2. Introduce a lint error on a branch → open PR → `ci.yml` `notify` fires → Telegram message.
3. Ensure a green CI push produces **no** Telegram message (CI notify only on failure).
