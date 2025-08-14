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

    const { query, userId, limit = 10 } = await req.json();
    if (!query || !userId) {
      throw new Error('Query and user ID are required');
    }

    console.log('Performing semantic search for:', query);

    // Generate embedding for the search query
    const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: query,
      }),
    });

    const embeddingData = await embeddingResponse.json();
    const queryEmbedding = embeddingData.data[0].embedding;

    // Perform vector similarity search using pgvector
    const { data: searchResults, error: searchError } = await supabaseClient.rpc(
      'semantic_search',
      {
        query_embedding: queryEmbedding,
        user_id: userId,
        similarity_threshold: 0.5,
        match_count: limit
      }
    );

    if (searchError) {
      console.error('Search error:', searchError);
      throw new Error('Search failed');
    }

    // Get related chunks and cards
    const chunkIds = searchResults.map(r => r.chunk_id);
    
    const { data: chunks, error: chunksError } = await supabaseClient
      .from('chunks')
      .select(`
        *,
        cards(*),
        documents(
          title,
          sources(title, content_type)
        )
      `)
      .in('id', chunkIds)
      .eq('user_id', userId);

    if (chunksError) {
      throw new Error('Failed to fetch related content');
    }

    // Format results
    const results = searchResults.map(result => {
      const chunk = chunks.find(c => c.id === result.chunk_id);
      return {
        similarity: result.similarity,
        chunk: chunk,
        cards: chunk?.cards || [],
        document: chunk?.documents
      };
    }).filter(r => r.chunk);

    console.log('Semantic search completed, found', results.length, 'results');

    return new Response(
      JSON.stringify({
        success: true,
        results: results,
        query: query
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in semantic search:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});