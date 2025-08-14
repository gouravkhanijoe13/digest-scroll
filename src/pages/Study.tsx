import { useParams, useNavigate } from 'react-router-dom';
import { SwipeDeck } from '@/components/deck/SwipeDeck';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export const Study = () => {
  const { deckId } = useParams<{ deckId: string }>();
  const navigate = useNavigate();

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
    <div className="relative min-h-screen bg-background">
      <div className="absolute top-4 left-4 z-10">
        <Button variant="ghost" onClick={handleBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
      </div>

      <SwipeDeck deckId={deckId} />
    </div>
  );
};

export default Study;