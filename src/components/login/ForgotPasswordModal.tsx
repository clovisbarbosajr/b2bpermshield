import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
}

const ForgotPasswordModal = ({ open, onClose }: Props) => {
  const [resetEmail, setResetEmail] = useState("");
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = resetEmail.trim().toLowerCase();
    if (!trimmed) { toast.error("Please enter your email"); return; }
    setLoading(true);

    // Send reset email through our own SMTP (Office 365) instead of Supabase default
    const { error } = await supabase.functions.invoke("send-email", {
      body: {
        type: "password_reset",
        email: trimmed,
        redirectTo: `${window.location.origin}/reset-password`,
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message || "Failed to send reset email");
    } else {
      toast.success("If an account exists for this email, a reset link has been sent.");
      onClose();
      setResetEmail("");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#0d1929] border border-white/10 rounded-xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-xl font-bold text-white mb-1">Reset Password</h2>
        <p className="text-sm text-white/50 mb-4">
          Enter your email to receive a password reset link. We only send links to registered accounts.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-1 block">Email</label>
            <input
              type="email"
              placeholder="your@email.com"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
              required
              className="w-full px-4 py-3 md:py-2.5 rounded bg-white/5 border border-white/15 text-white placeholder-white/30 text-sm focus:outline-none focus:border-[#4fc3f7]/50 transition-all"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 md:py-2.5 rounded bg-[#e8780a] hover:bg-[#f08020] active:bg-[#d06800] text-white font-bold uppercase tracking-wider text-sm transition-all disabled:opacity-50"
          >
            {loading ? "Checking..." : "Send Reset Link"}
          </button>
          <button
            type="button"
            onClick={() => { onClose(); setResetEmail(""); }}
            className="text-sm text-white/30 hover:text-white/60 transition-colors py-1"
          >
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
};

export default ForgotPasswordModal;
