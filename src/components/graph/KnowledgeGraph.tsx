import { useEffect, useRef, useState } from 'react';
// import ForceGraph2D from 'react-force-graph-2d';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, ZoomIn, ZoomOut, RotateCcw, Brain } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface GraphNode {
  id: string;
  name: string;
  group: number;
  size: number;
  color: string;
  type: 'card' | 'document' | 'chunk';
  x?: number;
  y?: number;
  data?: any;
}

interface GraphLink {
  source: string;
  target: string;
  strength: number;
  type: string;
}

interface KnowledgeGraphProps {
  deckId?: string;
}

export const KnowledgeGraph = ({ deckId }: KnowledgeGraphProps) => {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const graphRef = useRef<any>();
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      loadGraphData();
    }
  }, [user, deckId]);

  const loadGraphData = async () => {
    try {
      setLoading(true);

      // Load cards with their relationships
      let cardsQuery = supabase
        .from('cards')
        .select(`
          id,
          front_text,
          back_text,
          difficulty,
          chunks!inner(
            id,
            content,
            documents!inner(
              id,
              title,
              sources!inner(title, content_type)
            )
          )
        `)
        .eq('user_id', user?.id);

      if (deckId) {
        cardsQuery = cardsQuery.in('id', 
          await supabase
            .from('deck_cards')
            .select('card_id')
            .eq('deck_id', deckId)
            .then(({ data }) => data?.map(dc => dc.card_id) || [])
        );
      }

      const { data: cards, error: cardsError } = await cardsQuery;
      if (cardsError) throw cardsError;

      // Load branches (relationships between cards)
      const { data: branches, error: branchesError } = await supabase
        .from('branches')
        .select('*')
        .eq('user_id', user?.id);

      if (branchesError) throw branchesError;

      // Create nodes
      const graphNodes: GraphNode[] = [];
      const graphLinks: GraphLink[] = [];

      // Document nodes
      const documentMap = new Map();
      cards?.forEach(card => {
        const doc = card.chunks.documents;
        if (!documentMap.has(doc.id)) {
          documentMap.set(doc.id, doc);
          graphNodes.push({
            id: `doc-${doc.id}`,
            name: doc.title,
            group: 1,
            size: 15,
            color: '#8B5CF6',
            type: 'document',
            data: doc
          });
        }
      });

      // Card nodes
      cards?.forEach(card => {
        graphNodes.push({
          id: `card-${card.id}`,
          name: card.front_text.substring(0, 50) + (card.front_text.length > 50 ? '...' : ''),
          group: 2,
          size: 8,
          color: getDifficultyColor(card.difficulty),
          type: 'card',
          data: card
        });

        // Link cards to their documents
        graphLinks.push({
          source: `doc-${card.chunks.documents.id}`,
          target: `card-${card.id}`,
          strength: 1,
          type: 'contains'
        });
      });

      // Branch relationships
      branches?.forEach(branch => {
        graphLinks.push({
          source: `card-${branch.from_card_id}`,
          target: `card-${branch.to_card_id}`,
          strength: branch.strength || 1,
          type: branch.edge_type || 'related'
        });
      });

      setNodes(graphNodes);
      setLinks(graphLinks);

    } catch (error: any) {
      toast({
        title: "Failed to load graph data",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'easy': return '#10B981';
      case 'medium': return '#F59E0B';
      case 'hard': return '#EF4444';
      default: return '#6B7280';
    }
  };

  const handleNodeClick = (node: GraphNode) => {
    setSelectedNode(node);
  };

  const handleSearch = () => {
    if (!searchTerm.trim()) return;

    const matchingNode = nodes.find(node =>
      node.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (matchingNode && graphRef.current) {
      // Focus on the matching node
      graphRef.current.centerAt(matchingNode.x, matchingNode.y, 1000);
      graphRef.current.zoom(2, 1000);
      setSelectedNode(matchingNode);
    } else {
      toast({
        title: "No results found",
        description: "No nodes match your search term.",
        variant: "destructive",
      });
    }
  };

  const resetView = () => {
    if (graphRef.current) {
      graphRef.current.zoomToFit(400);
    }
    setSelectedNode(null);
  };

  const zoomIn = () => {
    if (graphRef.current) {
      graphRef.current.zoom(graphRef.current.zoom() * 1.5, 200);
    }
  };

  const zoomOut = () => {
    if (graphRef.current) {
      graphRef.current.zoom(graphRef.current.zoom() / 1.5, 200);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Input
            placeholder="Search nodes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            className="w-64"
          />
          <Button onClick={handleSearch} size="sm">
            <Search className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center space-x-2">
          <Button onClick={zoomIn} variant="outline" size="sm">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button onClick={zoomOut} variant="outline" size="sm">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button onClick={resetView} variant="outline" size="sm">
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Graph */}
        <div className="lg:col-span-3">
          <Card>
            <CardContent className="p-0">
              <div style={{ height: '600px', width: '100%' }} className="flex items-center justify-center border-2 border-dashed border-muted rounded-lg">
                <div className="text-center text-muted-foreground">
                  <Brain className="h-12 w-12 mx-auto mb-4" />
                  <p>Knowledge Graph visualization will be available once react-force-graph is properly configured</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Selected Node Details */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Node Details</CardTitle>
            </CardHeader>
            <CardContent>
              {selectedNode ? (
                <div className="space-y-3">
                  <div>
                    <span className="text-sm font-medium">Type:</span>
                    <p className="text-sm text-muted-foreground capitalize">{selectedNode.type}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium">Name:</span>
                    <p className="text-sm text-muted-foreground">{selectedNode.name}</p>
                  </div>
                  {selectedNode.type === 'card' && selectedNode.data && (
                    <>
                      <div>
                        <span className="text-sm font-medium">Answer:</span>
                        <p className="text-sm text-muted-foreground">{selectedNode.data.back_text}</p>
                      </div>
                      <div>
                        <span className="text-sm font-medium">Difficulty:</span>
                        <p className="text-sm text-muted-foreground capitalize">{selectedNode.data.difficulty}</p>
                      </div>
                    </>
                  )}
                  {selectedNode.type === 'document' && selectedNode.data && (
                    <div>
                      <span className="text-sm font-medium">Source:</span>
                      <p className="text-sm text-muted-foreground">{selectedNode.data.sources?.title}</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Click on a node to see details</p>
              )}
            </CardContent>
          </Card>

          {/* Legend */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Legend</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 rounded-full bg-purple-500"></div>
                <span className="text-sm">Documents</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 rounded-full bg-green-500"></div>
                <span className="text-sm">Easy Cards</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                <span className="text-sm">Medium Cards</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                <span className="text-sm">Hard Cards</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};