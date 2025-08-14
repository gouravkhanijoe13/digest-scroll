import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAIApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const { deckId } = await req.json();
    if (!deckId) {
      throw new Error('Deck ID is required');
    }

    console.log('Generating cards for deck:', deckId);

    // Get deck details
    const { data: deck, error: deckError } = await supabaseClient
      .from('decks')
      .select('*')
      .eq('id', deckId)
      .single();

    if (deckError || !deck) {
      throw new Error('Deck not found');
    }

    // Update deck status to processing
    await supabaseClient
      .from('decks')
      .update({ status: 'processing' })
      .eq('id', deckId);

    // Get deck's associated documents
    const { data: deckDocuments, error: deckDocsError } = await supabaseClient
      .from('deck_documents')
      .select('document_id')
      .eq('deck_id', deckId);

    if (deckDocsError) {
      throw new Error('Failed to fetch deck documents');
    }

    const documentIds = deckDocuments?.map(dd => dd.document_id) || [];
    
    // Get all chunks for these documents
    const { data: chunks, error: chunksError } = await supabaseClient
      .from('chunks')
      .select('*')
      .in('document_id', documentIds)
      .order('chunk_index');

    if (chunksError) {
      throw new Error('Failed to fetch chunks');
    }

    if (!chunks || chunks.length === 0) {
      throw new Error('No chunks found for this deck');
    }

    const cards = [];

    // Generate cards from chunks
    for (const chunk of chunks) {
      try {
        const prompt = `Extract the most important factual information from this text and create exactly 2 learning cards. Each card should have:
- Front: A clear, specific question or concept (max 1 line)
- Back: A factual, concise answer (max 1 line)

Text: "${chunk.content}"

Format your response as JSON:
{
  "cards": [
    {"front": "question 1", "back": "answer 1"},
    {"front": "question 2", "back": "answer 2"}
  ]
}`;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openAIApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: 'You are an expert at creating concise, factual learning cards. Keep answers under 20 words each.'
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0.3,
            max_tokens: 500,
          }),
        });

        const data = await response.json();
        const content = data.choices[0].message.content;
        
        try {
          const parsedCards = JSON.parse(content);
          
          for (const cardData of parsedCards.cards) {
            cards.push({
              user_id: deck.user_id,
              chunk_id: chunk.id,
              front_text: cardData.front.substring(0, 255), // Ensure it fits DB constraint
              back_text: cardData.back.substring(0, 255),
              difficulty: 'medium'
            });
          }
        } catch (parseError) {
          console.error('Failed to parse card generation response:', parseError);
          // Fallback: create a simple card from the chunk
          cards.push({
            user_id: deck.user_id,
            chunk_id: chunk.id,
            front_text: 'What is the main concept in this text?',
            back_text: chunk.content.substring(0, 100) + '...',
            difficulty: 'medium'
          });
        }

      } catch (cardError) {
        console.error('Failed to generate cards for chunk:', chunk.id, cardError);
      }
    }

    // Insert cards in batches
    const batchSize = 10;
    const insertedCards = [];

    for (let i = 0; i < cards.length; i += batchSize) {
      const batch = cards.slice(i, i + batchSize);
      
      const { data: batchCards, error: insertError } = await supabaseClient
        .from('cards')
        .insert(batch)
        .select();

      if (insertError) {
        console.error('Failed to insert cards batch:', insertError);
      } else {
        insertedCards.push(...batchCards);
      }
    }

    // Create deck_cards associations
    const deckCards = insertedCards.map((card, index) => ({
      deck_id: deckId,
      card_id: card.id,
      user_id: deck.user_id,
      position: index
    }));

    await supabaseClient
      .from('deck_cards')
      .insert(deckCards);

    // Update deck status to completed
    await supabaseClient
      .from('decks')
      .update({ status: 'completed' })
      .eq('id', deckId);

    console.log('Card generation completed successfully');

    return new Response(
      JSON.stringify({
        success: true,
        cardsGenerated: insertedCards.length,
        deckId: deckId
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error generating cards:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});