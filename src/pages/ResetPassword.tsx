import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";


// Sinal de recuperacao capturado no CARREGAMENTO DO MODULO, nao dentro do
// efeito.
//
// O supabase-js consome os tokens do fragmento da URL e LIMPA o hash assim que o
// cliente e criado — o que pode acontecer antes de o componente montar. Se a
// checagem so existisse dentro do `useEffect`, o link legitimo as vezes chegaria
// com o hash ja vazio e o cliente de verdade ficaria trancado do lado de fora.
//
// Ler aqui em cima acontece na importacao do modulo, junto com o resto do
// bundle, e o valor fica guardado.
const VEIO_DE_RECUPERACAO = (() => {
  if (typeof window === "undefined") return false;
  const hash = window.location.hash || "";
  const query = window.location.search || "";
  return /(^|[#&?])type=recovery(&|$)/.test(hash)
      || /(^|[#&?])type=recovery(&|$)/.test(query)
      || hash.includes("recovery_token");
})();

const ResetPassword = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Listen for the PASSWORD_RECOVERY event from Supabase
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true);
        setChecking(false);
      }
    });

    // Sinal capturado no topo do modulo (ver comentario la em cima): aqui o hash
    // ja pode ter sido limpo pelo supabase-js.
    if (VEIO_DE_RECUPERACAO) {
      setReady(true);
      setChecking(false);
    }

    // ANTES ESTAVA ERRADO AQUI: `if (session) setReady(true)` — QUALQUER sessao
    // liberava o formulario de troca de senha, nao so a de recuperacao.
    //
    // Isso promove uma sessao TEMPORARIA em senha PERMANENTE. O link de acesso
    // por e-mail (publico) entrega uma sessao completa a quem tiver acesso a
    // caixa: e-mail encaminhado, caixa compartilhada de compras@, computador de
    // balcao com sessao aberta. Bastava abrir /reset-password e fixar a senha.
    // E era o caminho de escalada de qualquer XSS no dominio.
    //
    // Agora so libera com sinal explicito de recuperacao: o evento
    // PASSWORD_RECOVERY, ou o `type=recovery` capturado no topo do modulo.
    if (VEIO_DE_RECUPERACAO) {
      setReady(true);
    }
    setChecking(false);

    // Timeout: if nothing detected after 3 seconds, show invalid link
    const timeout = setTimeout(() => {
      setChecking(false);
    }, 3000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Password updated successfully!");
      // Sign out so user logs in with new password
      await supabase.auth.signOut();
      navigate("/customers-login");
    }
  };

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle>Verifying...</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">Please wait while we verify your reset link.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle>Invalid link</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">This reset link is invalid or has expired.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="font-display">Set New Password</CardTitle>
        </CardHeader>
        <form onSubmit={handleUpdate}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <Input id="confirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Updating..." : "Update password"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};

export default ResetPassword;
