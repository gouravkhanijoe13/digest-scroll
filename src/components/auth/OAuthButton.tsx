import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';

interface OAuthButtonProps {
  provider: 'google' | 'github';
  children: React.ReactNode;
  className?: string;
}

export const OAuthButton = ({ provider, children, className }: OAuthButtonProps) => {
  const [loading, setLoading] = useState(false);
  const { signInWithOAuth } = useAuth();

  const handleOAuthSignIn = async () => {
    setLoading(true);
    await signInWithOAuth(provider);
    setLoading(false);
  };

  return (
    <Button
      type="button"
      variant="outline"
      className={className}
      onClick={handleOAuthSignIn}
      disabled={loading}
    >
      {loading ? 'Connecting...' : children}
    </Button>
  );
};