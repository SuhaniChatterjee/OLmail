import { useEffect, useRef, type ReactNode } from 'react';
import {
  AlignCenterIcon,
  AlignLeftIcon,
  BoldIcon,
  BulletListIcon,
  IndentIcon,
  ItalicIcon,
  OrderedListIcon,
  OutdentIcon,
  QuoteIcon,
  RedoIcon,
  StrikeIcon,
  TextSizeIcon,
  UnderlineIcon,
  UndoIcon,
} from '../ui/icons';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

type Tool = { label: string; icon: ReactNode; run: () => void } | 'divider';

// document.execCommand is deprecated but universally supported and keeps the
// editor dependency-free; the output is plain HTML that email clients render.
const exec = (command: string, value?: string) => document.execCommand(command, false, value);

export function RichTextEditor({ value, onChange, placeholder }: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const fontSize = useRef(3);

  // Only push external value into the DOM when it differs (e.g. reset), so the caret isn't lost while typing.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value;
  }, [value]);

  const emit = () => {
    const html = ref.current?.innerHTML ?? '';
    onChange(ref.current?.textContent?.trim() ? html : '');
  };

  const apply = (fn: () => void) => () => {
    ref.current?.focus();
    fn();
    emit();
  };

  const tools: Tool[] = [
    { label: 'Undo', icon: <UndoIcon />, run: () => exec('undo') },
    { label: 'Redo', icon: <RedoIcon />, run: () => exec('redo') },
    'divider',
    {
      label: 'Text size',
      icon: <TextSizeIcon />,
      run: () => {
        fontSize.current = fontSize.current >= 5 ? 2 : fontSize.current + 1;
        exec('fontSize', String(fontSize.current));
      },
    },
    'divider',
    { label: 'Bold', icon: <BoldIcon />, run: () => exec('bold') },
    { label: 'Italic', icon: <ItalicIcon />, run: () => exec('italic') },
    { label: 'Underline', icon: <UnderlineIcon />, run: () => exec('underline') },
    'divider',
    { label: 'Align center', icon: <AlignCenterIcon />, run: () => exec('justifyCenter') },
    { label: 'Align left', icon: <AlignLeftIcon />, run: () => exec('justifyLeft') },
    'divider',
    { label: 'Numbered list', icon: <OrderedListIcon />, run: () => exec('insertOrderedList') },
    { label: 'Bulleted list', icon: <BulletListIcon />, run: () => exec('insertUnorderedList') },
    { label: 'Indent', icon: <IndentIcon />, run: () => exec('indent') },
    { label: 'Outdent', icon: <OutdentIcon />, run: () => exec('outdent') },
    { label: 'Quote', icon: <QuoteIcon />, run: () => exec('formatBlock', 'blockquote') },
    'divider',
    { label: 'Strikethrough', icon: <StrikeIcon />, run: () => exec('strikeThrough') },
  ];

  return (
    <div className="rounded-xl bg-[#f7f7f7] p-3.5">
      <div className="mb-3 flex flex-wrap items-center gap-0.5 rounded-full bg-white px-3 py-1.5" role="toolbar" aria-label="Formatting">
        {tools.map((tool, i) =>
          tool === 'divider' ? (
            <span key={i} className="mx-1.5 h-5 w-px bg-line" />
          ) : (
            <button
              key={tool.label}
              type="button"
              title={tool.label}
              aria-label={tool.label}
              onMouseDown={(e) => e.preventDefault()} // keep selection in the editor
              onClick={apply(tool.run)}
              className="flex h-8 w-8 items-center justify-center rounded-md text-[#555] hover:bg-field hover:text-ink"
            >
              {tool.icon}
            </button>
          ),
        )}
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Email body"
        data-placeholder={placeholder}
        onInput={emit}
        className="rich-content min-h-[320px] px-1 text-[15px] leading-relaxed text-ink outline-none"
      />
    </div>
  );
}
