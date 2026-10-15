# Implementation checklist

- App type: frontend+backend; template: react-vite.
- Workflows: create lobby, join by code, fill bots, start, play four actions, live update, finish, read replay/API docs.
- Backend: bounded database reads, conditional writes, subscription routes, WebSocket updates, no secrets or payments.
- Tests: five independent coverage-complete tests; exactly one sanity test; one mobile guardrail test.
- Preflight: template placeholders replaced, source formatted, JSON parsed, all material routes mapped to tests, no absolute SPA routes, frontend/backend SDK imports separated.
