import { useParams, useNavigate } from 'react-router-dom';
import { CardStudy } from '@/components/study/CardStudy';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export const Study = () => {
  const { deckId } = useParams<{ deckId: string }>();
  const navigate = useNavigate();

  const handleComplete = () => {
    navigate('/dashboard/documents');
  };

  const handleBack = () => {
    navigate('/dashboard/documents');
  };

  if (!deckId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Invalid Deck</h1>
          <Button onClick={handleBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Documents
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <Button variant="ghost" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Documents
          </Button>
        </div>

        <div className="space-y-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold tracking-tight">Study Session</h1>
            <p className="text-muted-foreground">
              Review your cards and track your progress
            </p>
          </div>

          <CardStudy deckId={deckId} onComplete={handleComplete} />
        </div>
      </div>
    </div>
  );
};

export default Study;