import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const InitialTime = createContext<number | null>(null);
/** Share only the first render's clock. Later route mounts use their own time. */
export function InitialTimeProvider({
  at,
  children,
}: {
  at: number;
  children: ReactNode;
}) {
  const [initial, setInitial] = useState<number | null>(at);
  useEffect(() => setInitial(null), []);
  return (
    <InitialTime.Provider value={initial}>{children}</InitialTime.Provider>
  );
}
export function useInitialTime() {
  const initial = useContext(InitialTime);
  return useState(() => initial ?? Date.now());
}
