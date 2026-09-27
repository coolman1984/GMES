# Contracts — the sockets between modules (inside this app)

A module may import only `kernel/`, `contracts/`, `@eco/contracts` and its own folder.
What one module needs from another is typed here and reached at run time through
`ctx.services.get(...)`. `test/boundaries.test.ts` fails on any other import.

(Not to be confused with `@eco/contracts`, the contracts BETWEEN applications.)
