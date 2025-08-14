-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions";

-- Create enum types
CREATE TYPE content_type AS ENUM ('pdf', 'html', 'markdown', 'txt', 'url');
CREATE TYPE processing_status AS ENUM ('pending', 'processing', 'completed', 'failed');
CREATE TYPE card_difficulty AS ENUM ('easy', 'medium', 'hard');
CREATE TYPE edge_type AS ENUM ('related', 'follows', 'contradicts', 'elaborates');

-- Sources table: User uploads and URLs
CREATE TABLE sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content_type content_type NOT NULL,
    file_path TEXT, -- for uploaded files
    url TEXT, -- for URLs
    file_size BIGINT, -- in bytes
    status processing_status DEFAULT 'pending',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    CONSTRAINT sources_file_or_url CHECK (
        (file_path IS NOT NULL AND url IS NULL) OR 
        (file_path IS NULL AND url IS NOT NULL)
    )
);

-- Documents table: Processed content from sources
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT,
    extracted_text TEXT,
    token_count INTEGER,
    status processing_status DEFAULT 'pending',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Chunks table: Text segments with token information
CREATE TABLE chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    token_count INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL,
    start_char INTEGER,
    end_char INTEGER,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(document_id, chunk_index)
);

-- Embeddings table: Vector storage for chunks
CREATE TABLE embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    chunk_id UUID NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    embedding vector(1536) NOT NULL, -- OpenAI text-embedding-3-small dimensions
    model_used TEXT DEFAULT 'text-embedding-3-small',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(chunk_id)
);

-- Decks table: Collections of cards for studying
CREATE TABLE decks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    status processing_status DEFAULT 'pending',
    settings JSONB DEFAULT '{"chunking": {"token_size": 350, "overlap": 60}}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Cards table: Study cards generated from chunks
CREATE TABLE cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    chunk_id UUID NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    front_text TEXT NOT NULL, -- First line of card
    back_text TEXT NOT NULL, -- Second line of card
    difficulty card_difficulty DEFAULT 'medium',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    CONSTRAINT cards_two_lines_front CHECK (array_length(string_to_array(front_text, E'\n'), 1) <= 2),
    CONSTRAINT cards_two_lines_back CHECK (array_length(string_to_array(back_text, E'\n'), 1) <= 2)
);

-- Deck cards table: Many-to-many relationship between decks and cards
CREATE TABLE deck_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    deck_id UUID NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(deck_id, card_id),
    UNIQUE(deck_id, position)
);

-- Branches table: Graph relationships between cards
CREATE TABLE branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    from_card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    to_card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    edge_type edge_type DEFAULT 'related',
    strength DECIMAL(3,2) DEFAULT 1.0 CHECK (strength >= 0.0 AND strength <= 1.0),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(from_card_id, to_card_id, edge_type),
    CONSTRAINT no_self_reference CHECK (from_card_id != to_card_id)
);

-- User progress table: Learning tracking and spaced repetition
CREATE TABLE user_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    reviews INTEGER DEFAULT 0,
    correct_count INTEGER DEFAULT 0,
    last_reviewed TIMESTAMP WITH TIME ZONE,
    next_review TIMESTAMP WITH TIME ZONE,
    ease_factor DECIMAL(3,2) DEFAULT 2.5 CHECK (ease_factor >= 1.3),
    interval_days INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(user_id, card_id)
);

-- Create indexes for performance
CREATE INDEX idx_sources_user_id ON sources(user_id);
CREATE INDEX idx_sources_status ON sources(status);
CREATE INDEX idx_documents_user_id ON documents(user_id);
CREATE INDEX idx_documents_source_id ON documents(source_id);
CREATE INDEX idx_chunks_user_id ON chunks(user_id);
CREATE INDEX idx_chunks_document_id ON chunks(document_id);
CREATE INDEX idx_embeddings_user_id ON embeddings(user_id);
CREATE INDEX idx_embeddings_vector ON embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_decks_user_id ON decks(user_id);
CREATE INDEX idx_cards_user_id ON cards(user_id);
CREATE INDEX idx_cards_chunk_id ON cards(chunk_id);
CREATE INDEX idx_deck_cards_user_id ON deck_cards(user_id);
CREATE INDEX idx_deck_cards_deck_id ON deck_cards(deck_id);
CREATE INDEX idx_deck_cards_card_id ON deck_cards(card_id);
CREATE INDEX idx_branches_user_id ON branches(user_id);
CREATE INDEX idx_branches_from_card ON branches(from_card_id);
CREATE INDEX idx_branches_to_card ON branches(to_card_id);
CREATE INDEX idx_user_progress_user_id ON user_progress(user_id);
CREATE INDEX idx_user_progress_card_id ON user_progress(card_id);
CREATE INDEX idx_user_progress_next_review ON user_progress(next_review);

-- Enable RLS on all tables
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE deck_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_progress ENABLE ROW LEVEL SECURITY;

-- RLS policies for authenticated users
CREATE POLICY "Users can manage their own sources" ON sources FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage their own documents" ON documents FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage their own chunks" ON chunks FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage their own embeddings" ON embeddings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage their own decks" ON decks FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage their own cards" ON cards FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage their own deck_cards" ON deck_cards FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage their own branches" ON branches FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage their own progress" ON user_progress FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Service role bypass policies for Edge Functions
CREATE POLICY "Service role can manage all sources" ON sources FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role can manage all documents" ON documents FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role can manage all chunks" ON chunks FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role can manage all embeddings" ON embeddings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role can manage all decks" ON decks FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role can manage all cards" ON cards FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role can manage all deck_cards" ON deck_cards FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role can manage all branches" ON branches FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role can manage all user_progress" ON user_progress FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Updated at triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_sources_updated_at BEFORE UPDATE ON sources FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_documents_updated_at BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_decks_updated_at BEFORE UPDATE ON decks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_cards_updated_at BEFORE UPDATE ON cards FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_user_progress_updated_at BEFORE UPDATE ON user_progress FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create storage bucket for source files
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'sources', 
    'sources', 
    false, 
    10485760, -- 10MB limit
    ARRAY['application/pdf']
);

-- Storage RLS policies
CREATE POLICY "Users can upload their own files" ON storage.objects
FOR INSERT WITH CHECK (
    bucket_id = 'sources' 
    AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can view their own files" ON storage.objects
FOR SELECT USING (
    bucket_id = 'sources' 
    AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can update their own files" ON storage.objects
FOR UPDATE USING (
    bucket_id = 'sources' 
    AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own files" ON storage.objects
FOR DELETE USING (
    bucket_id = 'sources' 
    AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Service role can manage all storage objects
CREATE POLICY "Service role can manage all storage objects" ON storage.objects
FOR ALL TO service_role USING (bucket_id = 'sources') WITH CHECK (bucket_id = 'sources');