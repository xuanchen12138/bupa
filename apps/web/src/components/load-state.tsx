import { Button } from './ui/button';

export function LoadState({ error, retry }: { error?: Error | null; retry: () => void }) {
  if (!error)
    return (
      <p className="text-sm text-muted-foreground" role="status">
        正在读取演示数据…
      </p>
    );
  return (
    <div role="alert" className="rounded-xl border border-border bg-card p-6">
      <p className="mb-4">{error.message}</p>
      <Button variant="outline" onClick={retry}>
        重试
      </Button>
    </div>
  );
}
