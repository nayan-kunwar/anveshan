# ADR 002 — Use Express.js

## Status

Accepted

## Context

Anveshan needs a small HTTP API for exposing collected programs, assets, and changes.

Possible Node.js frameworks include:

- Express
- Fastify
- NestJS

## Decision

Use Express.js with TypeScript.

## Reason

The MVP does not require extremely high HTTP throughput.

The primary workload is:

    External API
         ↓
    Collection
         ↓
    PostgreSQL
         ↓
    Change Detection

The HTTP API is primarily used to inspect collected data.

Express provides a simple and mature foundation while keeping the project focused on the collector and monitoring pipeline.

## Consequences

### Positive

- Simple HTTP layer
- Large ecosystem
- Familiar middleware model
- Low additional complexity

### Negative

- Some functionality requires additional packages
- Less opinionated architecture

## Future

The HTTP framework can be reconsidered if the system develops requirements that justify a different framework.
