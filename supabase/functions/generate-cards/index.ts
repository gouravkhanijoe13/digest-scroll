import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sanitizeForJson } from "../_shared/text-sanitizer.ts";
// CI trigger: updating function file to trigger GitHub Actions deployment

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

    const { deckId, maxCards = 25 } = await req.json();
    if (!deckId) {
      throw new Error('deckId is required');
    }

    console.log('Generating cards for deck:', deckId);

    // Step 1: Get deck details (simple select, no joins)
    const { data: deck, error: deckError } = await supabaseClient
      .from('decks')
      .select('id, user_id, title, status')
      .eq('id', deckId)
      .single();

    if (deckError || !deck) {
      throw new Error('Deck not found');
    }

    // Step 2: Get document IDs linked to this deck
    const { data: deckDocuments, error: deckDocsError } = await supabaseClient
      .from('deck_documents')
      .select('document_id')
      .eq('deck_id', deckId);

    if (deckDocsError || !deckDocuments || deckDocuments.length === 0) {
      throw new Error('No documents linked to deck');
    }

    const documentIds = deckDocuments.map(dd => dd.document_id);
    console.log('Found', documentIds.length, 'documents linked to deck');

    // Step 3: Get ordered chunks for the linked documents (limit to ~60, slice to ~16k chars)
    const { data: chunks, error: chunksError } = await supabaseClient
      .from('chunks')
      .select('id, content')
      .in('document_id', documentIds)
      .eq('user_id', deck.user_id)
      .order('chunk_index', { ascending: true })
      .limit(60);

    if (chunksError) {
      console.error('Error fetching chunks:', chunksError);
      throw new Error('Failed to fetch chunks');
    }

    if (!chunks || chunks.length === 0) {
      console.log('No chunks found for documents');
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

    // Get document category from first document's metadata
    let category = 'educational_content';
    try {
      const { data: firstDoc } = await supabaseClient
        .from('documents')
        .select('metadata')
        .eq('id', documentIds[0])
        .single();
      
      if (firstDoc?.metadata?.category) {
        category = firstDoc.metadata.category;
      }
    } catch (err) {
      console.log('Could not determine document category, using default');
    }

    console.log('Document category:', category);

    // Category-specific prompts and card counts
    const categoryStrategies: Record<string, { prompt: string; count: number }> = {
      'technical_document': {
        prompt: 'Generate technical learning cards focusing on: key concepts with definitions, code examples with explanations, implementation steps, best practices, common pitfalls, and practical applications.',
        count: 30
      },
      'book_chapter': {
        prompt: 'Create book summary cards with: key themes and ideas, important quotes with context, character insights, plot points, lessons learned, and actionable takeaways.',
        count: 25
      },
      'research_paper': {
        prompt: 'Develop research-focused cards covering: methodology explanation, key findings, statistical insights, implications, limitations, and future research directions.',
        count: 20
      },
      'blog_article': {
        prompt: 'Generate article digest cards with: main arguments, supporting evidence, practical tips, real-world examples, author insights, and actionable advice.',
        count: 15
      },
      'motivational_content': {
        prompt: 'Create inspirational cards featuring: key principles, motivational quotes, success strategies, mindset shifts, personal development tips, and action steps.',
        count: 20
      },
      'business_document': {
        prompt: 'Develop business-oriented cards with: strategic insights, key metrics, process steps, decision frameworks, risk factors, and implementation guidelines.',
        count: 25
      }
    };

    const strategy = categoryStrategies[category] || categoryStrategies['educational_content'] || {
      prompt: 'Generate educational cards with key concepts, explanations, examples, and practical applications.',
      count: 20
    };

    const targetCards = Math.min(strategy.count, maxCards);

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
               content: `You are creating digestible learning cards for a ${category.replace('_', ' ')}. Return JSON array [{ "text": "line1\\nline2" }, ...]. Each text <= 220 chars, exactly TWO lines separated by ONE newline. No markdown, no quotes.

${strategy.prompt}

Build cards that progress logically from basic concepts to advanced applications. Each card should be self-contained but connect to others for comprehensive understanding. Generate exactly ${targetCards} cards.`
             },
            {
              role: 'user',
              content: `Create ${targetCards} progressive learning cards for this ${category.replace('_', ' ')}:\n\n${combinedText}`
            }
          ],
          temperature: 0.7,
          max_tokens: 3000
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
        { text: `Key concept from ${deck.title}\nReview the document content for details` },
        { text: `Important information\nFound in the uploaded document` },
        { text: `Learning point\nExtracted from the text content` },
        { text: `Main idea summary\nCore insights from the material` },
        { text: `Study reminder\nCarefully review all sections` }
      ];
    }

    console.log('Generated', cards.length, 'cards');

    // Insert cards with front_text/back_text split
    const cardRows = cards.map((card, index) => {
      const lines = card.text.split('\n');
      return {
        user_id: deck.user_id,
        chunk_id: chunks[0]?.id || null, // Associate with first chunk
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

    // Create deck_cards associations with position
    const deckCards = insertedCards.map((card, index) => ({
      deck_id: deck.id,
      card_id: card.id,
      user_id: deck.user_id,
      position: index + 1
    }));

    const { error: deckCardsError } = await supabaseClient
      .from('deck_cards')
      .insert(deckCards);

    if (deckCardsError) {
      console.error('Failed to insert deck_cards:', deckCardsError);
      throw new Error('Failed to insert deck_cards');
    }

    // Update deck status to completed
    const { error: updateError } = await supabaseClient
      .from('decks')
      .update({ status: 'completed' })
      .eq('id', deck.id);

    if (updateError) {
      console.error('Failed to update deck status:', updateError);
      throw new Error('Failed to update deck status');
    }

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