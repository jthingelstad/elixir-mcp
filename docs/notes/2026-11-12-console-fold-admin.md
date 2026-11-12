# 2026-11-12 — The Console folds, part one: Admin and the service page

Jamie's ruling of 2026-11-12: the Console folds entirely. Explore's useful
reads move into You and the player pages and the rest retires (part two);
Collectors and Admin become Settings sections shown only to operators;
`/console` only redirects. This supersedes "Explore is a power-user
corner". This change is the Admin and service half.

## What moved

- **Admin is under Settings**, at `/settings/admin/<page>`, drawn with its
  own rail (the Admin rail, as before). Settings' rail gains an **Admin**
  row for staff only (`adminOnly`, `me.is_admin`), and the Admin rail is
  drawn only for staff: anyone else on an Admin address sees Settings' rail
  beside "This page is for Elixir's staff", signed out the sign-in wall.
  Admin is a route and lazy chunk of its own (`/settings/admin/$`), so a
  member's Settings never carries it and a server render waits for it
  rather than suspending. The server gates every Admin read, unchanged.
- **The service page** (`/data/service`, Status) is Admin's **Service**
  page. **Fleet** (the collectors list) and **Efficiency** are Admin pages
  beside it. They were readable by any signed-in account; they are now
  staff-only. That narrows who sees them and widens nothing.
- **The public half** is the site's `/data`: it already showed the
  service's state; it now also lists each collector from
  `/api/public/status` (already public): its name, who runs it, whether it
  is keeping up, and whether its release is signed. A signed-in face links
  "Run a collector" to `/settings/collectors/new`.
- **One collector's page** (`/console/status/collectors/<name>`) is
  Settings › Collectors' own record (`/settings/collectors/<name>`), where
  the operator already reads it. Admin's collector rows link there.

## Redirects (`apps/web/src/lib/moved.js`)

| Old | New |
| --- | --- |
| `/data/service`, `/console/status`, `/console/status/service`, `/console/status/collectors` | `/data` |
| `/console/status/efficiency` | `/settings/admin/efficiency` |
| `/console/status/collectors/<name>` | `/settings/collectors/<name>` |
| `/console/admin` | `/settings/admin/requests` |
| `/console/admin/<rest>` | `/settings/admin/<rest>` |
| any other `/console/...` outside Explore | `/home` |

Mail, the outbox and the jobs still write `/console/admin/...` links; they
land through these redirects. The distribution keeps routing `/console`
and `/data/service` to the app so the old addresses can redirect.

## Pinned

`apps/web/test/rail.test.jsx` (Admin offered to staff, to nobody else),
`app.test.jsx` (an Admin page to a member is staff-only, with no Admin
rail), `ssr.test.jsx` (signed out, an Admin page is the wall),
`moved.test.js` (every old Admin and status address lands), the e2e
journeys in `apps/web/e2e/console.spec.ts`.

MCP and the JSON API unchanged.
