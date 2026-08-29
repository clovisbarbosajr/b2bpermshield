import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

const RecuperarSenha = () => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // Envia pelo nosso send-email (Resend + Office365 fallback), não pelo email nativo
    // do Supabase (que pode não estar configurado e o link não chegar).
    const { error } = await supabase.functions.invoke("send-email", {
      body: { type: "password_reset", email: email.trim().toLowerCase(), redirectTo: `${window.location.origin}/reset-password` },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      setSent(true);
    }
  };

  if (sent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            {/* A tela NAO SABE que o e-mail saiu. `send-email` responde
                `{success:true}` tambem quando o e-mail nao existe (anti-oraculo,
                de proposito) e quando o limite de 3 links por 15 min ja foi
                atingido. "Email sent / check your inbox" afirmava o que o codigo
                nao sabe, e quem batia no limite ficava esperando um e-mail que
                nunca ia chegar. O texto agora cobre os tres casos sem revelar
                qual deles aconteceu. */}
            <CardTitle>Check your inbox</CardTitle>
            <CardDescription>
              If an account exists for that address, a reset link is on its way. Reset links are
              limited to a few every 15 minutes — if nothing arrives, wait a moment before trying again.
            </CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Link to="/login" className="text-accent hover:underline">Back to login</Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="font-display">Reset Password</CardTitle>
          <CardDescription>Enter your email to receive the reset link</CardDescription>
        </CardHeader>
        <form onSubmit={handleReset}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Sending..." : "Send reset link"}
            </Button>
            <Link to="/login" className="text-sm text-accent hover:underline">Back to login</Link>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};

export default RecuperarSenha;
