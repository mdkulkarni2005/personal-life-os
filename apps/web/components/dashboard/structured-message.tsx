import type { ReactNode } from "react";

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    if (match[1]) {
      nodes.push(<strong key={`${match.index}-b`}>{match[1]}</strong>);
    } else if (match[2]) {
      nodes.push(<em key={`${match.index}-i`}>{match[2]}</em>);
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "number"; index: string; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "blank" };

function classifyLine(line: string): Block {
  const trimmed = line.trim();
  if (!trimmed) return { kind: "blank" };
  const h = trimmed.match(/^(#{1,3})\s+(.*)$/);
  if (h) {
    const hashes = h[1] ?? "";
    return { kind: "heading", level: hashes.length as 1 | 2 | 3, text: h[2] ?? "" };
  }
  const bullet = trimmed.match(/^[-*•]\s+(.*)$/);
  if (bullet) return { kind: "bullet", text: bullet[1] ?? "" };
  const number = trimmed.match(/^(\d+[.)])\s+(.*)$/);
  if (number) return { kind: "number", index: number[1] ?? "", text: number[2] ?? "" };
  return { kind: "paragraph", text: trimmed };
}

export function StructuredMessage({
  content,
  className = "",
}: {
  content: string;
  className?: string;
}) {
  const blocks = content.split(/\n/).map(classifyLine);
  const output: ReactNode[] = [];
  let i = 0;

  while (i < blocks.length) {
    const block = blocks[i];
    if (!block) {
      i += 1;
      continue;
    }

    if (block.kind === "blank") {
      output.push(<div key={`gap-${i}`} className="h-2" />);
      i += 1;
      continue;
    }

    if (block.kind === "heading") {
      const Tag = block.level === 1 ? "h4" : block.level === 2 ? "h5" : "h6";
      output.push(
        <Tag
          key={`h-${i}`}
          className={`font-semibold ${block.level === 1 ? "text-base" : block.level === 2 ? "text-sm" : "text-xs uppercase tracking-wide"}`}
        >
          {renderInline(block.text)}
        </Tag>,
      );
      i += 1;
      continue;
    }

    if (block.kind === "bullet" || block.kind === "number") {
      const items: Block[] = [];
      while (
        i < blocks.length &&
        (blocks[i]?.kind === "bullet" || blocks[i]?.kind === "number")
      ) {
        items.push(blocks[i]!);
        i += 1;
      }
      output.push(
        <ul key={`list-${i}`} className="space-y-1 pl-4">
          {items.map((item, idx) => (
            <li key={`${i}-${idx}`} className="flex gap-2">
              <span className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-current/70" aria-hidden />
              <span className="min-w-0 flex-1">{renderInline((item as Extract<Block, { kind: "bullet" | "number" }>).text)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    const paras: string[] = [];
    while (
      i < blocks.length &&
      blocks[i]?.kind === "paragraph"
    ) {
      paras.push((blocks[i] as Extract<Block, { kind: "paragraph" }>).text);
      i += 1;
    }
    output.push(
      <p key={`p-${i}`} className="whitespace-pre-wrap leading-relaxed">
        {renderInline(paras.join("\n"))}
      </p>,
    );
  }

  return <div className={`space-y-2 ${className}`}>{output}</div>;
}
