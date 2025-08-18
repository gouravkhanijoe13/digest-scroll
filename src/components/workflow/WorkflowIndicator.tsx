import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';
import { useWorkflow } from '@/contexts/WorkflowContext';

export const WorkflowIndicator = () => {
  const [count, setCount] = useState(0);
  const [lastSourceId, setLastSourceId] = useState<string | null>(null);
  const { open } = useWorkflow();

  useEffect(() => {
    let isMounted = true;

    const fetchActive = async () => {
      const { data } = await supabase
        .from('sources')
        .select('id')
        .in('status', ['pending', 'processing']);
      if (!isMounted) return;
      setCount(data?.length || 0);
      if (data && data.length > 0) setLastSourceId(data[0].id);
    };

    fetchActive();

    const channel = supabase
      .channel('public:sources')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sources' }, () => {
        fetchActive();
      })
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  if (count === 0) return null;

  return (
    <Button variant="outline" size="sm" onClick={() => lastSourceId && open(lastSourceId)}>
      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      Processing {count}
    </Button>
  );
};
