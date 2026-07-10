import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Bold, Underline, CaseUpper } from "lucide-react";

const FONT_SIZES = [
  { label: "Small", value: "12px" },
  { label: "Normal", value: "14px" },
  { label: "Medium", value: "16px" },
  { label: "Large", value: "20px" },
  { label: "X-Large", value: "28px" },
];

// Aplica um estilo inline à seleção atual, envolvendo-a num <span>. Usa
// surroundContents quando possível; cai pro extract+wrap manual quando a
// seleção cruza fronteiras de elementos (surroundContents lança nesse caso).
function wrapSelection(style: Partial<CSSStyleDeclaration>) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const span = document.createElement("span");
  Object.assign(span.style, style);
  try {
    range.surroundContents(span);
  } catch {
    const contents = range.extractContents();
    span.appendChild(contents);
    range.insertNode(span);
  }
  sel.removeAllRanges();
  const newRange = document.createRange();
  newRange.selectNodeContents(span);
  sel.addRange(newRange);
}

// Transforma o TEXTO selecionado em maiúsculas de verdade (não CSS
// text-transform) — garante que apareça em caixa alta em qualquer cliente
// de email, mesmo os que ignoram text-transform no HTML recebido.
function uppercaseSelection() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const text = range.toString();
  if (!text) return;
  range.deleteContents();
  range.insertNode(document.createTextNode(text.toUpperCase()));
}

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  minHeight?: number;
}

// Editor WYSIWYG leve (contentEditable) pro corpo do email — negrito,
// sublinhado, cor, tamanho de fonte e caixa alta. Sem lib nova: usa
// execCommand pros comandos simples e range/selection API pros estilos
// que precisam de valor livre (cor, tamanho em px).
export function RichTextEditor({ value, onChange, minHeight = 360 }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  // null garante que o efeito abaixo aplique o innerHTML inicial no mount
  // (contentEditable não tem prop de valor controlado como um input).
  const lastValueRef = useRef<string | null>(null);

  // Só sincroniza o innerHTML quando o value mudar por FORA (mount, reset,
  // carregar do banco) — nunca a cada digitação, senão perde a posição do cursor.
  useEffect(() => {
    if (editorRef.current && value !== lastValueRef.current) {
      editorRef.current.innerHTML = value;
      lastValueRef.current = value;
    }
  }, [value]);

  const emitChange = () => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    lastValueRef.current = html;
    onChange(html);
  };

  const focusEditor = () => editorRef.current?.focus();

  return (
    <div className="rounded-md border border-input bg-background">
      <div className="flex flex-wrap items-center gap-1 border-b border-input bg-muted/40 p-1.5">
        <Button
          type="button" variant="ghost" size="icon" className="h-8 w-8"
          title="Bold"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { focusEditor(); document.execCommand("bold"); emitChange(); }}
        >
          <Bold className="h-4 w-4" />
        </Button>
        <Button
          type="button" variant="ghost" size="icon" className="h-8 w-8"
          title="Underline"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { focusEditor(); document.execCommand("underline"); emitChange(); }}
        >
          <Underline className="h-4 w-4" />
        </Button>
        <Button
          type="button" variant="ghost" size="icon" className="h-8 w-8"
          title="Uppercase selected text"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { focusEditor(); uppercaseSelection(); emitChange(); }}
        >
          <CaseUpper className="h-4 w-4" />
        </Button>

        <input
          type="color"
          title="Text color"
          className="h-8 w-8 cursor-pointer rounded border border-input bg-transparent p-0.5"
          onMouseDown={(e) => e.preventDefault()}
          onChange={(e) => { focusEditor(); wrapSelection({ color: e.target.value }); emitChange(); }}
        />

        <Select onValueChange={(size) => { focusEditor(); wrapSelection({ fontSize: size }); emitChange(); }}>
          <SelectTrigger className="h-8 w-[110px] text-xs" onMouseDown={(e) => e.preventDefault()}>
            <SelectValue placeholder="Font size" />
          </SelectTrigger>
          <SelectContent>
            {FONT_SIZES.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="ml-1 text-[11px] text-muted-foreground">
          Select text, then apply formatting.
        </span>
      </div>

      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        className="prose prose-sm max-w-none px-3 py-2 text-sm focus:outline-none"
        style={{ minHeight }}
        onInput={emitChange}
        onBlur={emitChange}
      />
    </div>
  );
}
