# College-domain authentication

The `snippet-api` service remains the authentication authority. Registration and
email/password login accept only normalized addresses whose complete domain is
`ustu.edu.in`. Email/password registration creates an unverified student account
and sends a one-time 24-hour confirmation link; it issues no tokens until the
email is verified. Public registration always assigns the `student` role; a
browser cannot grant faculty or admin privileges. Protected API requests reload
the active account, verified email status, and role from PostgreSQL, so old
tokens for ineligible accounts are denied.

Google sign-in posts a Google Identity Services ID token to `POST /api/auth/google`.
The API verifies it with Google's `google-auth-library` against the configured
OAuth client ID, which validates Google's signature, issuer, audience, and token
expiration. It then requires `email_verified`, an exact `ustu.edu.in` email
domain, and `hd: ustu.edu.in` for the institution's managed Google Workspace.
First-time Google users are created as verified students; an existing account
with the same college email can be verified by the matching Google identity and
keeps its role and other data.

## Existing non-college accounts

No accounts or related records are deleted, modified, or automatically
reassigned. Accounts with other email domains will be unable to log in, refresh
a token, or use protected endpoints under this policy. Existing password
accounts are also marked unverified by the additive migration and must complete
email verification (or use a matching verified Workspace Google account) before
they can sign in. An administrator should
contact each affected account holder and verify their college identity. If they
need continued access, provision access under their verified college email and
handle any record association only through an individually reviewed, approved
data migration. Do not change a role as part of that process without the usual
administrative approval.

The local and production database configurations were checked with read-only
account-count queries during implementation, but neither database was reachable
from this workspace. Run the following read-only query against the intended
database before rollout to quantify affected accounts; it returns counts by
email domain and does not change data:

```sql
SELECT split_part(lower(trim(email)), '@', 2) AS domain, count(*) AS accounts
FROM users
WHERE position('@' in email) > 0
GROUP BY 1
ORDER BY 1;
```

## OAuth and deployment configuration

1. Configure a Google OAuth 2.0 Web application client and add the deployed
   frontend origins to its authorized JavaScript origins. The Workspace must
   issue ID tokens with `hd=ustu.edu.in`.
2. Set `GOOGLE_CLIENT_ID` on the Render `snippet-api` service.
3. Set `VITE_GOOGLE_CLIENT_ID` to the same client ID in the Vercel frontend
   environment, then rebuild/redeploy the frontend so Vite embeds it.
4. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`
   on Render for password-based registration and verification resends.
5. The API runtime is pinned to Node 22 in Render, its package engine, and the
   Dockerfile to meet the current Nodemailer runtime/security requirements.
6. Deploying runs the idempotent `db:init` command, which adds verification
   columns to existing `users` tables. Existing records and roles are preserved;
   their email verification status defaults to false until they verify.

## Academic divisions and lab attendance

The additive student-profile migration creates configurable lab groups linked
to a branch, admission batch, and division. It seeds the supplied CSE 2024–28
Division B with semesters 1–8 and lab groups B1/B2. Other branch/division
combinations must be configured by an administrator in Academic Management:
create the division's semester classes, then add the lab groups (for example
A1 and A2). Registration only offers groups that match the selected branch,
batch, and division, and the API checks the same relationship before saving.

Faculty choose the attendance scope when opening a session. Lecture sessions
are for the complete academic class/division. Lab sessions require one of that
class's configured groups, and the API checks the student's stored group before
accepting attendance. Existing students are not moved or assigned a lab group
by the migration. An administrator must review each student's records and use
the class assignment controls to assign the right class and group; students
without a lab group can still use their existing account and class-scoped
lecture features, but cannot mark attendance for a lab group.

The backend deployment runs `db:init`, which applies these idempotent schema and
academic-configuration additions. No existing user, attendance, class, profile,
or role records are deleted or reassigned by the migration.

Google sign-in does not use a client secret: the browser obtains an ID token,
and the API verifies it against Google's public signing keys. Keep `JWT_SECRET`
generated and private in Render. Auth endpoints retain the existing 20-attempt
per-15-minute limiter. Snippet currently stores JWTs in browser localStorage;
this implementation preserves that existing session format, so XSS protection
remains important and a later HttpOnly-cookie migration should be evaluated
separately.
