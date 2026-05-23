"use client";

import * as React from "react";

export function TypingRotate({
  phrases,
  className,
}: {
  phrases: string[];
  className?: string;
}) {
  const [phraseIndex, setPhraseIndex] = React.useState(0);
  const [visibleChars, setVisibleChars] = React.useState(0);
  const [deleting, setDeleting] = React.useState(false);

  React.useEffect(() => {
    const phrase = phrases[phraseIndex] ?? "";
    const doneTyping = !deleting && visibleChars === phrase.length;
    const doneDeleting = deleting && visibleChars === 0;
    const delay = doneTyping ? 1100 : deleting ? 28 : 48;

    const timeout = window.setTimeout(() => {
      if (doneTyping) {
        setDeleting(true);
        return;
      }
      if (doneDeleting) {
        setDeleting(false);
        setPhraseIndex((i) => (i + 1) % phrases.length);
        return;
      }
      setVisibleChars((n) => n + (deleting ? -1 : 1));
    }, delay);

    return () => window.clearTimeout(timeout);
  }, [deleting, phraseIndex, phrases, visibleChars]);

  const phrase = phrases[phraseIndex] ?? "";

  return (
    <span className={className}>
      {phrase.slice(0, visibleChars)}
      <span className="typing-cursor" aria-hidden>
        |
      </span>
    </span>
  );
}
