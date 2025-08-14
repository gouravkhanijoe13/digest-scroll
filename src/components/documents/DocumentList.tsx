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
      
      // Get live card counts via deck relationships
      const documentsWithCards = await Promise.all(
        (data || []).map(async (doc) => {
          try {
            // First get deck IDs for this document
            const { data: deckIds } = await supabase
              .from('deck_documents')
              .select('deck_id')
              .eq('document_id', doc.id)
              .eq('user_id', user?.id);
              
            if (!deckIds || deckIds.length === 0) {
              return { ...doc, cards: [] };
            }
            
            // Then count cards in those decks
            const { count: cardCount } = await supabase
              .from('deck_cards')
              .select('*', { count: 'exact', head: true })
              .eq('user_id', user?.id)
              .in('deck_id', deckIds.map(d => d.deck_id));
            
            return {
              ...doc,
              cards: Array(cardCount || 0).fill({ id: '' })
            };
          } catch {
            // Fallback: no cards found
            return {
              ...doc,
              cards: []
            };
          }
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
      // Find existing deck for this document
      const { data: existingDecks } = await supabase
        .from('deck_documents')
        .select('deck_id')
        .eq('document_id', documentId)
        .eq('user_id', user?.id)
        .limit(1);

      if (existingDecks && existingDecks.length > 0) {
        // Navigate to existing deck
        window.location.href = `/study/${existingDecks[0].deck_id}`;
        return;
      }

      // If no deck exists, the card generation should have been triggered by process-pdf
      toast({
        title: "Processing...",
        description: "Cards are still being generated. Please wait a moment and refresh.",
        variant: "default",
      });

    } catch (error: any) {
      toast({
        title: "Failed to access deck",
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