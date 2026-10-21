# Student profile onboarding and Google sign-in

## Current behavior

- Google ID tokens are verified by `snippet-api` with `GOOGLE_CLIENT_ID`; the server checks the signature, issuer, audience, expiration, verified email, exact `ustu.edu.in` email domain, and the managed Workspace `hd` claim.
- Google sign-in links identities to users by the verified college email. Existing user records and roles are kept. New Google accounts get a student role and a short-lived onboarding-only token until the required profile is complete.
- Student profile completion is required before normal API routes issue or accept sessions. The restricted token cannot refresh or access normal routes. Class choices are loaded from the existing admin-configured academic hierarchy, and a student's class assignment cannot be changed through profile editing.
- The college ID/PRN is user-reported and unique in the app; it is not independently verified by the university. Program remains free text because the existing backend has no authoritative program catalog. Google profile photos are shown from Google's HTTPS `googleusercontent.com` URLs; upload is not enabled because this project has no persistent profile-image storage.
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
4. Deploy the API through its normal startup (`npm run db:init && node src/index.js` in Render). `db:init` applies the additive `migration_02_student_profiles.sql`; it creates profile and Google identity tables and a unique college ID index without rewriting existing account data. Back up the database and inspect the existing-account query before rollout.
5. Deploy the Vercel frontend after the API is live. Test with a managed college Google account and an existing password account. A personal Gmail account is intentionally rejected even if it belongs to the same person.

No Firebase Authentication, Lovable-managed Supabase Auth, production data edits, or production deployment are part of this change.
