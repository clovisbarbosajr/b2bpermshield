import { useMemo } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';

// Telefone limitado a +1 (US) e +55 (BR). Padrão +1. Guarda em E.164
// (ex.: "+15618498555"); exibe formatado ((561)849-8555 para +1).
const COUNTRIES = [
  { code: '+1', label: '🇺🇸 +1' },
  { code: '+55', label: '🇧🇷 +55' },
];

function parse(value: string): { country: string; digits: string } {
  const v = (value || '').replace(/^whatsapp:/i, '').trim();
  if (v.startsWith('+55')) return { country: '+55', digits: v.slice(3).replace(/\D/g, '') };
  if (v.startsWith('+1')) return { country: '+1', digits: v.slice(2).replace(/\D/g, '') };
  const d = v.replace(/\D/g, '');
  return { country: '+1', digits: d.startsWith('1') ? d.slice(1) : d };
}
function formatUS(d: string): string {
  const x = d.slice(0, 10);
  if (x.length <= 3) return x;
  if (x.length <= 6) return `(${x.slice(0, 3)})${x.slice(3)}`;
  return `(${x.slice(0, 3)})${x.slice(3, 6)}-${x.slice(6)}`;
}
function formatBR(d: string): string {
  const x = d.slice(0, 11);
  if (x.length <= 2) return x;
  if (x.length <= 7) return `(${x.slice(0, 2)})${x.slice(2)}`;
  return `(${x.slice(0, 2)})${x.slice(2, 7)}-${x.slice(7)}`;
}

export function PhoneInput({
  value, onChange, placeholder, className,
}: { value: string; onChange: (e164: string) => void; placeholder?: string; className?: string }) {
  const { country, digits } = useMemo(() => parse(value), [value]);
  const max = country === '+55' ? 11 : 10;
  const display = country === '+55' ? formatBR(digits) : formatUS(digits);

  const setCountry = (c: string) => onChange(digits ? `${c}${digits}` : '');
  const setDigits = (raw: string) => {
    const d = raw.replace(/\D/g, '').slice(0, max);
    onChange(d ? `${country}${d}` : '');
  };

  return (
    <div className={`flex gap-2 ${className ?? ''}`}>
      <Select value={country} onValueChange={setCountry}>
        <SelectTrigger className="w-[88px] shrink-0"><SelectValue /></SelectTrigger>
        <SelectContent className="bg-popover z-50">
          {COUNTRIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Input
        value={display}
        inputMode="tel"
        placeholder={placeholder ?? (country === '+55' ? '(11)91234-5678' : '(561)849-8555')}
        onChange={(e) => setDigits(e.target.value)}
      />
    </div>
  );
}

export function isCompletePhone(e164: string): boolean {
  const { country, digits } = parse(e164);
  return country === '+55' ? digits.length === 11 || digits.length === 10 : digits.length === 10;
}
