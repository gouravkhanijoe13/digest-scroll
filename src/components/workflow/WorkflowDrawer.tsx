import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useWorkflow } from '@/contexts/WorkflowContext';
import { WorkflowProgress } from './WorkflowProgress';

export const WorkflowDrawer = () => {
  const { isOpen, activeSourceId, close } = useWorkflow();

  return (
    <Drawer open={isOpen} onOpenChange={(o) => !o && close()}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Processing Workflow</DrawerTitle>
        </DrawerHeader>
        {activeSourceId && (
          <div className="p-4">
            <WorkflowProgress sourceId={activeSourceId} />
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
};
