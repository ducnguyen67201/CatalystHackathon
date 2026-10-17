# June workspace instructions

Read README.md and docs/Architecture.md before making changes. This is a standalone pnpm repository. Do not import source or credentials from sibling projects.

Use strict TypeScript, Zod at trust boundaries, Prisma inside persistence, and exact decimal arithmetic for financial calculations. Keep the local application bound to 127.0.0.1. It currently serves one local workspace; add account/membership authorization before remote deployment.

Use PascalCase for owned source/test/documentation filenames, preserving standard tool/config filenames. Do not introduce any or unchecked JSON assertions. Preserve source snapshots and financial history. Demo evidence must always be labeled fictional.

Finish implementation edits before validation. Run pnpm lint, pnpm format:check, pnpm typecheck, pnpm test, pnpm build and pnpm test:integration before handing off code changes. Do not publish, deploy, push, create paid sessions, or modify provider configuration unless requested.
