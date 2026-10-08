import { useState } from "react";
import { api } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

export function ProfileForm({ user }: { user: any }) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const qc = useQueryClient();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setMsg("");
    const formData = new FormData(e.currentTarget);
    const fullName = formData.get("fullName") as string;
    const password = formData.get("password") as string;
    
    const body: any = {};
    if (fullName && fullName !== user?.fullName) body.fullName = fullName;
    if (password) body.password = password;

    if (Object.keys(body).length === 0) {
      setLoading(false);
      return;
    }

    try {
      await api("/auth/me", {
        method: "PATCH",
        body
      });
      setMsg("Profile updated successfully");
      qc.invalidateQueries({ queryKey: ["auth-me"] });
      (e.target as HTMLFormElement).reset();
    } catch (err: any) {
      setMsg(err.message || "Failed to update profile");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {msg && <div className="text-sm text-primary">{msg}</div>}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-muted-foreground">Full Name</label>
        <input 
          type="text" 
          name="fullName" 
          defaultValue={user?.fullName || ""} 
          className="rounded-xl border border-border bg-card p-3 text-sm outline-none"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-muted-foreground">New Password</label>
        <input 
          type="password" 
          name="password" 
          placeholder="Leave blank to keep current" 
          className="rounded-xl border border-border bg-card p-3 text-sm outline-none"
        />
      </div>
      <button 
        disabled={loading} 
        type="submit" 
        className="press mt-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground"
      >
        Save Changes
      </button>
    </form>
  );
}
