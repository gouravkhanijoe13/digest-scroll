import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle, Clock, FileText, Brain, Zap, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface WorkflowStep {
  id: string;
  label: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
}

interface WorkflowProgressProps {
  sourceId: string;
  onComplete?: (deckId: string) => void;
}

export const WorkflowProgress = ({ sourceId, onComplete }: WorkflowProgressProps) => {
  const [steps, setSteps] = useState<WorkflowStep[]>([
    {
      id: 'analyze',
      label: 'Analyzing Document',
      status: 'processing',
      icon: Brain,
      description: 'Reading and categorizing content type...'
    },
    {
      id: 'categorize',
      label: 'Content Classification',
      status: 'pending',
      icon: FileText,
      description: 'Determining optimal card generation strategy...'
    },
    {
      id: 'generate',
      label: 'Generating Cards',
      status: 'pending',
      icon: Zap,
      description: 'Creating digestible learning cards...'
    }
  ]);

  const [category, setCategory] = useState<string>('');
  const [progress, setProgress] = useState(10);
  const [deckId, setDeckId] = useState<string>('');
  const [error, setError] = useState<string>('');
  const navigate = useNavigate();

  useEffect(() => {
    const pollWorkflow = async () => {
      try {
        // Check source status
        const { data: source } = await supabase
          .from('sources')
          .select('status, metadata')
          .eq('id', sourceId)
          .single();

        if (!source) return;

        // Check for deck related to this source via documents
        const { data: documents } = await supabase
          .from('documents')
          .select('id, metadata')
          .eq('source_id', sourceId)
          .limit(1);

        let deck = null;
        if (documents?.[0]) {
          // Step 1: Get deck_id from deck_documents (no join)
          const { data: deckDocs } = await supabase
            .from('deck_documents')
            .select('deck_id')
            .eq('document_id', documents[0].id)
            .limit(1);
          
          if (deckDocs?.[0]?.deck_id) {
            // Step 2: Get deck details by id (separate call)
            const { data: deckData } = await supabase
              .from('decks')
              .select('id, status')
              .eq('id', deckDocs[0].deck_id)
              .single();
            
            if (deckData) {
              deck = deckData;
            }
          }
        }

        if (source.status === 'processing') {
          setProgress(30);
          updateStepStatus('analyze', 'completed');
          
          // Check if source has category metadata
          const sourceMetadata = source.metadata as any;
          if (sourceMetadata?.category) {
            setCategory(sourceMetadata.category);
            updateStepStatus('categorize', 'completed');
            updateStepStatus('generate', 'processing');
            setProgress(60);
          }
          
          // Also check document metadata
          const docMetadata = documents?.[0]?.metadata as any;
          if (docMetadata?.category) {
            setCategory(docMetadata.category);
            updateStepStatus('categorize', 'completed');
            updateStepStatus('generate', 'processing');
            setProgress(60);
          }
        }

        if (deck && deck.status === 'completed') {
          setDeckId(deck.id);
          updateStepStatus('generate', 'completed');
          setProgress(100);
          
          // Check if we have cards by counting deck_cards
          const { data: cards, error: cardsError } = await supabase
            .from('deck_cards')
            .select('card_id')
            .eq('deck_id', deck.id);

          if (cardsError) {
            console.error('Error fetching cards:', cardsError);
          } else if (cards && cards.length > 0) {
            toast({
              title: "Processing Complete!",
              description: `Generated ${cards.length} learning cards`,
            });
            onComplete?.(deck.id);
          }
        }

        if (source.status === 'failed' || (deck && deck.status === 'failed')) {
          setError('Processing failed. Please try again.');
          updateStepStatus('generate', 'failed');
        }

      } catch (err) {
        console.error('Polling error:', err);
      }
    };

    const interval = setInterval(pollWorkflow, 2000);
    pollWorkflow(); // Initial check

    return () => clearInterval(interval);
  }, [sourceId, onComplete]);

  const updateStepStatus = (stepId: string, status: WorkflowStep['status']) => {
    setSteps(prev => prev.map(step => 
      step.id === stepId ? { ...step, status } : step
    ));
  };

  const getStepIcon = (step: WorkflowStep) => {
    const IconComponent = step.icon;
    
    if (step.status === 'completed') {
      return <CheckCircle className="h-6 w-6 text-green-500" />;
    } else if (step.status === 'failed') {
      return <AlertCircle className="h-6 w-6 text-red-500" />;
    } else if (step.status === 'processing') {
      return <IconComponent className="h-6 w-6 text-primary animate-pulse" />;
    } else {
      return <Clock className="h-6 w-6 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: WorkflowStep['status']) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default" className="bg-green-100 text-green-800">Complete</Badge>;
      case 'processing':
        return <Badge variant="default" className="bg-blue-100 text-blue-800">Processing</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="secondary">Pending</Badge>;
    }
  };

  const getCategoryDescription = (cat: string) => {
    const descriptions: Record<string, string> = {
      'technical_document': 'Generating concept-based cards with examples and definitions',
      'book_chapter': 'Creating summary cards with key highlights and insights',
      'research_paper': 'Focusing on methodology, findings, and conclusions',
      'blog_article': 'Extracting actionable insights and main points',
      'educational_content': 'Building progressive learning cards',
      'motivational_content': 'Highlighting key quotes and principles'
    };
    return descriptions[cat] || 'Analyzing content for optimal card strategy';
  };

  const handleViewDeck = () => {
    if (deckId) {
      navigate(`/study/${deckId}`);
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5" />
          Processing Your Document
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Overall Progress</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} className="w-full" />
        </div>

        {/* Category Display */}
        {category && (
          <div className="p-4 bg-primary/5 rounded-lg border">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="h-4 w-4 text-primary" />
              <span className="font-medium">Document Type: </span>
              <Badge variant="outline">{category.replace('_', ' ').toUpperCase()}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {getCategoryDescription(category)}
            </p>
          </div>
        )}

        {/* Steps */}
        <div className="space-y-4">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center gap-4 p-3 rounded-lg border">
              <div className="flex-shrink-0">
                {getStepIcon(step)}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">{step.label}</span>
                  {getStatusBadge(step.status)}
                </div>
                <p className="text-sm text-muted-foreground">
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Error Display */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-500" />
              <span className="font-medium text-red-800">Processing Failed</span>
            </div>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </div>
        )}

        {/* Action Buttons */}
        {progress === 100 && deckId && (
          <div className="flex gap-3">
            <Button onClick={handleViewDeck} className="flex-1">
              View Learning Cards
            </Button>
            <Button variant="outline" onClick={() => navigate('/dashboard')}>
              Back to Dashboard
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};