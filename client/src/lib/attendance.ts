export type AttendanceHistoryRecord = {
  id?: string | number | null;
  session_id?: string | number | null;
  subject_id?: string | number | null;
  subject_name?: string | null;
  status?: string | null;
};

export type AttendanceSubjectSummary = {
  id: string;
  name: string;
  attended: number;
  total: number;
  percentage: number;
};

export function parseAttendanceHistoryResponse(payload: unknown): AttendanceHistoryRecord[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Attendance history response is invalid");
  }

  const records = (payload as { records?: unknown }).records;
  if (!Array.isArray(records)) {
    throw new Error("Attendance history response is invalid");
  }

  return records.filter(
    (record): record is AttendanceHistoryRecord => record !== null && typeof record === "object",
  );
}

export function uniqueAttendanceHistory<T extends AttendanceHistoryRecord = AttendanceHistoryRecord>(
  records: unknown,
): T[] {
  if (!Array.isArray(records)) return [];

  const seenSessions = new Set<string>();
  return records.filter((record) => {
    if (!record || typeof record !== "object") return false;
    const sessionKey = record.session_id ?? record.id;
    if (sessionKey == null) return true;

    const key = String(sessionKey);
    if (seenSessions.has(key)) return false;
    seenSessions.add(key);
    return true;
  }) as T[];
}

export function summarizeAttendanceHistory(records: AttendanceHistoryRecord[]) {
  const subjects = new Map<string, AttendanceSubjectSummary>();
  for (const record of uniqueAttendanceHistory(records)) {
    const name = record.subject_name || "Unknown subject";
    const id = String(record.subject_id ?? name);
    const summary = subjects.get(id) ?? { id, name, attended: 0, total: 0, percentage: 0 };
    summary.total += 1;
    if (record.status === "present") summary.attended += 1;
    summary.percentage = summary.total ? (summary.attended / summary.total) * 100 : 0;
    subjects.set(id, summary);
  }

  const list = [...subjects.values()];
  const attended = list.reduce((total, subject) => total + subject.attended, 0);
  const total = list.reduce((count, subject) => count + subject.total, 0);
  return { list, attended, total, percentage: total ? (attended / total) * 100 : 0 };
}
