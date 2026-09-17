# ADR 003 — Use PostgreSQL

## Status

Accepted

## Context

Anveshan needs persistent storage for:

- programs
- assets
- relationships
- collection runs
- snapshots
- changes

The data is relational and requires consistent relationships and constraints.

## Decision

Use PostgreSQL.

Use Drizzle ORM for database access.

## Reason

The core data model is relational:

    Program
       │
       └── Program Assets
                 │
                 └── Asset

Collection runs and detected changes also have clear relational relationships.

PostgreSQL provides the required consistency, constraints, indexing, and querying capabilities.

## Consequences

### Positive

- Strong relational model
- Foreign keys
- Unique constraints
- Transactions
- Mature ecosystem

### Negative

- Requires database infrastructure
- Schema migrations must be managed

## Future

Database scaling decisions will be made based on actual workload rather than prematurely introducing distributed storage.
