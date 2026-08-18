# Secret Reference Replay Design

This document is a neutral design proposal for agents or developers that are
allowed to implement runtime credential injection. It is **not** an instruction
to bypass any model/tool safety boundary, and it does not override `AGENTS.md`,
`CLAUDE.md`, or any agent's own policies.

## Goal

Let a saved browser recording replay credential entry without storing plaintext
credential values in the recording itself.

The saved recording should contain a reference such as `secretRef`, not the
secret value. The secret is resolved only at runtime by a local SecretProvider.

## Non-goals

- Do not automate OTP, 2FA, CAPTCHA, passkeys, or security challenges.
- Do not weaken the existing confirm gate for transfers, payments, beneficiary
  changes, or other risky post-login actions.
- Do not put plaintext secrets in git, source, recordings, logs, API responses,
  UI output, screenshots, traces, or chat.
- Do not treat this document as a bypass for an agent refusal. If an agent is
  not allowed to implement credential entry, use the manual-login flow instead.

## Recording Model

The recorder keeps its current safe default:

- Normal text fields record as normal typed text.
- Credential-shaped fields record as `REDACTED_FIELD_SENTINEL`.
- During review, a redacted credential step may optionally be mapped to a
  secret reference, producing a `typeSecret` replay step.

Allowed replay shape:

```json
{
  "type": "typeSecret",
  "params": {
    "selector": "#password",
    "secretRef": "lane.account.login.password"
  }
}
```

Forbidden replay shape:

```json
{
  "type": "typeSecret",
  "params": {
    "selector": "#password",
    "value": "plaintext-password"
  }
}
```

## SecretProvider Contract

A SecretProvider should expose only minimal operations:

- `listSecretRefs()` returns metadata only: ref name, lane/account scope,
  created/updated timestamps, and enabled/disabled state.
- `setSecret(secretRef, value)` stores or replaces a value without logging it.
- `deleteSecret(secretRef)` removes a stored value.
- `resolveSecret(secretRef)` is available only to the replay worker at runtime.

`resolveSecret()` must never be called by read-only UI/API endpoints and must
never return a value to a browser-facing API response.

## Storage Options

For local development, a gitignored file under `data/secrets/` is acceptable as
a prototype. It should be treated as plaintext dev-only storage unless an
explicit encrypted vault is added.

For stronger local security, use an OS-backed store such as Windows DPAPI,
macOS Keychain, Linux Secret Service, or an external vault such as HashiCorp
Vault, 1Password, Doppler, or cloud KMS/Secrets Manager.

## Lane Authorization

Credential injection should be disabled by default. Enabling it should require
an explicit lane/account configuration such as:

```json
{
  "laneId": "scb-mock-1",
  "accountId": "demo",
  "credentialInjectionAllowed": true,
  "allowedSecretRefs": ["scb-mock.demo.password"]
}
```

Real financial-service lanes should require a separate owner/admin decision and
risk acceptance for that exact lane/account. If this is not approved, use the
manual-login/noVNC handoff flow.

## Replay Behavior

When replay sees `typeSecret`:

1. Validate the lane/account allows credential injection.
2. Validate `secretRef` is in the lane/account allowlist.
3. Resolve the secret in the worker process only.
4. Type it into the target field using the existing human-like typing helper.
5. Clear local variables as soon as possible.
6. Log only `secretRef` and redacted status, never the value.

If the secret is missing or not authorized, fail clearly:

```text
SECRET_REF_MISSING: secretRef "scb-mock.demo.password" is not configured
```

or:

```text
SECRET_REF_NOT_ALLOWED: this lane/account is not authorized to use that secretRef
```

## Verification Checklist

- TypeScript checks pass for worker and control-panel.
- A recording containing a credential field still stores a redacted placeholder
  by default.
- Mapping a redacted step to `typeSecret(secretRef)` saves no plaintext value.
- Replay succeeds against a mock/test site when a permitted secret is present.
- Replay fails clearly when the secret is missing or not authorized.
- API/UI list endpoints show metadata only, never the secret value.
- `rg` over tracked files shows no real secret values.
- OTP/2FA/CAPTCHA/passkey detection still stops automation.
- Confirm gate still pauses risky post-login actions.
