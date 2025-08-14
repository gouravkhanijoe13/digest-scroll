import { Button } from "@/components/ui/button";
import { ArrowRight, BookOpen, Brain, FileText, Upload } from "lucide-react";
import { Link } from "react-router-dom";

const Index = () => {
  return (
    <main>
      <section className="relative min-h-screen flex items-center justify-center bg-background overflow-hidden">
        <div className="gradient-blob" aria-hidden="true" />
        <article className="container max-w-4xl text-center">
          <div className="mb-8">
            <div className="flex justify-center mb-6">
              <div className="p-4 bg-primary/10 rounded-full">
                <BookOpen className="h-12 w-12 text-primary" />
              </div>
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6 text-gradient">
              Digest.ai
            </h1>
            <p className="text-xl md:text-2xl text-muted-foreground mb-4">
              Scroll with purpose — Learn without sitting down to read
            </p>
            <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
              Transform documents, articles, and books into swipeable knowledge cards. 
              AI-powered learning that fits your busy lifestyle.
            </p>
          </div>

          <div className="flex items-center justify-center gap-4 mb-12">
            <Button size="lg" asChild>
              <Link to="/auth">
                Get Started
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link to="/auth">
                Sign In
              </Link>
            </Button>
          </div>

          {/* Features */}
          <div className="grid md:grid-cols-3 gap-8 max-w-3xl mx-auto">
            <div className="text-center space-y-4">
              <div className="p-4 bg-primary/10 rounded-full w-fit mx-auto">
                <Upload className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-xl font-semibold">Upload & Process</h3>
              <p className="text-muted-foreground">
                Upload PDFs or add URLs. AI extracts and chunks content intelligently.
              </p>
            </div>
            
            <div className="text-center space-y-4">
              <div className="p-4 bg-primary/10 rounded-full w-fit mx-auto">
                <FileText className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-xl font-semibold">Smart Cards</h3>
              <p className="text-muted-foreground">
                AI generates meaningful 2-line cards that preserve essential insights.
              </p>
            </div>
            
            <div className="text-center space-y-4">
              <div className="p-4 bg-primary/10 rounded-full w-fit mx-auto">
                <Brain className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-xl font-semibold">Knowledge Graph</h3>
              <p className="text-muted-foreground">
                Visualize connections between concepts and explore deep learning paths.
              </p>
            </div>
          </div>
        </article>
      </section>
    </main>
  );
};

export default Index;
