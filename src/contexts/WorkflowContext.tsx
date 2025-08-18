import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface WorkflowContextValue {
  isOpen: boolean;
  activeSourceId: string | null;
  open: (sourceId: string) => void;
  close: () => void;
  start: (sourceId: string) => void;
}

const WorkflowContext = createContext<WorkflowContextValue | undefined>(undefined);

export const WorkflowProvider = ({ children }: { children: ReactNode }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);

  const open = useCallback((sourceId: string) => {
    setActiveSourceId(sourceId);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  const start = useCallback((sourceId: string) => {
    setActiveSourceId(sourceId);
    setIsOpen(true);
  }, []);

  return (
    <WorkflowContext.Provider value={{ isOpen, activeSourceId, open, close, start }}>
      {children}
    </WorkflowContext.Provider>
  );
};

export const useWorkflow = () => {
  const ctx = useContext(WorkflowContext);
  if (!ctx) throw new Error('useWorkflow must be used within WorkflowProvider');
  return ctx;
};
