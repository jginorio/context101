import { ThemeToggle } from "@/components/theme-toggle";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col">
      <header className="border-b px-6 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Context101</h1>
          <p className="text-xs text-muted-foreground">
            Shared team knowledge base
          </p>
        </div>
        <ThemeToggle />
      </header>

      <section className="flex-1 p-6">
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Knowledge panel coming next — tree view, markdown editor, and CRUD
          wired to the existing S3 docs bucket.
        </div>
      </section>
    </main>
  );
}
