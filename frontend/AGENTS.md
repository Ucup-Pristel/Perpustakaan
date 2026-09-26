# Frontend Engineering Instructions

This directory contains the React frontend.

## Stack

Use the existing stack:

- React 19
- Vite 8
- Tailwind CSS 4
- react-router-dom 7
- react-pdf 11
- lucide-react
- oxlint

Do not add another frontend framework, router, state-management framework, CSS framework, or build system unless explicitly required.

## Development

The Vite development server uses `/api` through the existing proxy to:

http://127.0.0.1:3000

Do not hardcode production API URLs into components.

Use the project's existing API URL/environment strategy.

Production uses:

VITE_API_URL=https://api.edulib.id

## Production

The frontend is deployed independently using Azure Static Web Apps.

Do not deploy the frontend to the backend VPS unless explicitly instructed.

Changes to frontend deployment should inspect the existing Azure Static Web Apps GitHub Actions workflow first.

Do not replace the Azure deployment architecture merely for convenience.

## React Conventions

Prefer functional components and existing project patterns.

Reuse existing components and contexts before introducing new architecture.

Do not add Redux, Zustand, MobX, or another global state library unless the application genuinely requires it.

Preserve the existing authentication flow through React Context unless explicitly redesigning authentication.

Keep components readable and focused.

Do not create abstractions for trivial one-use behavior.

## API Integration

Respect existing backend response contracts.

Do not silently change expected response shapes.

Handle:
- loading states
- request failures
- authentication failures
- missing/empty data

Do not expose credentials or secrets in frontend code.

Remember that anything shipped to the browser is public.

## Reader

The PDF reader uses react-pdf.

Preserve reading-progress and notes behavior unless the task specifically changes them.

Avoid rendering strategies that unnecessarily increase browser memory usage.

When changing Reader behavior, consider:
- page loading
- scrolling
- active page detection
- saved reading progress
- notes
- responsive sizing

## Validation

After meaningful frontend changes, prefer:

1. targeted inspection
2. npm run lint
3. npm run build

Run heavier verification when the scope warrants it.

Do not claim the frontend is production-ready if the production build has not been checked.