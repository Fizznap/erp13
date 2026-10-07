# Snippet Frontend Component Map

\`\`\`
src/
├── app/
│   ├── globals.css                # Global styles, B&W tokens
│   ├── layout.tsx                 # Root layout, fonts, AuthProvider
│   ├── page.tsx                   # Redirects to /dashboard or /login
│   ├── login/
│   │   └── page.tsx               # Login screen (Auth form)
│   ├── register/
│   │   └── page.tsx               # Registration screen
│   └── dashboard/
│       ├── layout.tsx             # Mobile-first Bottom Nav (Feed, Classroom, Help, Reminders)
│       ├── page.tsx               # FeedPage (Announcements, attachments)
│       ├── classroom/
│       │   ├── page.tsx           # Enrolled subjects list
│       │   └── [id]/
│       │       └── page.tsx       # Subject Detail (Tabs: Course Work, Resources, Chat, Attendance, etc.)
│       ├── help/
│       │   └── page.tsx           # Help / Support placeholder
│       └── reminders/
│           └── page.tsx           # Reminders placeholder
├── components/
│   ├── ui/
│   │   ├── Card.tsx               # Base card component (props: children, className, onClick)
│   │   ├── Badge.tsx              # Status badge (props: label, variant: 'default'|'success'|'error')
│   │   ├── Button.tsx             # Primary/Secondary buttons (props: variant, isLoading, onClick)
│   │   └── Spinner.tsx            # Loading indicator
│   ├── features/
│   │   ├── ChatInterface.tsx      # RAG Chat (props: subjectId)
│   │   ├── ResourceList.tsx       # PDF list & upload (props: subjectId, userRole)
│   │   └── AttendanceTracker.tsx  # GPS Attendance logic (props: subjectId, userRole)
├── lib/
│   ├── api.ts                     # Fetch wrapper with JWT handling
│   └── auth.tsx                   # AuthContext (user, login, logout, loading)
\`\`\`

## Key State Interfaces

- **AuthContext**: `{ user: User | null; loading: boolean; login: () => void; logout: () => void; }`
- **Chat State**: `Array<{ role: 'user'|'ai', content: string, sources?: Source[], wasFound?: boolean }>`
- **Attendance State**: `{ activeSession: Session | null, nonce: string, records: Record[] }`
