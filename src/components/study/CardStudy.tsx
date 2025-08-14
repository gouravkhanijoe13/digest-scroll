import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/hooks/use-toast';
import { RotateCcw, Check, X, Eye } from 'lucide-react';

interface StudyCard {
  id: string;
  front_text: string;
  back_text: string;
  difficulty: string;
}

interface CardStudyProps {
  deckId: string;
  onComplete?: () => void;
}

export const CardStudy = ({ deckId, onComplete }: CardStudyProps) => {
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showBack, setShowBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [answering, setAnswering] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    if (user && deckId) {
      fetchCards();
    }
  }, [user, deckId]);

  const fetchCards = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      console.log('Fetching cards for deck:', deckId);
      
      const { data, error } = await supabase
        .from('deck_cards')
        .select(`
          position,
          cards!inner (
            id,
            front_text,
            back_text,
            difficulty
          )
        `)
        .eq('deck_id', deckId)
        .eq('user_id', user.id)
        .order('position', { ascending: true });

      if (error) {
        console.error('Error fetching deck cards:', error);
        throw error;
      }
      
      console.log('Fetched deck cards data:', data);
      
      // Transform the data to get the cards array
      const studyCards = data?.map(item => ({
        id: item.cards.id,
        front_text: item.cards.front_text,
        back_text: item.cards.back_text,
        difficulty: item.cards.difficulty,
        position: item.position
      })) || [];
      
      console.log('Transformed study cards:', studyCards);
      setCards(studyCards);
      
    } catch (error: any) {
      console.error('Error fetching cards:', error);
      toast({
        title: "Error",
        description: "Failed to load study cards. Please try again.",
        variant: "destructive",
      });
      setCards([]); // Set empty array to show "no cards" message
    } finally {
      setLoading(false);
    }
  };

  const handleAnswer = async (correct: boolean) => {
    if (!cards[currentIndex] || answering) return;

    setAnswering(true);

    try {
      // Update user progress
      const { error } = await supabase
        .from('user_progress')
        .upsert({
          user_id: user?.id,
          card_id: cards[currentIndex].id,
          reviews: 1,
          correct_count: correct ? 1 : 0,
          last_reviewed: new Date().toISOString(),
          next_review: new Date(Date.now() + (correct ? 86400000 : 3600000)).toISOString(), // 1 day or 1 hour
        }, {
          onConflict: 'user_id,card_id',
          ignoreDuplicates: false
        });

      if (error) throw error;

      // Move to next card
      setTimeout(() => {
        if (currentIndex < cards.length - 1) {
          setCurrentIndex(currentIndex + 1);
          setShowBack(false);
        } else {
          // Study session complete
          toast({
            title: "Study session complete!",
            description: `You reviewed ${cards.length} cards.`,
          });
          onComplete?.();
        }
        setAnswering(false);
      }, 500);

    } catch (error: any) {
      toast({
        title: "Failed to record progress",
        description: error.message,
        variant: "destructive",
      });
      setAnswering(false);
    }
  };

  const resetCard = () => {
    setShowBack(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-center">
          <h3 className="text-lg font-semibold mb-2">No cards to study</h3>
          <p className="text-muted-foreground">
            This deck doesn't contain any cards yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  const currentCard = cards[currentIndex];
  const progress = ((currentIndex) / cards.length) * 100;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Progress */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span>Progress</span>
          <span>{currentIndex + 1} of {cards.length}</span>
        </div>
        <Progress value={progress} className="w-full" />
      </div>

      {/* Card */}
      <Card className="min-h-[300px] relative overflow-hidden">
        <CardContent className="p-8">
          <div className="flex flex-col justify-center min-h-[200px] text-center space-y-6">
            {!showBack ? (
              <>
                <div>
                  <h3 className="text-lg font-semibold text-muted-foreground mb-2">Question</h3>
                  <p className="text-xl">{currentCard.front_text}</p>
                </div>
                <Button onClick={() => setShowBack(true)} size="lg">
                  <Eye className="h-4 w-4 mr-2" />
                  Show Answer
                </Button>
              </>
            ) : (
              <>
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground mb-1">Question</h3>
                    <p className="text-base text-muted-foreground">{currentCard.front_text}</p>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-primary mb-2">Answer</h3>
                    <p className="text-xl">{currentCard.back_text}</p>
                  </div>
                </div>
                
                <div className="flex justify-center space-x-4">
                  <Button
                    variant="outline"
                    onClick={resetCard}
                    disabled={answering}
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Review Again
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => handleAnswer(false)}
                    disabled={answering}
                  >
                    <X className="h-4 w-4 mr-2" />
                    Incorrect
                  </Button>
                  <Button
                    onClick={() => handleAnswer(true)}
                    disabled={answering}
                  >
                    <Check className="h-4 w-4 mr-2" />
                    Correct
                  </Button>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Card info */}
      <div className="text-center text-sm text-muted-foreground">
        Difficulty: <span className="capitalize">{currentCard.difficulty}</span>
      </div>
    </div>
  );
};