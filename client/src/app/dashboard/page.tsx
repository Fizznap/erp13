'use client';

import { useAuth } from '@/lib/auth';

export default function FeedPage() {
  const { user } = useAuth();
  
  if (!user) return null;

  return (
    <div className="animate-fade-in">
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>Feed</h1>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Mock Announcement Card */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>University Admin</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>2h ago</div>
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 16 }}>
            Welcome to the new academic year. Please find the updated syllabus and guidelines attached below.
          </p>
          
          <div style={{ 
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: 12, border: '1px solid var(--color-border)', borderRadius: 8, background: 'var(--color-bg-secondary)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>📄</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Fall_2026_Guidelines.pdf</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>2.4 MB</div>
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" title="Download">↓</button>
          </div>
        </div>

        {/* Mock Announcement Card 2 */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Prof. Smith (CS101)</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>1d ago</div>
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.5 }}>
            Reminder: Assignment 1 is due this Friday. Please submit via the Classroom tab.
          </p>
        </div>
      </div>
    </div>
  );
}
