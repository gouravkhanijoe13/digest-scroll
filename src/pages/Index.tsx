import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { ArrowRight, BookOpen } from "lucide-react";

const Index = () => {
  const handleStart = () => {
    toast({
      title: "You're ready to build",
      description: "This blank starter is set up with React, Tailwind, and shadcn UI.",
    });
  };

  return (
    <main>
      <section className="relative min-h-[80vh] flex items-center justify-center bg-background overflow-hidden">
        <div className="gradient-blob" aria-hidden="true" />
        <article className="container max-w-3xl text-center">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6 text-gradient">
            Blank React Starter
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground mb-8">
            A clean, modern canvas for your next idea. Zero clutter, ready to ship.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button variant="hero" size="lg" onClick={handleStart}>
              Start building
              <ArrowRight className="ml-1" />
            </Button>
            <Button variant="outline" size="lg" asChild>
              <a
                href="https://docs.lovable.dev/user-guides/quickstart"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center"
              >
                <BookOpen className="mr-2" />
                Read the docs
              </a>
            </Button>
          </div>
        </article>
      </section>
    </main>
  );
};

export default Index;
