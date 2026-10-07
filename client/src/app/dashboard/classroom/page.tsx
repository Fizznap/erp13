'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { LiquidMetal, LiquidMetalButton } from '@/components/ui/liquid-metal';

type Subject = {
  id: string;
  name: string;
  code: string;
  description: string;
  faculty_name: string;
  resource_count: string;
  student_count?: string;
  is_enrolled?: boolean;
};

export default function SubjectsPage() {
  const { user } = useAuth();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newSubject, setNewSubject] = useState({ name: '', code: '', description: '' });
  const [creating, setCreating] = useState(false);
  const [enrolling, setEnrolling] = useState<string | null>(null);

  const fetchSubjects = async () => {
    try {
      if (user?.role === 'student') {
        const data = await api<{ subjects: Subject[] }>('/subjects/available/all');
        setSubjects(data.subjects);
      } else {
        const data = await api<{ subjects: Subject[] }>('/subjects');
        setSubjects(data.subjects);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSubjects(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await api('/subjects', { method: 'POST', body: newSubject });
      setShowCreate(false);
      setNewSubject({ name: '', code: '', description: '' });
      fetchSubjects();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setCreating(false);
    }
  };

  const handleEnroll = async (subjectId: string) => {
    setEnrolling(subjectId);
    try {
      await api(`/subjects/${subjectId}/enroll`, { method: 'POST' });
      fetchSubjects();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to enroll');
    } finally {
      setEnrolling(null);
    }
  };

  if (!user) return null;

  return (
    <div className="animate-fade-in relative min-h-[calc(100vh-80px)]">
      {/* Full page liquid background */}
      <div className="fixed inset-0 z-[-1] pointer-events-none overflow-hidden" style={{ top: 0, left: 0, right: 0, bottom: 0 }}>
        <LiquidMetal
          colorBack="#0ea5e9"
          colorTint="#a855f7"
          speed={0.2}
          repetition={2}
          distortion={0.3}
          scale={2}
          style={{ opacity: 0.6, width: '100vw', height: '100vh' }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, padding: 24, background: 'rgba(255, 255, 255, 0.05)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: 16, border: '1px solid rgba(255, 255, 255, 0.1)' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>
            {user.role === 'student' ? 'All Subjects' : 'Your Subjects'}
          </h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14, marginTop: 4 }}>
            {user.role === 'student' ? 'Browse and enroll in available subjects' : 'Manage your course subjects'}
          </p>
        </div>
        {(user.role === 'faculty' || user.role === 'admin') && (
          <LiquidMetalButton size="sm" onClick={() => setShowCreate(true)}>
            + New Subject
          </LiquidMetalButton>
        )}
      </div>

      {/* Create Subject Modal */}
      {showCreate && (
        <div className="card animate-fade-in" style={{ 
          marginBottom: 24, 
          border: '1px solid rgba(255,255,255,0.3)',
          background: 'rgba(255, 255, 255, 0.15)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
        }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Create Subject</h3>
          <form onSubmit={handleCreate}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4, color: 'var(--color-text-secondary)' }}>
                  Subject Name
                </label>
                <input
                  value={newSubject.name}
                  onChange={(e) => setNewSubject({ ...newSubject, name: e.target.value })}
                  placeholder="Introduction to CS"
                  style={{ background: 'rgba(0,0,0,0.1)', border: '1px solid rgba(255,255,255,0.1)', color: 'inherit' }}
                  required
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4, color: 'var(--color-text-secondary)' }}>
                  Subject Code
                </label>
                <input
                  value={newSubject.code}
                  onChange={(e) => setNewSubject({ ...newSubject, code: e.target.value.toUpperCase() })}
                  placeholder="CS101"
                  style={{ background: 'rgba(0,0,0,0.1)', border: '1px solid rgba(255,255,255,0.1)', color: 'inherit' }}
                  required
                />
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4, color: 'var(--color-text-secondary)' }}>
                Description
              </label>
              <textarea
                value={newSubject.description}
                onChange={(e) => setNewSubject({ ...newSubject, description: e.target.value })}
                placeholder="Brief description..."
                style={{ background: 'rgba(0,0,0,0.1)', border: '1px solid rgba(255,255,255,0.1)', color: 'inherit' }}
                rows={2}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowCreate(false)}>Cancel</button>
              <LiquidMetalButton size="sm" type="submit" disabled={creating}>
                {creating ? <span className="spinner" /> : 'Create'}
              </LiquidMetalButton>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <div className="spinner" style={{ width: 28, height: 28 }} />
        </div>
      ) : subjects.length === 0 ? (
        <div className="empty-state card" style={{
          background: 'rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.1)',
        }}>
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>◈</div>
          <p>No subjects available</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {subjects.map((subject, i) => (
            <div
              key={subject.id}
              className="card card-hover animate-fade-in"
              style={{ 
                animationDelay: `${i * 40}ms`,
                background: 'rgba(255, 255, 255, 0.15)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                border: '1px solid rgba(255,255,255,0.2)',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                <span className="badge badge-default" style={{ background: 'rgba(255,255,255,0.2)', color: 'inherit' }}>{subject.code}</span>
                {user.role === 'student' && subject.is_enrolled && (
                  <span className="badge badge-success" style={{ background: 'rgba(34, 197, 94, 0.2)', color: '#22c55e' }}>Enrolled</span>
                )}
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{subject.name}</h3>
              {subject.description && (
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: 12 }}>
                  {subject.description}
                </p>
              )}
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 16 }}>
                By {subject.faculty_name} · {subject.resource_count} resources
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {user.role === 'student' && !subject.is_enrolled ? (
                  <div style={{ flex: 1, display: 'flex' }}>
                    <LiquidMetalButton
                      size="sm"
                      className="w-full justify-center"
                      onClick={() => handleEnroll(subject.id)}
                      disabled={enrolling === subject.id}
                    >
                      {enrolling === subject.id ? <span className="spinner" /> : 'Enroll'}
                    </LiquidMetalButton>
                  </div>
                ) : (
                  <Link
                    href={`/dashboard/classroom/${subject.id}`}
                    style={{ flex: 1, textDecoration: 'none', display: 'flex' }}
                  >
                    <LiquidMetalButton size="sm" className="w-full justify-center">
                      Open
                    </LiquidMetalButton>
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
