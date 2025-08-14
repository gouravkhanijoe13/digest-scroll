import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sanitizeForJson } from "../_shared/text-sanitizer.ts";

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
    
    // Get all chunks for the documents in this deck
    console.log('Fetching chunks for', documentIds.length, 'documents...');
    
    const { data: chunks, error: chunksError } = await supabaseClient
      .from('chunks')
      .select('*')
      .in('document_id', documentIds)
      .eq('user_id', deck.user_id)
      .order('chunk_index', { ascending: true });

    if (chunksError) {
      console.error('Error fetching chunks:', chunksError);
      
      // Update deck status to failed
      await supabaseClient
        .from('decks')
        .update({ status: 'failed' })
        .eq('id', deckId);
        
      throw new Error('Failed to fetch chunks');
    }

    if (!chunks || chunks.length === 0) {
      console.log('No chunks found for deck');
      
      // Update deck status to completed anyway
      await supabaseClient
        .from('decks')
        .update({ status: 'completed' })
        .eq('id', deckId);
        
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No content to generate cards from',
        cardsGenerated: 0 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    console.log('Found', chunks.length, 'chunks to process');

    const cards = [];

    // Generate cards from chunks
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      // Validate and sanitize chunk content
      const sanitizedContent = sanitizeForJson(chunk.content);
      
      if (sanitizedContent.trim().length < 20) {
        console.log('Skipping chunk', i, '- content too short');
        continue;
      }
      
      console.log('Generating cards for chunk', i + 1, 'of', chunks.length);
      
      try {
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
                content: `You are an expert at creating educational flashcards. Given a chunk of text, create 2-3 concise learning cards.
                
                Return your response as a JSON array of objects with this exact format:
                [{"front": "Question or key concept", "back": "Answer or explanation"}]
                
                Guidelines:
                - Make cards focused and specific
                - Use clear, simple language
                - Ensure the front side asks something answerable from the back
                - Keep cards concise but informative
                - Extract the most important concepts from the text
                - If the text is unclear or corrupted, create a general card about the document topic`
              },
              {
                role: 'user',
                content: `Create learning cards from this text:\n\n${sanitizedContent}`
              }
            ],
            temperature: 0.7,
            max_tokens: 500
          }),
        });

        if (!response.ok) {
          console.error('OpenAI API error:', response.status, response.statusText);
          
          // Create fallback card for failed API calls
          cards.push({
            user_id: deck.user_id,
            chunk_id: chunk.id,
            front_text: `Content from ${deck.title} - Chunk ${i + 1}`,
            back_text: sanitizedContent.substring(0, 200) + (sanitizedContent.length > 200 ? '...' : ''),
            difficulty: 'medium'
          });
          continue;
        }

        const data = await response.json();
        const content = data.choices[0]?.message?.content;

        if (!content) {
          console.error('No content in OpenAI response');
          
          // Create fallback card
          cards.push({
            user_id: deck.user_id,
            chunk_id: chunk.id,
            front_text: `Key concept from ${deck.title}`,
            back_text: sanitizedContent.substring(0, 200) + (sanitizedContent.length > 200 ? '...' : ''),
            difficulty: 'medium'
          });
          continue;
        }

        try {
          const parsedCards = JSON.parse(content);
          
          if (Array.isArray(parsedCards)) {
            for (const card of parsedCards) {
              if (card.front && card.back) {
                cards.push({
                  user_id: deck.user_id,
                  chunk_id: chunk.id,
                  front_text: sanitizeForJson(card.front).substring(0, 500),
                  back_text: sanitizeForJson(card.back).substring(0, 500),
                  difficulty: 'medium'
                });
              }
            }
          }
        } catch (parseError) {
          console.error('Error parsing OpenAI response:', parseError, 'Content:', content);
          
          // Try to extract usable content or create fallback
          const fallbackFront = `Key concept from ${deck.title}`;
          const fallbackBack = sanitizedContent.substring(0, 200) + (sanitizedContent.length > 200 ? '...' : '');
          
          cards.push({
            user_id: deck.user_id,
            chunk_id: chunk.id,
            front_text: fallbackFront,
            back_text: fallbackBack,
            difficulty: 'medium'
          });
        }

      } catch (cardError) {
        console.error('Failed to generate cards for chunk:', chunk.id, cardError);
        
        // Create fallback card even for complete failures
        cards.push({
          user_id: deck.user_id,
          chunk_id: chunk.id,
          front_text: `Content from document`,
          back_text: sanitizedContent.substring(0, 200) + (sanitizedContent.length > 200 ? '...' : ''),
          difficulty: 'medium'
        });
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