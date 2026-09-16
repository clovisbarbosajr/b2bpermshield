import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  ACTIVITY_OPTIONS, COUNTRIES, US_STATES, REQUIRED, LABELS, limiteDe, validarCadastro, montarFicha, RECAPTCHA_SITE_KEY, type CadastroForm,
} from "@/lib/cadastroCliente";

const VAZIO: CadastroForm = {
  empresa: "", nome: "", telefone: "", activity: "", endereco: "", endereco2: "", cidade: "",
  estado: "", pais: "United States", cep: "", email: "", password: "", passwordConfirm: "",
};

// Script do Google bloqueado (ad blocker, firewall): sem isto o botao so repetia
// "confirm you are not a robot" sem checkbox nenhum na tela.
const CAPTCHA_NAO_CARREGOU = "The security check could not load. Disable ad blockers or try another network, then reload this page.";

const Cadastro = () => {
  const [form, setForm] = useState<CadastroForm>(VAZIO);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [fichaFalhou, setFichaFalhou] = useState(false);
  // "Allow open customer registration" (Settings) era um checkbox MORTO: nada no
  // caminho publico lia a flag. Comeca `true` e so fecha se a RPC disser que nao —
  // fail-open, pra ligar esta trava nunca fechar o cadastro por acidente.
  const [aberto, setAberto] = useState(true);
  const [captcha, setCaptcha] = useState("");
  const [captchaErro, setCaptchaErro] = useState(false);
  const captchaDiv = useRef<HTMLDivElement>(null);
  const captchaId = useRef<number | null>(null);

  useEffect(() => {
    (supabase as any).rpc("registration_is_open")
      .then(({ data, error }: any) => { if (!error && data === false) setAberto(false); })
      .catch(() => { /* mantem aberto */ });
  }, []);

  // reCAPTCHA v2 explicito. `captchaId` impede o 2o render no mesmo div (StrictMode
  // roda o efeito duas vezes e o Google lanca "already been rendered"). Script ja
  // carregado numa montagem anterior: o `onload` nao dispara de novo, entao monta direto.
  useEffect(() => {
    const w = window as any;
    const montar = () => {
      const el = captchaDiv.current;
      if (!el || captchaId.current !== null || !w.grecaptcha?.render) return;
      captchaId.current = w.grecaptcha.render(el, {
        sitekey: RECAPTCHA_SITE_KEY,
        size: el.offsetWidth < 304 ? "compact" : "normal",
        callback: (t: string) => setCaptcha(t),
        "expired-callback": () => setCaptcha(""),
        "error-callback": () => setCaptcha(""),
      });
    };
    if (w.grecaptcha?.render) return montar();
    w.__recaptchaCadastro = montar;
    if (!document.getElementById("recaptcha-api")) {
      const s = document.createElement("script");
      s.id = "recaptcha-api";
      s.src = "https://www.google.com/recaptcha/api.js?onload=__recaptchaCadastro&render=explicit";
      s.async = true;
      // Remove o script que falhou: remontar a tela tenta carregar de novo.
      s.onerror = () => { s.remove(); setCaptchaErro(true); };
      document.head.appendChild(s);
    }
  }, []);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    const invalido = validarCadastro(form);
    if (invalido) {
      toast.error(invalido);
      return;
    }
    if (!captcha) {
      toast.error(captchaErro ? CAPTCHA_NAO_CARREGOU : "Please confirm you are not a robot");
      return;
    }
    if (!aberto) {
      toast.error("Registration is currently closed. Please contact us to open an account.");
      return;
    }
    setLoading(true);
    const email = form.email.trim();
    const nome = form.nome.trim();
    const empresa = form.empresa.trim();
    const password = form.password;
    const ficha = montarFicha(form);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { nome, empresa },
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      setSent(true);
      toast.success("Check your email to confirm your registration");
      // register-customer (server-side) faz TUDO do cadastro: cria a ficha PENDENTE
      // (pro admin ver/aprovar sem esperar o 1º login) E dispara as notificações
      // (email pro cliente + email/SMS pro admin). Feito no servidor porque no
      // signup o cliente ainda NÃO tem sessão — o frontend cairia na trava anti-relay
      // e no 401 do notify-dispatch. Aguarda pra garantir que roda antes de sair.
      //
      // O ERRO E LIDO. Antes eram DOIS descartes no mesmo `await`: o `.catch(() => {})`
      // engolia a falha de rede e o `{ error }` da resposta nem era desestruturado.
      // Falhar aqui significa que NAO existe ficha em `clientes` e o admin nunca
      // sera avisado — a conta de auth fica viva, a pessoa loga e cai para sempre
      // em /pending-approval, e ninguem do lado de ca sabe que ela existe.
      // Nao da para desfazer o signUp daqui, entao o minimo honesto e contar.
      const { error: fichaErr } = await supabase.functions
        .invoke("register-customer", { body: { email, nome, empresa, ...ficha, captcha } })
        .catch((e: unknown) => ({ error: e }));
      if (fichaErr) {
        console.error("[cadastro] register-customer falhou; ficha pendente e aviso ao admin podem nao ter sido criados", fichaErr);
        setFichaFalhou(true);
      }
    }
  };

  if (sent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle>Check your email</CardTitle>
            <CardDescription>
              We sent a confirmation link to <strong>{form.email.trim()}</strong>.
            </CardDescription>
          </CardHeader>
          {fichaFalhou && (
            <CardContent>
              <p className="text-sm text-destructive">
                We could not reach our team about your registration. If you do not hear back,
                email <a className="underline" href="mailto:info@permshield.com">info@permshield.com</a>.
              </p>
            </CardContent>
          )}
          <CardFooter className="justify-center">
            <Link to="/login" className="text-accent hover:underline">
              Back to login
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  const obrigatorio = (k: keyof CadastroForm) => (REQUIRED as readonly string[]).includes(k);
  const rotulo = (k: keyof CadastroForm) => (
    <Label htmlFor={k}>{LABELS[k]}{obrigatorio(k) && <span aria-hidden="true"> *</span>}</Label>
  );
  const campo = (k: keyof CadastroForm, type = "text") => (
    <div className="space-y-2">
      {rotulo(k)}
      <Input
        id={k} type={type} value={form[k]} maxLength={limiteDe(k)} required={obrigatorio(k)}
        onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
      />
    </div>
  );
  const escolha = (k: keyof CadastroForm, opcoes: string[], onChange = (v: string) => setForm((f) => ({ ...f, [k]: v }))) => (
    <div className="space-y-2">
      {rotulo(k)}
      <Select value={form[k]} onValueChange={onChange}>
        <SelectTrigger id={k} aria-required={obrigatorio(k)}><SelectValue placeholder="Please select..." /></SelectTrigger>
        <SelectContent>
          {opcoes.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-5xl">
        <CardHeader className="flex flex-col gap-1 space-y-0 sm:flex-row sm:items-baseline sm:justify-between">
          <CardTitle className="text-2xl font-display">Sign Up</CardTitle>
          <p className="text-sm text-muted-foreground">
            Already got an account?{" "}
            <Link to="/login" className="text-accent hover:underline">Sign in</Link>
          </p>
        </CardHeader>
        <form onSubmit={handleSignup} noValidate>
          <CardContent className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="space-y-4">
              {campo("empresa")}
              {campo("nome")}
              {campo("telefone", "tel")}
              {escolha("activity", ACTIVITY_OPTIONS)}
            </div>
            <div className="space-y-4">
              {campo("endereco")}
              {campo("endereco2")}
              {campo("cidade")}
              {form.pais === "United States" ? escolha("estado", US_STATES) : campo("estado")}
              {escolha("pais", COUNTRIES, (v) => setForm((f) => ({ ...f, pais: v, estado: "" })))}
              {campo("cep")}
            </div>
            <div className="space-y-4">
              {campo("email", "email")}
              {campo("password", "password")}
              {campo("passwordConfirm", "password")}
              <div className="max-w-full overflow-x-auto">
                <div ref={captchaDiv} />
              </div>
              {captchaErro && <p className="text-sm text-destructive">{CAPTCHA_NAO_CARREGOU}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Signing up..." : "SIGN UP"}
              </Button>
            </div>
          </CardContent>
        </form>
      </Card>
    </div>
  );
};

export default Cadastro;
