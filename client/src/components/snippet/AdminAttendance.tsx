import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Clock, RefreshCw, Square, MapPin, Users, Check, X, AlertCircle } from "lucide-react";
import { SectionTitle } from "./AppShell";
import { api, fetchSubjects, SUBJECTS_QUERY_KEY, Subject } from "@/lib/api";

type AcademicClass = {
  id: string;
  branch_id: string;
  batch_id: string;
  division_id: string;
  semester_id: string;
  branch_name: string;
  branch_code: string;
  start_year: number;
  end_year: number;
  division_name: string;
  semester_number: number;
};

type LabGroup = {
  id: string;
  branch_id: string;
  batch_id: string;
  division_id: string;
  name: string;
};

type AcademicHierarchy = {
  classes: AcademicClass[];
  labGroups: LabGroup[];
};

type RosterStudent = {
  student_id: string;
  full_name: string;
  roll_number: string | null;
  status: "present" | "absent" | "needs_review";
  marked_at: string | null;
  record_id?: string;
  corrected_at?: string | null;
  correction_reason?: string | null;
  original_status?: string | null;
};

export function AdminAttendance() {
  const qc = useQueryClient();
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedOfferingId, setSelectedOfferingId] = useState("");
  const [sessionType, setSessionType] = useState<"lecture" | "lab">("lecture");
  const [labGroupId, setLabGroupId] = useState("");
  const [latitude, setLatitude] = useState<string>("19.0760");
  const [longitude, setLongitude] = useState<string>("72.8777");
  const [radiusMeters, setRadiusMeters] = useState<number>(50);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [activeSession, setActiveSession] = useState<any>(null);
  const [activeNonce, setActiveNonce] = useState<string>("");
  const [nonceExpires, setNonceExpires] = useState<string>("");
  const [now, setNow] = useState(Date.now());
  const [savingStudentId, setSavingStudentId] = useState("");

  // Clock for countdown timer
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch academic hierarchy
  const hierarchy = useQuery({
    queryKey: ["academic-hierarchy"],
    queryFn: () => api<AcademicHierarchy>("/academic/hierarchy"),
  });

  // Fetch all subjects/offerings
  const subjectsQuery = useQuery({
    queryKey: SUBJECTS_QUERY_KEY,
    queryFn: fetchSubjects,
  });

  // Automatically attempt to read current GPS coordinates
  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLatitude(pos.coords.latitude.toFixed(6));
          setLongitude(pos.coords.longitude.toFixed(6));
        },
        () => {
          // Keep defaults if location permission denied
        },
        { enableHighAccuracy: true, timeout: 5000 },
      );
    }
  }, []);

  const refreshLocation = () => {
    if (!("geolocation" in navigator)) {
      setErr("Geolocation is not supported by your browser");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude.toFixed(6));
        setLongitude(pos.coords.longitude.toFixed(6));
        setErr("");
      },
      (error) => {
        setErr(`Location error: ${error.message}`);
      },
      { enableHighAccuracy: true },
    );
  };

  // Filter available offerings for the selected academic class
  const availableOfferings = (subjectsQuery.data ?? []).filter((s: Subject) => {
    if (!s.offering_id) return false;
    if (!selectedClassId) return true;
    return s.academic_class_id === selectedClassId;
  });

  // Selected offering details
  const selectedOffering = (subjectsQuery.data ?? []).find(
    (s: Subject) => s.offering_id === selectedOfferingId,
  );

  // Filter lab groups matching the selected class
  const selectedClass = hierarchy.data?.classes.find((c) => c.id === selectedClassId);
  const availableLabGroups = (hierarchy.data?.labGroups ?? []).filter((g) => {
    if (!selectedClass) return false;
    return (
      g.branch_id === selectedClass.branch_id &&
      g.batch_id === selectedClass.batch_id &&
      g.division_id === selectedClass.division_id
    );
  });

  // Poll nonce while session is active
  useEffect(() => {
    if (!activeSession?.is_active) return;
    const interval = setInterval(async () => {
      try {
        const { nonce, expiresAt } = await api<{ nonce: string; expiresAt: string }>(
          `/attendance/${activeSession.id}/nonce`,
        );
        setActiveNonce(nonce);
        setNonceExpires(expiresAt);
      } catch {
        // Silently continue during polling
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [activeSession?.id, activeSession?.is_active]);

  // Live roster for the active session
  const attendees = useQuery({
    queryKey: ["attendance-roster", activeSession?.id],
    enabled: Boolean(activeSession?.id),
    queryFn: async () => {
      const { students } = await api<{ students: RosterStudent[] }>(
        `/attendance/${activeSession.id}/roster`,
      );
      return students;
    },
    refetchInterval: activeSession?.is_active ? 5000 : false,
  });

  // Session history for selected offering
  const sessionHistory = useQuery({
    queryKey: ["attendance-sessions", selectedOfferingId],
    enabled: Boolean(selectedOfferingId) && !activeSession,
    queryFn: async () => {
      const { sessions } = await api<{ sessions: any[] }>(
        `/attendance/sessions?subjectOfferingId=${encodeURIComponent(selectedOfferingId)}`,
      );
      return sessions;
    },
  });

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setSuccessMsg("");

    if (!selectedOfferingId) {
      setErr("Please select a subject offering.");
      return;
    }
    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lon)) {
      setErr("Please provide valid latitude and longitude coordinates.");
      return;
    }
    if (sessionType === "lab" && !labGroupId) {
      setErr("Please select a lab group for lab attendance.");
      return;
    }

    setLoading(true);
    try {
      const { session } = await api<{ session: any }>("/attendance/start", {
        method: "POST",
        body: {
          subjectOfferingId: selectedOfferingId,
          sessionType,
          ...(sessionType === "lab" ? { academicLabGroupId: labGroupId } : {}),
          latitude: lat,
          longitude: lon,
          radiusMeters: Number(radiusMeters) || 50,
        },
      });

      setActiveSession(session);
      setActiveNonce(session.active_nonce);
      setNonceExpires(session.nonce_expires);
      setSuccessMsg("Attendance session started successfully!");
      void qc.invalidateQueries({ queryKey: ["attendance-sessions", selectedOfferingId] });
    } catch (e: any) {
      setErr(e.message || "Failed to start attendance session");
    } finally {
      setLoading(false);
    }
  };

  const handleEnd = async () => {
    if (!activeSession?.id) return;
    setLoading(true);
    setErr("");
    try {
      await api(`/attendance/${activeSession.id}/end`, { method: "POST" });
      setActiveSession({ ...activeSession, is_active: false });
      setSuccessMsg("Attendance session ended.");
      void qc.invalidateQueries({ queryKey: ["attendance-sessions", selectedOfferingId] });
    } catch (e: any) {
      setErr(e.message || "Failed to end session");
    } finally {
      setLoading(false);
    }
  };

  const handleRotateNonce = async () => {
    if (!activeSession?.id) return;
    try {
      const { nonce, expiresAt } = await api<{ nonce: string; expiresAt: string }>(
        `/attendance/${activeSession.id}/nonce`,
      );
      setActiveNonce(nonce);
      setNonceExpires(expiresAt);
    } catch (e: any) {
      setErr(e.message || "Failed to rotate code");
    }
  };

  const updateStudentStatus = async (studentId: string, currentStatus: string) => {
    if (!activeSession?.id) return;
    const nextStatus = currentStatus === "present" ? "absent" : "present";
    setSavingStudentId(studentId);
    setErr("");
    try {
      await api(`/attendance/${activeSession.id}/roster/${studentId}`, {
        method: "PUT",
        body: { status: nextStatus, note: "Admin manual update" },
      });
      await qc.invalidateQueries({ queryKey: ["attendance-roster", activeSession.id] });
    } catch (e: any) {
      setErr(e.message || "Could not update attendance");
    } finally {
      setSavingStudentId("");
    }
  };

  const secondsLeft = nonceExpires
    ? Math.max(0, Math.floor((new Date(nonceExpires).getTime() - now) / 1000))
    : 0;

  const presentCount = attendees.data?.filter((s) => s.status === "present").length ?? 0;
  const totalCount = attendees.data?.length ?? 0;

  return (
    <section className="mt-8 space-y-4">
      <SectionTitle>Attendance Management</SectionTitle>

      {err && (
        <div className="flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-xs font-medium text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{err}</span>
        </div>
      )}

      {successMsg && (
        <div className="flex items-center gap-2 rounded-2xl border border-primary/30 bg-primary/10 p-4 text-xs font-medium text-primary-deep">
          <Check className="h-4 w-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Active Session Display */}
      {activeSession?.is_active ? (
        <div className="overflow-hidden rounded-[26px] bg-id p-6 text-center text-id-foreground shadow-float">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> Live Session Active
            </span>
            <span className="text-xs uppercase tracking-wider opacity-75">
              {sessionType === "lab" ? "Lab Group" : "Division Lecture"}
            </span>
          </div>

          <div className="mt-6">
            <p className="text-xs font-medium uppercase tracking-widest opacity-70">Passcode for Students</p>
            <p className="mt-2 font-mono text-5xl font-bold tracking-[0.25em] text-white">
              {activeNonce || "------"}
            </p>
          </div>

          <div className="mt-4 flex items-center justify-center gap-2 text-xs opacity-90">
            <Clock className="h-4 w-4" />
            <span>Code rotates in {secondsLeft}s</span>
            <button
              onClick={handleRotateNonce}
              title="Rotate code now"
              className="press ml-2 inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium hover:bg-white/20"
            >
              <RefreshCw className="h-3 w-3" /> Refresh Code
            </button>
          </div>

          <div className="mx-auto mt-3 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full rounded-full bg-primary transition-all duration-1000"
              style={{ width: `${Math.min(100, (secondsLeft / 30) * 100)}%` }}
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={handleEnd}
              disabled={loading}
              className="press flex items-center justify-center gap-2 rounded-2xl bg-destructive px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Square className="h-4 w-4" /> End Attendance Session
            </button>
          </div>

          {/* Live Roster Card */}
          <div className="mt-6 rounded-2xl bg-black/25 p-4 text-left">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Users className="h-4 w-4" /> Live Roster
              </p>
              <span className="text-xs font-medium opacity-80">
                {presentCount} of {totalCount} Present
              </span>
            </div>

            <div className="mt-3 max-h-56 divide-y divide-white/10 overflow-y-auto">
              {attendees.isLoading && (
                <p className="py-2 text-center text-xs opacity-70">Loading roster…</p>
              )}
              {attendees.data?.length === 0 && (
                <p className="py-2 text-center text-xs opacity-70">No students enrolled in this section.</p>
              )}
              {attendees.data?.map((s) => (
                <div key={s.student_id} className="flex items-center justify-between py-2 text-xs">
                  <div className="min-w-0 pr-2">
                    <p className="truncate font-medium">
                      {s.full_name}
                      {s.corrected_at && (
                        <span className="ml-1.5 rounded-sm bg-amber-500/20 px-1 py-0.5 text-[10px] text-amber-300 font-normal">
                          Corrected ({s.original_status} → {s.status})
                        </span>
                      )}
                    </p>
                    <p className="truncate text-[11px] opacity-60">
                      {s.roll_number || "No PRN"}
                      {s.marked_at ? ` · ${new Date(s.marked_at).toLocaleTimeString()}` : ""}
                      {s.correction_reason ? ` · Reason: ${s.correction_reason}` : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => updateStudentStatus(s.student_id, s.status)}
                    disabled={savingStudentId === s.student_id}
                    className={`press shrink-0 rounded-full px-3 py-1 font-semibold transition-colors ${
                      s.status === "present"
                        ? "bg-emerald-500/30 text-emerald-200"
                        : "bg-white/10 text-white/70"
                    }`}
                  >
                    {savingStudentId === s.student_id
                      ? "Saving…"
                      : s.status === "present"
                      ? "Present"
                      : "Absent"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : activeSession ? (
        <div className="surface rise rounded-[26px] p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Session Ended</p>
              <p className="text-xs text-muted-foreground">
                Started {new Date(activeSession.started_at).toLocaleTimeString()}
              </p>
            </div>
            <button
              onClick={() => {
                setActiveSession(null);
                setSuccessMsg("");
              }}
              className="press rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground"
            >
              Start New Session
            </button>
          </div>
        </div>
      ) : (
        /* Session Starter Form */
        <form onSubmit={handleStart} className="surface rise rounded-[26px] p-5 space-y-4">
          <div>
            <h3 className="text-base font-semibold">Start Attendance Session</h3>
            <p className="text-xs text-muted-foreground">
              Select an academic class and subject offering to generate a time-limited code for students.
            </p>
          </div>

          {/* Academic Class Selector */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground">
              Academic Class
            </label>
            <select
              value={selectedClassId}
              onChange={(e) => {
                setSelectedClassId(e.target.value);
                setSelectedOfferingId("");
                setLabGroupId("");
              }}
              className="mt-1.5 w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-hidden focus:border-primary"
            >
              <option value="">Choose an Academic Class</option>
              {hierarchy.data?.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.branch_code} · Batch {c.start_year} · Div {c.division_name} · Sem {c.semester_number}
                </option>
              ))}
            </select>
          </div>

          {/* Subject Offering Selector */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground">
              Subject Offering
            </label>
            <select
              value={selectedOfferingId}
              onChange={(e) => {
                setSelectedOfferingId(e.target.value);
                const offering = availableOfferings.find((o) => o.offering_id === e.target.value);
                if (offering?.academic_class_id && !selectedClassId) {
                  setSelectedClassId(offering.academic_class_id);
                }
              }}
              className="mt-1.5 w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-hidden focus:border-primary"
            >
              <option value="">
                {availableOfferings.length ? "Choose a Subject Offering" : "No Offerings Available"}
              </option>
              {availableOfferings.map((s) => (
                <option key={s.offering_id} value={s.offering_id ?? ""}>
                  {s.name} ({s.code}) · {s.faculty_name ? `Faculty: ${s.faculty_name}` : "No Faculty"}
                </option>
              ))}
            </select>
          </div>

          {/* Session Type */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground">
              Session Type
            </label>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setSessionType("lecture");
                  setLabGroupId("");
                }}
                className={`press flex items-center justify-center gap-1.5 rounded-2xl py-2.5 text-xs font-semibold border ${
                  sessionType === "lecture"
                    ? "bg-foreground text-background border-foreground"
                    : "bg-card text-foreground border-border"
                }`}
              >
                Division Lecture
              </button>
              <button
                type="button"
                onClick={() => setSessionType("lab")}
                className={`press flex items-center justify-center gap-1.5 rounded-2xl py-2.5 text-xs font-semibold border ${
                  sessionType === "lab"
                    ? "bg-foreground text-background border-foreground"
                    : "bg-card text-foreground border-border"
                }`}
              >
                Lab Group
              </button>
            </div>
          </div>

          {/* Lab Group Selector if Lab */}
          {sessionType === "lab" && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground">
                Lab Group
              </label>
              <select
                value={labGroupId}
                onChange={(e) => setLabGroupId(e.target.value)}
                className="mt-1.5 w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-hidden focus:border-primary"
              >
                <option value="">
                  {availableLabGroups.length ? "Choose Lab Group" : "No Lab Groups for this Division"}
                </option>
                {availableLabGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Location & Radius Settings */}
          <div className="rounded-2xl border border-border bg-card/50 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold">
                <MapPin className="h-3.5 w-3.5 text-primary-deep" /> GPS Coordinates & Radius
              </span>
              <button
                type="button"
                onClick={refreshLocation}
                className="press inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
              >
                <RefreshCw className="h-3 w-3" /> Get Current Location
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] uppercase text-muted-foreground">Latitude</label>
                <input
                  type="number"
                  step="any"
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border bg-card px-2.5 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase text-muted-foreground">Longitude</label>
                <input
                  type="number"
                  step="any"
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border bg-card px-2.5 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase text-muted-foreground">Radius (m)</label>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={radiusMeters}
                  onChange={(e) => setRadiusMeters(parseInt(e.target.value, 10) || 50)}
                  className="mt-1 w-full rounded-xl border border-border bg-card px-2.5 py-1.5 text-xs"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !selectedOfferingId}
            className="press w-full rounded-2xl bg-foreground py-3 text-sm font-semibold text-background disabled:opacity-50"
          >
            {loading ? "Starting Session…" : "Start Attendance Session"}
          </button>
        </form>
      )}

      {/* Recent Sessions for selected offering */}
      {selectedOfferingId && !activeSession && (
        <div className="surface rounded-[26px] p-5">
          <p className="text-sm font-semibold">Recent Sessions</p>
          <div className="mt-3 space-y-2">
            {sessionHistory.isLoading && <p className="text-xs text-muted-foreground">Loading sessions…</p>}
            {sessionHistory.data?.length === 0 && (
              <p className="text-xs text-muted-foreground">No previous attendance sessions for this offering.</p>
            )}
            {sessionHistory.data?.slice(0, 5).map((sess) => (
              <div
                key={sess.id}
                className="flex items-center justify-between rounded-xl bg-card px-3 py-2 text-xs"
              >
                <div>
                  <p className="font-medium">
                    {new Date(sess.started_at).toLocaleDateString()} at{" "}
                    {new Date(sess.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Code: {sess.active_nonce} · {sess.present_count ?? 0} present
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    sess.is_active ? "bg-emerald-500/20 text-emerald-400" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {sess.is_active ? "Active" : "Closed"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
