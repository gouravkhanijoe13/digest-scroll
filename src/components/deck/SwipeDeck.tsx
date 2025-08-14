import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

interface Card {
  id: string;
  front_text: string;
  back_text: string;
  difficulty: string;
}

interface SwipeDeckProps {
  deckId: string;
}

export const SwipeDeck = ({ deckId }: SwipeDeckProps) => {
  const { user } = useAuth();
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user && deckId) {
      fetchCards();
    }
  }, [user, deckId]);

  const fetchCards = async () => {
    try {
      setLoading(true);
      
      // Fetch cards for this deck ordered by position
      const { data, error } = await supabase
        .from('deck_cards')
        .select(`
          position,
          cards!inner(
            id,
            front_text,
            back_text,
            difficulty
          )
        `)
        .eq('deck_id', deckId)
        .eq('user_id', user?.id)
        .order('position', { ascending: true });

      if (error) {
        console.error('Error fetching cards:', error);
        return;
      }

      if (data) {
        const cardList = data.map(item => item.cards);
        setCards(cardList);
      }
    } catch (error) {
      console.error('Error in fetchCards:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">No Cards Available</h2>
          <p className="text-muted-foreground">
            This deck doesn't have any cards yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-y-scroll snap-y snap-mandatory bg-background">
      {cards.map((card, index) => (
        <div
          key={card.id}
          className="min-h-screen snap-start flex items-center justify-center p-6"
        >
          <div className="max-w-2xl w-full">
            <div className="bg-card border rounded-xl p-8 shadow-lg">
              <div className="text-center space-y-6">
                <div className="space-y-4">
                  <div className="text-lg font-medium text-foreground leading-relaxed">
                    {card.front_text}
                  </div>
                  <div className="h-px bg-border"></div>
                  <div className="text-lg text-muted-foreground leading-relaxed">
                    {card.back_text}
                  </div>
                </div>
                
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span className="bg-muted px-3 py-1 rounded-full">
                    {card.difficulty}
                  </span>
                  <span>
                    {index + 1} of {cards.length}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};