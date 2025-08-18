-- Add foreign key constraints for deck_documents table
-- This will enable PostgREST joins in the future

-- Add foreign key for deck_id
ALTER TABLE public.deck_documents 
ADD CONSTRAINT fk_deck_documents_deck_id 
FOREIGN KEY (deck_id) REFERENCES public.decks(id) ON DELETE CASCADE;

-- Add foreign key for document_id
ALTER TABLE public.deck_documents 
ADD CONSTRAINT fk_deck_documents_document_id 
FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_deck_documents_deck_id ON public.deck_documents(deck_id);
CREATE INDEX IF NOT EXISTS idx_deck_documents_document_id ON public.deck_documents(document_id);
