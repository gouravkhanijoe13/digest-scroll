import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileText, Link as LinkIcon, Trash2, Play } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface Document {
  id: string;
  title: string;
  status: string;
  created_at: string;
  sources: {
    content_type: string;
    url?: string;
    file_size?: number;
  };
  cards: Array<{ id: string }>;
}

interface DocumentListProps {
  onCreateDeck?: (documentId: string) => void;
}

export const DocumentList = ({ onCreateDeck }: DocumentListProps) => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      fetchDocuments();
    }
  }, [user]);

  const getChunkIds = async (documentId: string): Promise<string[]> => {
    const { data } = await supabase
      .from('chunks')
      .select('id')
      .eq('document_id', documentId);
    return data?.map(c => c.id) || [];
  };

  const fetchDocuments = async () => {
    try {
      const { data, error } = await supabase
        .from('documents')
        .select(`
          id,
          title,
          status,
          created_at,
          sources!inner (
            content_type,
            url,
            file_size
          )
        `)
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Get card counts separately
      const documentsWithCards = await Promise.all(
        (data || []).map(async (doc) => {
          const { count } = await supabase
            .from('cards')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user?.id)
            .in('chunk_id', await getChunkIds(doc.id));
          
          return {
            ...doc,
            cards: Array(count || 0).fill({ id: '' })
          };
        })
      );
      
      setDocuments(documentsWithCards);
    } catch (error: any) {
      toast({
        title: "Failed to load documents",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const createDeck = async (documentId: string) => {
    try {
      // Create a deck for this document
      const { data: deck, error: deckError } = await supabase
        .from('decks')
        .insert({
          user_id: user?.id,
          title: `Learning Deck - ${documents.find(d => d.id === documentId)?.title}`,
          description: 'Auto-generated learning deck',
          status: 'pending'
        })
        .select()
        .single();

      if (deckError) throw deckError;

      // Link deck to document
      await supabase
        .from('deck_documents')
        .insert({
          deck_id: deck.id,
          document_id: documentId,
          user_id: user?.id
        });

      // Generate cards for the deck
      const { error: generateError } = await supabase.functions.invoke('generate-cards', {
        body: { deckId: deck.id }
      });

      if (generateError) throw generateError;

      toast({
        title: "Deck created",
        description: "Your learning deck is being generated in the background.",
      });

      // Navigate to study page
      window.location.href = `/study/${deck.id}`;

    } catch (error: any) {
      toast({
        title: "Failed to create deck",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const deleteDocument = async (documentId: string) => {
    try {
      const { error } = await supabase
        .from('documents')
        .delete()
        .eq('id', documentId);

      if (error) throw error;

      setDocuments(docs => docs.filter(doc => doc.id !== documentId));
      toast({
        title: "Document deleted",
        description: "The document and all its cards have been removed.",
      });
    } catch (error: any) {
      toast({
        title: "Failed to delete document",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-500';
      case 'processing': return 'bg-yellow-500';
      case 'failed': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader>
              <div className="h-4 bg-muted rounded w-3/4"></div>
              <div className="h-3 bg-muted rounded w-1/2"></div>
            </CardHeader>
          </Card>
        ))}
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-center">
          <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No documents yet</h3>
          <p className="text-muted-foreground">
            Upload a PDF or add a URL to get started with creating learning cards.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {documents.map((doc) => (
        <Card key={doc.id}>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-3">
                <div className="p-2 bg-primary/10 rounded">
                  {doc.sources.content_type === 'url' ? (
                    <LinkIcon className="h-4 w-4 text-primary" />
                  ) : (
                    <FileText className="h-4 w-4 text-primary" />
                  )}
                </div>
                <div>
                  <CardTitle className="text-base">{doc.title}</CardTitle>
                  <CardDescription>
                    {doc.sources.content_type === 'url' 
                      ? doc.sources.url 
                      : `PDF • ${formatFileSize(doc.sources.file_size)}`
                    }
                  </CardDescription>
                  <div className="flex items-center space-x-2 mt-2">
                    <Badge 
                      variant="secondary" 
                      className={`${getStatusColor(doc.status)} text-white`}
                    >
                      {doc.status}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {doc.cards.length} cards
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {doc.status === 'completed' && doc.cards.length > 0 && (
                  <Button
                    size="sm"
                    onClick={() => createDeck(doc.id)}
                  >
                    <Play className="h-4 w-4 mr-1" />
                    Study
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => deleteDocument(doc.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
};