# ADR 004 — Snapshot-Based Change Detection

## Status

Accepted

## Context

Anveshan needs to detect when:

- a program is added
- an asset is added
- an asset is removed

The external API provides the current state.

Therefore, Anveshan needs a way to compare the current state with a previous state.

## Decision

Use snapshot-based change detection.

Each collection creates a representation of the observed state.

The current state is compared against the previous state.

## Example

Previous:

    example.com
    api.example.com
    old.example.com

Current:

    example.com
    api.example.com
    new.example.com

Diff:

    ASSET_ADDED
    new.example.com

    ASSET_REMOVED
    old.example.com

## First Collection

The first collection establishes the baseline.

No changes are emitted.

## Consequences

### Positive

- Deterministic
- Easy to reason about
- Easy to test
- Independent of the external platform's event system
- Works even when the API does not provide change events

### Negative

- Requires repeated collection
- Requires storing previous state
- Changes are detected after collection rather than instantly

## Future

If a platform later provides reliable event/webhook support, an event-driven collector may be introduced without removing the snapshot-based approach.
