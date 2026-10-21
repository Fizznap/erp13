# Student profile onboarding and Google sign-in

## Current behavior

- Google ID tokens are verified by `snippet-api` with `GOOGLE_CLIENT_ID`; the server checks the signature, issuer, audience, expiration, verified email, exact `ustu.edu.in` email domain, and the managed Workspace `hd` claim.
- Google sign-in links identities to users by the verified college email. Existing user records and roles are kept. New Google accounts get a student role and a short-lived onboarding-only token until the required profile is complete.
- Student profile completion is required before normal API routes issue or accept sessions. The restricted token cannot refresh or access normal routes. Class choices are loaded from the existing admin-configured academic hierarchy, and a student's class assignment cannot be changed through profile editing.
- Registration accepts UST roll numbers in the `USTYYR01XXNNN` format. The roll number is also stored as the PRN, and the backend derives the admission batch from `YY` and the branch from the `R0101` / `R0102` prefix. `R0101` maps to B.Tech AIML, `R0102` maps to B.Tech CSE, and other valid `R01XX` prefixes map to B.Tech Cyber Security. The server validates that the selected configured class belongs to that branch and admission batch. It does not trust browser-supplied program, PRN, or admission-year values.
- Registration asks students for current year of study, expected graduation year, and one configured class/section choice (needed by the existing attendance and class-access model). Administrators must configure academic classes for each canonical branch and batch before those classes can be selected. Existing profile identifiers are read-only to students and can be corrected by an administrator. Google profile photos are shown from Google's HTTPS `googleusercontent.com` URLs; uploads are not enabled because this project has no persistent profile-image storage.
- Optional profile visibility controls are not added. The current profile feature has no directory/visibility authorization model to enforce them safely.

## Existing accounts with other email domains

This change does not delete users or modify their stored data or roles. A non-`@ustu.edu.in` account is denied at login, refresh, Google sign-in, and protected API authentication. It will remain stored, inaccessible under this policy, until an administrator decides how to handle it. Do not automatically change its email or role.

Before rollout, an administrator with read-only access can inspect affected account IDs and roles with:

```sql
SELECT id, email, role, is_active, email_verified, created_at
FROM users
WHERE right(lower(trim(email)), length('@ustu.edu.in')) <> '@ustu.edu.in'
ORDER BY created_at;
```

The query is for review only. Decide account-by-account whether the user should obtain a college account or whether an administrator should deactivate the record under the institution's existing process. Preserve attendance, classes, profiles, and other related records.

## Configuration and rollout

1. In Google Cloud Console, configure an OAuth 2.0 **Web application** client. Add each Snippet frontend origin under **Authorized JavaScript origins** (for example the production Vercel origin and any explicitly used preview/local origins). This Google Identity Services flow returns a credential to the browser; it does not use an OAuth redirect URI.
2. Set the same client ID in the API as `GOOGLE_CLIENT_ID` and in the Vercel client build as `VITE_GOOGLE_CLIENT_ID`. Redeploy the frontend after changing its build-time variable. The client ID is public; never put a client secret in frontend variables.
3. Ensure API CORS allows the deployed frontend origin and that the OAuth client is configured for the college's managed `ustu.edu.in` Workspace domain. The backend currently requires Google's `hd` claim to match `ustu.edu.in`.
4. Deploy the API through its normal startup (`npm run db:init && node src/index.js` in Render). `db:init` applies the additive `migration_02_student_profiles.sql`; it creates profile and Google identity tables, a unique college ID index, and inserts canonical B.Tech branch rows when absent. It does not rewrite existing account data or create academic classes. Back up the database and inspect the existing-account query before rollout; configure branch/batch/division/semester classes in the admin hierarchy.
5. Deploy the Vercel frontend after the API is live. Test with a managed college Google account and an existing password account. A personal Gmail account is intentionally rejected even if it belongs to the same person.

No Firebase Authentication, Lovable-managed Supabase Auth, production data edits, or production deployment are part of this change.
