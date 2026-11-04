import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import type { Engine, EngineEventOf, EngineEventType } from './types';

const EngineContext = createContext<Engine | null>(null);

export function EngineProvider({ engine, children }: { engine: Engine; children: ReactNode }) {
  return <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>;
}

/** The running scene engine. */
export function useEngine(): Engine {
  const engine = useContext(EngineContext);
  if (!engine) throw new Error('useEngine must be used inside EngineProvider');
  return engine;
}

/** Subscribe to one engine event type for the lifetime of the component. */
export function useEngineEvent<T extends EngineEventType>(type: T, cb: (e: EngineEventOf<T>) => void): void {
  const engine = useEngine();
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => engine.on(type, (e) => ref.current(e)), [engine, type]);
}
