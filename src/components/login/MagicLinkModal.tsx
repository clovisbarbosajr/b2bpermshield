import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
}

const MagicLinkModal = ({ open, onClose }: Props) => {
  const [magicEmail, setMagicEmail] = useState("");
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = magicEmail.trim().toLowerCase();
    if (!trimmed) { toast.error("Please enter your email"); return; }
    setLoading(true);

    // Always attempt to send — don't reveal whether the email is registered
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: window.location.origin,
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("If an account exists for this email, a one-time link has been sent. It expires in 5 minutes.");
      onClose();
      setMagicEmail("");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#0d1929] border border-white/10 rounded-xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-xl font-bold text-white mb-1">Email A One-Time Login Link</h2>
        <p className="text-sm text-white/50 mb-4">
          We'll send you a link that logs you in instantly. It expires in <strong className="text-white/70">5 minutes</strong>.
          Only registered accounts receive this link.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-1 block">Email</label>
            <input
              type="email"
              placeholder="your@email.com"
              value={magicEmail}
              onChange={(e) => setMagicEmail(e.target.value)}
              required
              className="w-full px-4 py-3 md:py-2.5 rounded bg-white/5 border border-white/15 text-white placeholder-white/30 text-sm focus:outline-none focus:border-[#4fc3f7]/50 transition-all"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 md:py-2.5 rounded bg-[#e8780a] hover:bg-[#f08020] active:bg-[#d06800] text-white font-bold uppercase tracking-wider text-sm transition-all disabled:opacity-50"
          >
            {loading ? "Sending..." : "Send One-Time Login Link"}
          </button>
          <button
            type="button"
            onClick={() => { onClose(); setMagicEmail(""); }}
            className="text-sm text-white/30 hover:text-white/60 transition-colors py-1"
          >
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
};

export default MagicLinkModal;
