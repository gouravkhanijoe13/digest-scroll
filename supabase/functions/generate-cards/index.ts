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

    const { userId, documentId, mode = 'learn', maxCards = 12 } = await req.json();
    if (!userId || !documentId) {
      throw new Error('userId and documentId are required');
    }

    console.log('Generating cards for document:', documentId, 'user:', userId);

    // Get document details
    const { data: document, error: docError } = await supabaseClient
      .from('documents')
      .select('title')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      throw new Error('Document not found');
    }

    // Get ordered chunks for the document (limit to ~60, slice to ~16k chars)
    const { data: chunks, error: chunksError } = await supabaseClient
      .from('chunks')
      .select('id, content')
      .eq('document_id', documentId)
      .eq('user_id', userId)
      .order('chunk_index', { ascending: true })
      .limit(60);

    if (chunksError) {
      console.error('Error fetching chunks:', chunksError);
      throw new Error('Failed to fetch chunks');
    }

    if (!chunks || chunks.length === 0) {
      console.log('No chunks found for document');
      return new Response(JSON.stringify({ 
        ok: false, 
        message: 'No content to generate cards from',
        count: 0 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Combine chunk content and slice to ~16k chars
    const combinedText = chunks
      .map(chunk => sanitizeForJson(chunk.content))
      .join('\n\n')
      .substring(0, 16000);

    console.log('Combined text length:', combinedText.length);

    let cards = [];

    // Call OpenAI to generate cards
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
              content: `You are an expert at creating educational flashcards. Generate exactly ${maxCards} learning cards from the provided text.

Return your response as a JSON array with this EXACT format:
[{"text": "line1\\nline2"}, {"text": "line1\\nline2"}]

Rules:
- Each "text" field must be exactly 2 lines separated by \\n
- Each line must be ≤110 characters
- Total text per card ≤220 characters
- Line 1: Question or key concept
- Line 2: Answer or explanation
- Extract the most important concepts
- Make cards clear and educational`
            },
            {
              role: 'user',
              content: `Create ${maxCards} learning cards from this text:\n\n${combinedText}`
            }
          ],
          temperature: 0.7,
          max_tokens: 2000
        }),
      });

      if (!response.ok) {
        console.error('OpenAI API error:', response.status, response.statusText);
        throw new Error('OpenAI API failed');
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      if (content) {
        try {
          const parsedCards = JSON.parse(content);
          
          if (Array.isArray(parsedCards)) {
            cards = parsedCards
              .filter(card => card.text && card.text.includes('\n'))
              .slice(0, maxCards)
              .map(card => ({
                text: sanitizeForJson(card.text).substring(0, 220)
              }));
          }
        } catch (parseError) {
          console.error('Error parsing OpenAI response:', parseError);
        }
      }
    } catch (openaiError) {
      console.error('OpenAI API call failed:', openaiError);
    }

    // Fallback to stub cards if OpenAI failed
    if (cards.length === 0) {
      console.log('Creating fallback cards');
      cards = [
        { text: `Key concept from ${document.title}\nReview the document content for details` },
        { text: `Important information\nFound in the uploaded document` },
        { text: `Learning point\nExtracted from the text content` }
      ];
    }

    console.log('Generated', cards.length, 'cards');

    // Create a new deck
    const { data: deck, error: deckError } = await supabaseClient
      .from('decks')
      .insert({
        user_id: userId,
        title: `Auto Deck - ${document.title}`,
        description: `Generated from ${document.title}`,
        status: 'completed'
      })
      .select()
      .single();

    if (deckError || !deck) {
      console.error('Failed to create deck:', deckError);
      throw new Error('Failed to create deck');
    }

    // Insert cards
    const cardRows = cards.map((card, index) => {
      const lines = card.text.split('\n');
      return {
        user_id: userId,
        chunk_id: chunks[0].id, // Associate with first chunk
        front_text: lines[0] || 'Question',
        back_text: lines[1] || 'Answer',
        difficulty: 'medium'
      };
    });

    const { data: insertedCards, error: cardsError } = await supabaseClient
      .from('cards')
      .insert(cardRows)
      .select();

    if (cardsError) {
      console.error('Failed to insert cards:', cardsError);
      throw new Error('Failed to insert cards');
    }

    // Create deck_cards associations
    const deckCards = insertedCards.map((card, index) => ({
      deck_id: deck.id,
      card_id: card.id,
      user_id: userId,
      position: index
    }));

    await supabaseClient
      .from('deck_cards')
      .insert(deckCards);

    // Link deck to document
    await supabaseClient
      .from('deck_documents')
      .insert({
        user_id: userId,
        deck_id: deck.id,
        document_id: documentId
      });

    console.log('Card generation completed successfully');

    return new Response(
      JSON.stringify({
        ok: true,
        deckId: deck.id,
        count: insertedCards.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error generating cards:', error);
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});