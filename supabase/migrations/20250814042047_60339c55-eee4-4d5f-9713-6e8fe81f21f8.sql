-- Create deck_documents junction table
CREATE TABLE public.deck_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  deck_id UUID NOT NULL,
  document_id UUID NOT NULL,
  user_id UUID NOT NULL,
  added_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(deck_id, document_id)
);

-- Enable RLS
ALTER TABLE public.deck_documents ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Service role can manage all deck_documents"
ON public.deck_documents FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Users can manage their own deck_documents"
ON public.deck_documents FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);