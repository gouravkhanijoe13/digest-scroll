import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Upload, FileText, Link as LinkIcon, X } from 'lucide-react';
import { useWorkflow } from '@/contexts/WorkflowContext';

interface FileUploadProps {
  onUploadComplete?: (sourceId: string) => void;
}

export const FileUpload = ({ onUploadComplete }: FileUploadProps) => {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [urlInput, setUrlInput] = useState('');
  const { user } = useAuth();
  const { start } = useWorkflow();

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (!user) return;

    const file = acceptedFiles[0];
    if (!file) return;

    // Check file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please upload a file smaller than 10MB",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    setProgress(0);

    try {
      // Upload file to storage
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(2)}.${fileExt}`;
      const filePath = `${user.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('sources')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      setProgress(60);

      // Create source record
      const { data: source, error: sourceError } = await supabase
        .from('sources')
        .insert({
          user_id: user.id,
          title: file.name.replace(/\.[^/.]+$/, ''), // Remove extension
          content_type: 'pdf',
          file_path: filePath,
          file_size: file.size,
          status: 'pending'
        })
        .select()
        .single();

      if (sourceError) throw sourceError;

      setProgress(80);

      // Process the PDF
      const { error: processError } = await supabase.functions.invoke('process-pdf', {
        body: { sourceId: source.id }
      });

      if (processError) throw processError;

      setProgress(100);

      toast({
        title: "Upload successful",
        description: "Your document is being analyzed and processed.",
      });

      start(source.id);
      onUploadComplete?.(source.id);

    } catch (error: any) {
      toast({
        title: "Upload failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }, [user, onUploadComplete]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf']
    },
    maxFiles: 1,
    disabled: uploading
  });

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !urlInput.trim()) return;

    setUploading(true);
    setProgress(0);

    try {
      // Validate URL
      const url = new URL(urlInput.trim());
      
      setProgress(20);

      // Create source record
      const { data: source, error: sourceError } = await supabase
        .from('sources')
        .insert({
          user_id: user.id,
          title: url.hostname + url.pathname,
          content_type: 'url',
          url: url.toString(),
          status: 'pending'
        })
        .select()
        .single();

      if (sourceError) throw sourceError;

      setProgress(50);

      // Process the URL
      const { error: processError } = await supabase.functions.invoke('process-url', {
        body: { sourceId: source.id }
      });

      if (processError) throw processError;

      setProgress(100);

      toast({
        title: "URL added successfully",
        description: "The content is being analyzed and processed.",
      });

      setUrlInput('');
      start(source.id);
      onUploadComplete?.(source.id);

    } catch (error: any) {
      toast({
        title: "Failed to process URL",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  return (
    <div className="space-y-6">
      {/* File Upload */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
          isDragActive
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-primary/50'
        } ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center space-y-4">
          <div className="p-4 bg-primary/10 rounded-full">
            <Upload className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Upload PDF</h3>
            <p className="text-muted-foreground">
              {isDragActive
                ? 'Drop your PDF here'
                : 'Drag & drop a PDF file here, or click to select'}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Maximum file size: 10MB
            </p>
          </div>
        </div>
      </div>

      {/* URL Input */}
      <div className="space-y-4">
        <div className="flex items-center space-x-2">
          <LinkIcon className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">Or add a URL</h3>
        </div>
        <form onSubmit={handleUrlSubmit} className="flex space-x-2">
          <Input
            placeholder="https://example.com/article"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            disabled={uploading}
            className="flex-1"
          />
          <Button type="submit" disabled={uploading || !urlInput.trim()}>
            Add URL
          </Button>
        </form>
      </div>

      {/* Progress */}
      {uploading && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span>Processing...</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} className="w-full" />
        </div>
      )}
    </div>
  );
};