# AGENTS

## Repo Search

When investigating this repository, prefer Qdrant MCP search before workspace full-text search.

Start with qdrant-find using the templates in docs/QDRANT_QUERY_TEMPLATES.md.

Use two-step retrieval when possible: first by feature intent, then by links tokens such as belongs_to, tested_by, related_doc, and imports.

Use workspace full-text search only for exact symbol checks, line-level verification, or when Qdrant is unavailable, stale, or returns weak results.

If recent changes may not be indexed yet, run the refresh and validation workflow from docs/QDRANT_QUERY_TEMPLATES.md before relying on retrieval.
