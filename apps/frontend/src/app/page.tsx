import { Button } from "@/shared/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-background px-6 py-24 text-foreground">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-medium tracking-tight">
          shadcn/ui is set up
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Tailwind CSS and shadcn/ui components are ready to use in this app.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
      </div>
    </main>
  );
}
