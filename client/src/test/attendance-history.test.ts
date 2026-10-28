import { describe, expect, it } from "vitest";
import {
  parseAttendanceHistoryResponse,
  summarizeAttendanceHistory,
  uniqueAttendanceHistory,
} from "@/lib/attendance";

describe("attendance history summaries", () => {
  it("reports 100 percent when all completed sessions were present", () => {
    const summary = summarizeAttendanceHistory([
      { session_id: "s1", subject_id: "sub1", subject_name: "Networks", status: "present" },
      { session_id: "s2", subject_id: "sub1", subject_name: "Networks", status: "present" },
    ]);

    expect(summary).toMatchObject({ attended: 2, total: 2, percentage: 100 });
    expect(summary.list[0]).toMatchObject({ attended: 2, total: 2, percentage: 100 });
  });

  it("counts explicit absences and sessions without a record in the denominator", () => {
    const summary = summarizeAttendanceHistory([
      { session_id: "present", subject_id: "sub1", subject_name: "Networks", status: "present" },
      {
        session_id: "missing-record",
        subject_id: "sub1",
        subject_name: "Networks",
        status: "absent",
      },
      {
        session_id: "explicit-absence",
        subject_id: "sub1",
        subject_name: "Networks",
        status: "absent",
      },
    ]);

    expect(summary.attended).toBe(1);
    expect(summary.total).toBe(3);
    expect(summary.percentage).toBeCloseTo(100 / 3);
  });

  it("does not count duplicate rows for a session twice", () => {
    const records = [
      { session_id: "s1", subject_id: "sub1", subject_name: "Networks", status: "present" },
      { session_id: "s1", subject_id: "sub1", subject_name: "Networks", status: "absent" },
    ];

    expect(uniqueAttendanceHistory(records)).toHaveLength(1);
    expect(summarizeAttendanceHistory(records)).toMatchObject({
      attended: 1,
      total: 1,
      percentage: 100,
    });
  });

  it("handles an empty eligible-session history without division by zero", () => {
    expect(summarizeAttendanceHistory([])).toEqual({
      list: [],
      attended: 0,
      total: 0,
      percentage: 0,
    });
  });

  it("rejects an unexpected attendance API response shape", () => {
    expect(() => parseAttendanceHistoryResponse({ records: { rows: [] } })).toThrow(
      "Attendance history response is invalid",
    );
    expect(uniqueAttendanceHistory({ records: [] })).toEqual([]);
  });
});
