# ADR 001 — Start With an API Collector

## Status

Accepted

## Context

Anveshan needs to monitor bug-bounty programs and their scopes.

There are multiple possible ways to obtain this information:

- official APIs
- web scraping
- feeds
- webhooks
- other sources

The first milestone needs to prove that the core monitoring pipeline works.

## Decision

Start Anveshan with a single API collector.

The collector will use a real bug-bounty platform API.

No scraping or other collector types will be implemented in the MVP.

## Reason

An API provides structured data and allows the core system to be developed without coupling the initial implementation to HTML parsing.

The first goal is to validate:

    API
      ↓
    Collection
      ↓
    Normalization
      ↓
    Persistence
      ↓
    Snapshot
      ↓
    Diff

## Consequences

### Positive

- Structured data
- Easier normalization
- Clear collector boundary
- Easier testing
- Core architecture can be validated first

### Negative

- Dependent on API availability
- Dependent on API limits
- API may not expose every piece of information needed

## Future

Additional collectors can be introduced later without changing the core diff engine if they produce the same normalized domain objects.
