import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const schema = z.object({
  problem: z.string().trim().min(5).max(1000),
  context: z.object({
    signedIn: z.boolean(),
    page: z.string().max(60),
    device: z.string().max(200),
  }),
});

// Public on purpose: students who can't sign in still need help. Inputs are capped and
// no account data is read, so it only reasons about what the student describes.
export const diagnoseSignInProblem = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => schema.parse(d))
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured");

    const instructions = `You are Snippet Support inside a college attendance app. A student describes a problem signing in or reaching the Attendance page.
Facts about the app:
- Sign-in options: "Continue with Google" or email + password. New email accounts must click a confirmation link in their inbox before signing in.
- The Attendance page requires being signed in; signed-out users are sent to the sign-in page.
- Attendance is marked by typing the 6-character code the faculty shows; codes expire after a few minutes and only work for students enrolled in that class section.
- The app may be opened in an embedded preview or the live site; each keeps its own sign-in, so being signed in on one doesn't sign you in on the other.
- Browsers that block cookies/site storage, private mode, or in-app browsers (WhatsApp/Instagram) can lose the sign-in.
Diagnose the most likely cause(s) from the description and give 3-5 concrete numbered next steps. If it's likely a faculty/admin issue (e.g. not enrolled in a section), say who to contact. Be brief, friendly, plain language, short markdown. Never ask for passwords.
Context: signed in = ${data.context.signedIn}; page = ${data.context.page}; device = ${data.context.device}.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "fetch" },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        instructions,
        input: [{ role: "user", content: data.problem }],
        stream: true,
        store: false,
        reasoning: { effort: "low", summary: "auto" },
        include: ["reasoning.encrypted_content"],
      }),
    });
    if (!res.ok || !res.body) {
      if (res.status === 429) throw new Error("Snippet is busy right now. Please try again in a moment.");
      if (res.status === 402) throw new Error("AI credits have run out for this workspace.");
      throw new Error(`Help is unavailable right now (${res.status}).`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "", text = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const frames = buf.split("\n\n");
      buf = frames.pop() ?? "";
      for (const f of frames) {
        const line = f.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        let ev: { type?: string; delta?: string; error?: { message?: string } };
        try { ev = JSON.parse(payload); } catch { continue; }
        if (ev.type === "response.output_text.delta") text += ev.delta ?? "";
        if (ev.type === "response.failed" || ev.type === "error") throw new Error(ev.error?.message ?? "AI request failed");
      }
    }
    return { answer: text.trim() || "I couldn't work that out. Please try describing it differently." };
  });
