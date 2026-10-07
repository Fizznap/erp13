'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';


/* ================================================================
   TYPES
   ================================================================ */
type Subject = { id: string; name: string; code: string; description: string; faculty_name: string; resource_count: string };
type Resource = {
  id: string; original_name: string; status: string; summary: string;
  key_topics: string[]; bullet_points: string[]; page_count: number;
  chunk_count: number; created_at: string; file_size: number;
};
type ChatMessage = { role: 'user' | 'ai'; content: string; sources?: Source[]; wasFound?: boolean; latencyMs?: number };
type Source = { resourceId: string; filename: string; chunkIndex: number; pageNumber: number; similarity: number; excerpt: string };
type Session = {
  id: string; started_at: string; ended_at: string | null; is_active: boolean;
  present_count: string; rejected_count: string; radius_meters: number;
  latitude: number; longitude: number;
  active_nonce?: string; nonce_expires?: string;
};
type AttRecord = { id: string; student_id: string; full_name: string; email: string; status: string; distance_meters: number; marked_at: string; rejection_reason: string };

/* ================================================================
   MAIN PAGE
   ================================================================ */
export default function SubjectDetailPage() {
  const params = useParams();
  const subjectId = params.id as string;
  const { user } = useAuth();
  const [subject, setSubject] = useState<Subject | null>(null);
  const [tab, setTab] = useState<'resources' | 'chat' | 'attendance'>('resources');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ subject: Subject }>(`/subjects/${subjectId}`)
      .then((d) => setSubject(d.subject))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [subjectId]);

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><div className="spinner" style={{ width: 28, height: 28 }} /></div>;
  if (!subject || !user) return <div className="card" style={{ textAlign: 'center', padding: 48 }}>Subject not found</div>;

  const tabs = [
    { key: 'coursework' as const, label: 'Course Work', icon: '📚' },
    { key: 'resources' as const, label: 'Resources', icon: '📄' },
    { key: 'chat' as const, label: 'Ask Snippet', icon: '💬' },
    { key: 'attendance' as const, label: 'Attendance', icon: '📍' },
    { key: 'assignments' as const, label: 'Assignments', icon: '📝' },
    { key: 'results' as const, label: 'Results', icon: '📊' },
    { key: 'quizzes' as const, label: 'Quizzes', icon: '❓' },
    { key: 'discussion' as const, label: 'Discussion', icon: '👥' },
  ];

  return (
    <div className="animate-fade-in relative min-h-[calc(100vh-80px)]">


      {/* Subject Header */}
      <div style={{ marginBottom: 24, padding: 24, background: 'rgba(255, 255, 255, 0.05)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: 16, border: '1px solid rgba(255, 255, 255, 0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span className="badge badge-default" style={{ fontSize: 13 }}>{subject.code}</span>
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>{subject.name}</h1>
        {subject.description && (
          <p style={{ color: 'var(--color-text-secondary)', marginTop: 4, fontSize: 14 }}>{subject.description}</p>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--color-border)', marginBottom: 24, overflowX: 'auto', whiteSpace: 'nowrap' }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as any)}
            style={{
              padding: '12px 16px',
              fontSize: 14,
              fontWeight: tab === t.key ? 600 : 400,
              color: tab === t.key ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              background: 'transparent',
              border: 'none',
              borderBottom: tab === t.key ? '2px solid var(--color-accent)' : '2px solid transparent',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'resources' && <ResourcesTab subjectId={subjectId} userRole={user.role} />}
      {tab === 'chat' && <ChatTab subjectId={subjectId} />}
      {tab === 'attendance' && <AttendanceTab subjectId={subjectId} userRole={user.role} />}
      {['coursework', 'assignments', 'results', 'quizzes', 'discussion'].includes(tab) && (
        <div className="empty-state card">
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>{tabs.find(t => t.key === tab)?.icon}</div>
          <p>{tabs.find(t => t.key === tab)?.label} module coming in Phase 2</p>
        </div>
      )}
    </div>
  );
}

/* ================================================================
   RESOURCES TAB
   ================================================================ */
function ResourcesTab({ subjectId, userRole }: { subjectId: string; userRole: string }) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchResources = useCallback(async () => {
    try {
      const data = await api<{ resources: Resource[] }>(`/resources?subjectId=${subjectId}`);
      setResources(data.resources);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [subjectId]);

  useEffect(() => { fetchResources(); }, [fetchResources]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('subjectId', subjectId);
      await api('/resources/upload', { method: 'POST', body: formData });
      fetchResources();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleProcess = async (resourceId: string) => {
    try {
      await api(`/resources/${resourceId}/process`, { method: 'POST' });
      alert('Processing started. Refresh in a moment to see status.');
      setTimeout(fetchResources, 3000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleDelete = async (resourceId: string) => {
    if (!confirm('Delete this resource and all its chunks?')) return;
    try {
      await api(`/resources/${resourceId}`, { method: 'DELETE' });
      setSelectedResource(null);
      fetchResources();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = { ready: 'badge-success', processing: 'badge-processing', queued: 'badge-warning', failed: 'badge-error' };
    return <span className={`badge ${map[status] || 'badge-default'}`}>{status}</span>;
  };

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><div className="spinner" style={{ width: 28, height: 28 }} /></div>;

  // Resource detail view
  if (selectedResource) {
    return (
      <div className="animate-fade-in">
        <button className="btn btn-ghost btn-sm" onClick={() => setSelectedResource(null)} style={{ marginBottom: 16 }}>
          ← Back to resources
        </button>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 600 }}>{selectedResource.original_name}</h3>
              <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 13, color: 'var(--color-text-muted)' }}>
                {statusBadge(selectedResource.status)}
                <span>{selectedResource.page_count || '?'} pages</span>
                <span>{selectedResource.chunk_count} chunks</span>
                <span>{(selectedResource.file_size / 1024 / 1024).toFixed(1)} MB</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button 
                className="btn btn-primary btn-sm" 
                onClick={() => {
                  const token = localStorage.getItem('token');
                  window.open(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'}/resources/${selectedResource.id}/download?token=${token}`, '_blank');
                }}
              >
                View PDF
              </button>
              {userRole === 'faculty' && (
                <button className="btn btn-danger btn-sm" onClick={() => handleDelete(selectedResource.id)}>Delete</button>
              )}
            </div>
          </div>

          {selectedResource.summary && (
            <div style={{ marginBottom: 24 }}>
              <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: 'var(--color-text-secondary)' }}>Summary</h4>
              <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--color-text-primary)' }}>{selectedResource.summary}</p>
            </div>
          )}

          {selectedResource.key_topics && selectedResource.key_topics.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: 'var(--color-text-secondary)' }}>Key Topics</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {(typeof selectedResource.key_topics === 'string'
                  ? JSON.parse(selectedResource.key_topics)
                  : selectedResource.key_topics
                ).map((topic: string, i: number) => (
                  <span key={i} className="tag">{topic}</span>
                ))}
              </div>
            </div>
          )}

          {selectedResource.bullet_points && selectedResource.bullet_points.length > 0 && (
            <div>
              <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: 'var(--color-text-secondary)' }}>Highlights</h4>
              <ul style={{ paddingLeft: 20, fontSize: 14, lineHeight: 1.8, color: 'var(--color-text-primary)' }}>
                {(typeof selectedResource.bullet_points === 'string'
                  ? JSON.parse(selectedResource.bullet_points)
                  : selectedResource.bullet_points
                ).map((point: string, i: number) => (
                  <li key={i}>{point}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Upload */}
      {userRole === 'faculty' && (
        <div style={{ marginBottom: 20 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={handleUpload}
            style={{ display: 'none' }}
          />
          <button
            className="btn btn-primary"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <><span className="spinner" /> Uploading...</> : '📄 Upload PDF'}
          </button>
        </div>
      )}

      {resources.length === 0 ? (
        <div className="empty-state card">
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>📄</div>
          <p>No resources uploaded yet</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {resources.map((r, i) => (
            <div
              key={r.id}
              className="card card-hover animate-fade-in"
              style={{ padding: 16, cursor: 'pointer', animationDelay: `${i * 30}ms` }}
              onClick={() => r.status === 'ready' ? setSelectedResource(r) : null}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 8, background: 'var(--color-bg-secondary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0,
                  }}>
                    📄
                  </div>
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{r.original_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                      {(r.file_size / 1024 / 1024).toFixed(1)} MB · {new Date(r.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {statusBadge(r.status)}
                  {r.status === 'queued' && userRole === 'faculty' && (
                    <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); handleProcess(r.id); }}>
                      Process
                    </button>
                  )}
                  {r.status === 'failed' && userRole === 'faculty' && (
                    <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); handleProcess(r.id); }}>
                      Retry
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================================================================
   CHAT TAB (RAG)
   ================================================================ */
function ChatTab({ subjectId }: { subjectId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || loading) return;

    const userMessage: ChatMessage = { role: 'user', content: query };
    setMessages((prev) => [...prev, userMessage]);
    const currentQuery = query;
    setQuery('');
    setLoading(true);

    try {
      const data = await api<{
        answer: string; wasFound: boolean; sources: Source[]; latencyMs: number;
      }>('/ask', { method: 'POST', body: { query: currentQuery, subjectId } });

      const aiMessage: ChatMessage = {
        role: 'ai',
        content: data.answer,
        sources: data.sources,
        wasFound: data.wasFound,
        latencyMs: data.latencyMs,
      };
      setMessages((prev) => [...prev, aiMessage]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'ai', content: err instanceof Error ? err.message : 'Failed to get answer', wasFound: false },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 280px)' }}>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', marginBottom: 16 }}>
        {messages.length === 0 && (
          <div className="empty-state" style={{ padding: '64px 24px' }}>
            <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>💬</div>
            <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 8 }}>Ask anything about this course</h3>
            <p style={{ fontSize: 14, maxWidth: 400, margin: '0 auto' }}>
              Questions are answered strictly from uploaded course materials. No hallucination — if the answer isn&apos;t in the resources, you&apos;ll be told.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className="animate-fade-in"
            style={{
              display: 'flex',
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              marginBottom: 16,
            }}
          >
            <div style={{
              maxWidth: '75%',
              padding: '12px 16px',
              borderRadius: 12,
              background: msg.role === 'user' ? 'var(--color-accent)' : 'var(--color-bg-primary)',
              color: msg.role === 'user' ? 'white' : 'var(--color-text-primary)',
              border: msg.role === 'ai' ? '1px solid var(--color-border)' : 'none',
              fontSize: 14,
              lineHeight: 1.7,
            }}>
              {/* AI "not found" indicator */}
              {msg.role === 'ai' && msg.wasFound === false && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  marginBottom: 8, padding: '4px 10px', borderRadius: 6,
                  background: '#fff8e1', fontSize: 12, color: '#b45309',
                }}>
                  ⚠ Not found in course materials
                </div>
              )}

              <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>

              {/* Sources */}
              {msg.sources && msg.sources.length > 0 && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Sources
                  </div>
                  {msg.sources.map((src, si) => (
                    <div key={si} style={{
                      padding: '8px 10px', borderRadius: 6,
                      background: 'var(--color-bg-secondary)', marginBottom: 4, fontSize: 12,
                    }}>
                      <div style={{ fontWeight: 500, marginBottom: 2 }}>
                        📄 {src.filename}
                        <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>
                          {' '}· Page {src.pageNumber} · {(src.similarity * 100).toFixed(0)}% match
                        </span>
                      </div>
                      <div style={{ color: 'var(--color-text-secondary)', fontSize: 11, lineHeight: 1.4 }}>
                        {src.excerpt}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Latency */}
              {msg.latencyMs && (
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8 }}>
                  ⏱ {(msg.latencyMs / 1000).toFixed(1)}s
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 16 }}>
            <div style={{
              padding: '14px 20px', borderRadius: 12,
              background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <div className="spinner" />
              <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Searching course materials...</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleAsk} style={{ display: 'flex', gap: 8 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask a question about this course..."
          disabled={loading}
          style={{ flex: 1 }}
        />
        <button type="submit" className="btn btn-primary" disabled={loading || !query.trim()}>
          Ask
        </button>
      </form>
    </div>
  );
}

/* ================================================================
   ATTENDANCE TAB
   ================================================================ */
function AttendanceTab({ subjectId, userRole }: { subjectId: string; userRole: string }) {
  if (userRole === 'faculty' || userRole === 'admin') {
    return <FacultyAttendance subjectId={subjectId} />;
  }
  return <StudentAttendance subjectId={subjectId} />;
}

function FacultyAttendance({ subjectId }: { subjectId: string }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [nonce, setNonce] = useState('');
  const [nonceExpiry, setNonceExpiry] = useState<Date | null>(null);
  const [records, setRecords] = useState<AttRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const nonceInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const data = await api<{ sessions: Session[] }>(`/attendance/sessions?subjectId=${subjectId}`);
      setSessions(data.sessions);
      const active = data.sessions.find((s: Session) => s.is_active);
      if (active) {
        setActiveSession(active);
        fetchNonce(active.id);
        fetchRecords(active.id);
      }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [subjectId]);

  useEffect(() => { fetchSessions(); return () => { if (nonceInterval.current) clearInterval(nonceInterval.current); }; }, [fetchSessions]);

  const fetchNonce = async (sessionId: string) => {
    try {
      const data = await api<{ nonce: string; expiresAt: string }>(`/attendance/${sessionId}/nonce`);
      setNonce(data.nonce);
      setNonceExpiry(new Date(data.expiresAt));
    } catch (err) { console.error(err); }
  };

  const fetchRecords = async (sessionId: string) => {
    try {
      const data = await api<{ records: AttRecord[] }>(`/attendance/${sessionId}/records`);
      setRecords(data.records);
    } catch (err) { console.error(err); }
  };

  const startSession = async () => {
    setStarting(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true });
      });

      const data = await api<{ session: Session }>('/attendance/start', {
        method: 'POST',
        body: {
          subjectId,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          radiusMeters: 50,
        },
      });

      setActiveSession(data.session);
      setNonce(data.session.active_nonce || '');
      setNonceExpiry(data.session.nonce_expires ? new Date(data.session.nonce_expires) : null);

      // Start polling for nonce rotation + records
      nonceInterval.current = setInterval(() => {
        fetchNonce(data.session.id);
        fetchRecords(data.session.id);
      }, 5000);

      fetchSessions();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to start session. Ensure GPS is enabled.');
    } finally {
      setStarting(false);
    }
  };

  const endSession = async () => {
    if (!activeSession) return;
    try {
      await api(`/attendance/${activeSession.id}/end`, { method: 'POST' });
      setActiveSession(null);
      setNonce('');
      if (nonceInterval.current) clearInterval(nonceInterval.current);
      fetchSessions();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleOverride = async (studentId: string) => {
    if (!activeSession) return;
    try {
      await api(`/attendance/${activeSession.id}/override`, {
        method: 'POST',
        body: { studentId, status: 'present', note: 'Faculty override (GPS issues)' }
      });
      fetchRecords(activeSession.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to override');
    }
  };

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><div className="spinner" style={{ width: 28, height: 28 }} /></div>;

  return (
    <div>
      {/* Active Session */}
      {activeSession ? (
        <div className="card animate-fade-in" style={{ 
          border: '1px solid rgba(255,255,255,0.2)', 
          marginBottom: 24, 
          position: 'relative', 
          overflow: 'hidden',
          background: 'rgba(255, 255, 255, 0.15)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
        }}>
          <div style={{ position: 'relative', zIndex: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 600 }}>🟢 Session Active</h3>
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  Started {new Date(activeSession.started_at).toLocaleTimeString()} · Radius: {activeSession.radius_meters}m
                </p>
              </div>
              <button className="btn btn-danger btn-sm" onClick={endSession}>End Session</button>
            </div>

            {/* Nonce Display */}
            <div style={{
              textAlign: 'center', padding: 24, background: 'rgba(0,0,0,0.2)',
              backdropFilter: 'blur(10px)',
              borderRadius: 12, marginBottom: 20,
              border: '1px solid rgba(255,255,255,0.1)'
            }}>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                Attendance Code
              </div>
              <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: 8, fontFamily: 'monospace' }}>
                {nonce}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 8 }}>
                Refreshes every 30s {nonceExpiry && `· Expires ${nonceExpiry.toLocaleTimeString()}`}
              </div>
            </div>

            {/* Live Attendance */}
            <div>
              <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
                Attendance ({records.filter(r => r.status === 'present').length} present)
              </h4>
              {records.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Waiting for students...</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {records.map((r) => (
                    <div key={r.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', fontSize: 13,
                    }}>
                      <div>
                        <span style={{ fontWeight: 500 }}>{r.full_name}</span>
                        <span style={{ color: 'var(--color-text-muted)', marginLeft: 8 }}>{r.email}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{Math.round(r.distance_meters)}m</span>
                        <span className={`badge ${r.status === 'present' ? 'badge-success' : 'badge-error'}`}>
                          {r.status}
                        </span>
                        {r.status !== 'present' && (
                          <button 
                            className="btn btn-secondary btn-sm" 
                            style={{ padding: '2px 8px', fontSize: 11 }}
                            onClick={() => handleOverride(r.student_id)}
                          >
                            Accept
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 24 }}>
          <button className="btn btn-primary" type="button" onClick={startSession} disabled={starting}>
            {starting ? <><span className="spinner" /> Getting GPS...</> : '📍 Start Attendance Session'}
          </button>
        </div>
      )}

      {/* Past Sessions */}
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Past Sessions</h3>
      {sessions.filter(s => !s.is_active).length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No past sessions</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sessions.filter(s => !s.is_active).map((s) => (
            <div key={s.id} className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{new Date(s.started_at).toLocaleDateString()} · {new Date(s.started_at).toLocaleTimeString()}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    {s.present_count} present · {s.rejected_count} rejected · {s.radius_meters}m radius
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StudentAttendance({ subjectId }: { subjectId: string }) {
  const [nonceInput, setNonceInput] = useState('');
  const [marking, setMarking] = useState(false);
  const [result, setResult] = useState<{ status: string; distance?: number; error?: string } | null>(null);
  const [myRecords, setMyRecords] = useState<AttRecord[]>([]);

  useEffect(() => {
    api<{ records: AttRecord[] }>(`/attendance/my/records?subjectId=${subjectId}`)
      .then((d) => setMyRecords(d.records))
      .catch(console.error);
  }, [subjectId]);

  const markAttendance = async (e: React.FormEvent) => {
    e.preventDefault();
    setMarking(true);
    setResult(null);

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
      });

      const data = await api<{ status: string; distance: number }>('/attendance/mark', {
        method: 'POST',
        body: {
          subjectId,
          nonce: nonceInput.toUpperCase(),
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        },
      });

      setResult({ status: data.status, distance: data.distance });
    } catch (err) {
      setResult({ status: 'error', error: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setMarking(false);
    }
  };

  return (
    <div>
      {/* Mark Attendance */}
      <div className="card" style={{ 
          marginBottom: 24, 
          position: 'relative', 
          overflow: 'hidden',
          background: 'rgba(255, 255, 255, 0.15)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.2)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
      }}>
        <div style={{ position: 'relative', zIndex: 10 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Mark Attendance</h3>
          <form onSubmit={markAttendance}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4, color: 'var(--color-text-secondary)' }}>
                Attendance Code
              </label>
              <input
                value={nonceInput}
                onChange={(e) => setNonceInput(e.target.value.toUpperCase())}
                placeholder="6-char code"
                maxLength={6}
                style={{ fontFamily: 'monospace', fontSize: 18, letterSpacing: 4, textAlign: 'center', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', color: 'inherit' }}
                required
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={marking}>
              {marking ? <><span className="spinner" /> Getting location...</> : '📍 Mark Attendance'}
            </button>
          </form>
        </div>

        {result && (
          <div className="animate-fade-in" style={{
            marginTop: 16, padding: '12px 16px', borderRadius: 8,
            background: result.status === 'present' ? '#e8f5e9' : '#ffebee',
            color: result.status === 'present' ? 'var(--color-success)' : 'var(--color-error)',
            fontSize: 14,
          }}>
            {result.status === 'present'
              ? `✓ Attendance marked! You were ${result.distance}m from the session.`
              : `✗ ${result.error || 'Attendance rejected'}`}
          </div>
        )}
      </div>

      {/* My Records */}
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>My Attendance History</h3>
      {myRecords.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No attendance records yet</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {myRecords.map((r) => (
            <div key={r.id} className="card" style={{ padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  {new Date(r.marked_at).toLocaleDateString()} · {new Date(r.marked_at).toLocaleTimeString()}
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  Distance: {Math.round(r.distance_meters)}m
                </div>
              </div>
              <span className={`badge ${r.status === 'present' ? 'badge-success' : 'badge-error'}`}>
                {r.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
