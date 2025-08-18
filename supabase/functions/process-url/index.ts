import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sanitizeText } from "../_shared/text-sanitizer.ts";

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

    const { sourceId } = await req.json();
    if (!sourceId) {
      throw new Error('Source ID is required');
    }

    console.log('Processing URL for source:', sourceId);

    // Get source details
    const { data: source, error: sourceError } = await supabaseClient
      .from('sources')
      .select('*')
      .eq('id', sourceId)
      .single();

    if (sourceError || !source) {
      throw new Error('Source not found');
    }

    // Update source status to processing
    await supabaseClient
      .from('sources')
      .update({ status: 'processing' })
      .eq('id', sourceId);

    // Fetch and extract text from URL
    console.log('Fetching URL content...');
    
    const response = await fetch(source.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
    }
    
    const html = await response.text();
    console.log('Fetched HTML content length:', html.length);
    
    // Robust HTML text extraction
    let extractedText = html
      // Remove script and style elements completely
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
      // Remove HTML comments
      .replace(/<!--[\s\S]*?-->/g, '')
      // Remove all HTML tags
      .replace(/<[^>]+>/g, ' ')
      // Decode HTML entities
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&[a-zA-Z0-9]+;/g, ' ');
    
    // Apply comprehensive text sanitization
    extractedText = sanitizeText(extractedText);
    
    if (!extractedText || extractedText.trim().length === 0) {
      extractedText = sanitizeText(`URL Content: ${source.title} - Content could not be extracted`);
    }
    
    console.log('Final extracted text length:', extractedText.length);

    // Create document with transaction safety
    console.log('Creating document record...');
    
    const { data: document, error: docError } = await supabaseClient
      .from('documents')
      .insert({
        source_id: sourceId,
        user_id: source.user_id,
        title: sanitizeText(source.title),
        content: extractedText,
        extracted_text: extractedText,
        token_count: extractedText.split(' ').filter(word => word.length > 0).length,
        status: 'processing'
      })
      .select()
      .single();

    if (docError || !document) {
      console.error('Error creating document:', docError);
      
      // Update source status to failed
      await supabaseClient
        .from('sources')
        .update({ status: 'failed' })
        .eq('id', sourceId);
        
      throw new Error(`Failed to create document: ${docError?.message || 'Unknown error'}`);
    }
    
    console.log('Document created successfully:', document.id);

    // Chunk the text
    const chunkSize = 350; // tokens
    const overlap = 60; // tokens
    const chunks = [];
    
    const words = extractedText.split(/\s+/);
    const wordsPerToken = 0.75; // Rough estimate
    const wordsPerChunk = Math.floor(chunkSize * wordsPerToken);
    const overlapWords = Math.floor(overlap * wordsPerToken);
    
    for (let i = 0; i < words.length; i += wordsPerChunk - overlapWords) {
      const chunkWords = words.slice(i, i + wordsPerChunk);
      const chunkText = chunkWords.join(' ');
      
      if (chunkText.trim()) {
        chunks.push({
          document_id: document.id,
          user_id: source.user_id,
          content: chunkText,
          chunk_index: chunks.length,
          start_char: i * 5,
          end_char: (i + chunkWords.length) * 5,
          token_count: Math.ceil(chunkText.length / 4)
        });
      }
    }

    // Insert chunks
    const { data: insertedChunks, error: chunkError } = await supabaseClient
      .from('chunks')
      .insert(chunks)
      .select();

    if (chunkError) {
      throw new Error('Failed to create chunks');
    }

    // Generate embeddings for chunks
    for (const chunk of insertedChunks) {
      try {
        const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openAIApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: chunk.content,
          }),
        });

        const embeddingData = await embeddingResponse.json();
        const embedding = embeddingData.data[0].embedding;

        // Insert embedding
        await supabaseClient
          .from('embeddings')
          .insert({
            chunk_id: chunk.id,
            user_id: source.user_id,
            embedding: embedding,
            model_used: 'text-embedding-3-small'
          });

      } catch (embeddingError) {
        console.error('Failed to generate embedding for chunk:', chunk.id, embeddingError);
      }
    }

    // create a deck for this document
    const { data: deck, error: deckErr } = await supabaseClient
      .from("decks")
      .insert({ 
        user_id: source.user_id, 
        title: source.title ?? "Auto Deck", 
        status: "processing" 
      })
      .select()
      .single();
    if (deckErr) throw new Error(`Failed to create deck: ${deckErr.message}`);

    // link deck to document (table exists)
    await supabaseClient.from("deck_documents").insert({
      user_id: source.user_id, 
      deck_id: deck.id, 
      document_id: document.id
    });

    console.log('Starting document categorization...');
    
    // Call categorize-document edge function
    try {
      const catRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/categorize-document`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`
        },
        body: JSON.stringify({ documentId: document.id })
      });
      
      if (catRes.ok) {
        const catResult = await catRes.json();
        console.log('Document categorization completed:', catResult.category);
      }
    } catch (catError) {
      console.error('Error categorizing document:', catError);
    }

    console.log('URL processing completed, triggering card generation...');

    // Call generate-cards edge function with deckId
    let cardGenSuccess = false;
    try {
      const genRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-cards`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`
        },
        body: JSON.stringify({ deckId: deck.id })
      });
      
      if (genRes.ok) {
        const result = await genRes.json();
        console.log('Card generation completed:', result);
        if (result.ok && result.count > 0) {
          cardGenSuccess = true;
        } else {
          console.error('Card generation returned error:', result);
        }
      } else {
        const errorText = await genRes.text();
        console.error("generate-cards failed:", genRes.status, errorText);
      }
    } catch (generateError) {
      console.error('Error calling generate-cards:', generateError);
    }

    // Update statuses to completed only after successful generation
    const finalDeckStatus = cardGenSuccess ? 'completed' : 'failed';
    console.log(`Setting deck status to: ${finalDeckStatus}`);
    
    await Promise.all([
      supabaseClient
        .from('sources')
        .update({ status: 'completed' })
        .eq('id', sourceId),
      supabaseClient
        .from('documents')
        .update({ status: 'completed' })
        .eq('id', document.id),
      supabaseClient
        .from('decks')
        .update({ status: finalDeckStatus })
        .eq('id', deck.id)
    ]);

    console.log('URL processing completed successfully');

    return new Response(
      JSON.stringify({
        success: true,
        documentId: document.id,
        chunksCount: insertedChunks.length,
        deckId: deck.id,
        cardGenerationSuccess: cardGenSuccess
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error processing URL:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});