import Link from "next/link";
import type { ReactNode } from "react";

type LegalDocumentProps = {
  title: string;
  effectiveDate: string;
  children: ReactNode;
  contactLabel: string;
  currentPage: "privacy" | "terms";
};

export function LegalDocument({
  title,
  effectiveDate,
  children,
  contactLabel,
  currentPage,
}: LegalDocumentProps) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <nav
        className="flex w-full items-center justify-between gap-4"
        aria-label="Legal navigation"
      >
        <Link
          href="/"
          className="inline-flex min-w-0 items-center gap-2 font-bold tracking-[-0.02em]"
        >
          <span className="truncate">Context101</span>
        </Link>
        <Link
          href="/"
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Back home
        </Link>
      </nav>

      <article className="border-t section-divider mt-8 py-12">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
          Legal
        </p>
        <h1 className="mt-3 text-[clamp(38px,8vw,64px)] leading-[0.98] font-bold tracking-[-0.055em]">
          {title}
        </h1>
        <p className="mt-4 border-b section-divider pb-8 text-sm text-muted-foreground">
          {effectiveDate}
        </p>

        <div className="mt-8 space-y-8 text-base leading-7 text-muted-foreground">
          {children}
        </div>

        <div className="surface-callout mt-10 p-5 text-sm leading-6 text-muted-foreground">
          {contactLabel}{" "}
          <a
            href="mailto:hi@context101.dev"
            className="text-foreground underline underline-offset-4"
          >
            hi@context101.dev
          </a>
          .
        </div>
      </article>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t section-divider py-6 text-[13px] text-muted-foreground">
        <span>Context101 alpha. Open-source first.</span>
        <div className="flex items-center gap-3">
          {currentPage === "terms" ? (
            <span className="text-foreground">Terms of Use</span>
          ) : (
            <Link
              href="/terms-of-use"
              className="transition-colors hover:text-foreground"
            >
              Terms of Use
            </Link>
          )}
          {currentPage === "privacy" ? (
            <span className="text-foreground">Privacy Policy</span>
          ) : (
            <Link
              href="/privacy-policy"
              className="transition-colors hover:text-foreground"
            >
              Privacy Policy
            </Link>
          )}
        </div>
      </footer>
    </main>
  );
}

export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold tracking-[-0.02em] text-foreground">
        {title}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

