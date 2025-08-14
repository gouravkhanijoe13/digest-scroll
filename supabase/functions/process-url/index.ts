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

    // Fetch URL content
    const urlResponse = await fetch(source.url);
    if (!urlResponse.ok) {
      throw new Error(`Failed to fetch URL: ${urlResponse.statusText}`);
    }

    const htmlContent = await urlResponse.text();
    
    // Simple text extraction (remove HTML tags)
    const extractedText = htmlContent
      .replace(/<script[^>]*>.*?<\/script>/gis, '')
      .replace(/<style[^>]*>.*?<\/style>/gis, '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Create document
    const { data: document, error: docError } = await supabaseClient
      .from('documents')
      .insert({
        source_id: sourceId,
        user_id: source.user_id,
        title: source.title,
        extracted_text: extractedText,
        token_count: Math.ceil(extractedText.length / 4),
        status: 'processing'
      })
      .select()
      .single();

    if (docError || !document) {
      throw new Error('Failed to create document');
    }

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

    // Update statuses to completed
    await Promise.all([
      supabaseClient
        .from('sources')
        .update({ status: 'completed' })
        .eq('id', sourceId),
      supabaseClient
        .from('documents')
        .update({ status: 'completed' })
        .eq('id', document.id)
    ]);

    console.log('URL processing completed successfully');

    return new Response(
      JSON.stringify({
        success: true,
        documentId: document.id,
        chunksCount: insertedChunks.length
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