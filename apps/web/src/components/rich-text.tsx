import { Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Minimal formatting for assistant text: paragraphs, "• " bullets and **bold**. */
export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = text.split(/\n\s*\n/);
  return (
    <div className={cn('space-y-2.5', className)}>
      {blocks.map((block, index) => {
        const lines = block.split('\n');
        const isList = lines.every((line) => /^\s*[•\-]\s+/.test(line));
        if (isList) {
          return (
            <ul key={index} className="space-y-1 pl-1">
              {lines.map((line, i) => (
                <li key={i} className="flex gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-[9px] size-1.5 shrink-0 rounded-full bg-current opacity-50"
                  />
                  <span>{inline(line.replace(/^\s*[•\-]\s+/, ''))}</span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index}>
            {lines.map((line, i) => (
              <Fragment key={i}>
                {i > 0 ? <br /> : null}
                {inline(line)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function inline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={index} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}
