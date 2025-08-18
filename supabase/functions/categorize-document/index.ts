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

    const { documentId } = await req.json();
    if (!documentId) {
      throw new Error('Document ID is required');
    }

    console.log('Categorizing document:', documentId);

    // Get document content
    const { data: document, error: docError } = await supabaseClient
      .from('documents')
      .select('id, title, extracted_text, user_id')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      throw new Error('Document not found');
    }

    // Analyze first 2000 characters for categorization
    const sampleText = document.extracted_text?.substring(0, 2000) || document.title;

    // Call OpenAI for categorization
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
            content: `Categorize this document content into one of these categories and return ONLY the category name:
            - technical_document (programming, engineering, technical guides)
            - research_paper (academic papers, scientific studies)
            - book_chapter (book content, literature)
            - blog_article (articles, posts, news)
            - educational_content (tutorials, courses, learning materials)
            - motivational_content (self-help, inspirational content)
            - business_document (reports, proposals, business content)
            - reference_material (manuals, documentation)
            
            Analyze the writing style, content structure, and subject matter to determine the most appropriate category.`
          },
          {
            role: 'user',
            content: `Title: ${document.title}\n\nContent:\n${sampleText}`
          }
        ],
        temperature: 0.1,
        max_tokens: 50
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to categorize document');
    }

    const data = await response.json();
    const category = data.choices[0]?.message?.content?.trim().toLowerCase() || 'educational_content';

    console.log('Document categorized as:', category);

    // Update document with category metadata
    await supabaseClient
      .from('documents')
      .update({
        metadata: { category, analyzed_at: new Date().toISOString() }
      })
      .eq('id', documentId);

    // Also update the source metadata
    const { data: source } = await supabaseClient
      .from('sources')
      .select('id')
      .eq('user_id', document.user_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (source) {
      await supabaseClient
        .from('sources')
        .update({
          metadata: { category, categorized_at: new Date().toISOString() }
        })
        .eq('id', source.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        category,
        documentId
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error categorizing document:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});