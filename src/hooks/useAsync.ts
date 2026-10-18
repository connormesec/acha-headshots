import { useCallback, useEffect, useRef, useState } from "react";

interface AsyncState<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  reload: () => Promise<void>;
}

/** Load data once, and again when `deps` change. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(async () => {
    try {
      setData(await loaderRef.current());
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loaderRef.current().then(
      (d) => { if (!cancelled) { setData(d); setError(undefined); setLoading(false); } },
      (e) => { if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); } },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, reload };
}
