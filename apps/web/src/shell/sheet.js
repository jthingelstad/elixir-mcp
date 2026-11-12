import { createContext, useContext } from "react";

/**
 * The shell's sheets (search, help, the bell), opened from inside a page: Find
 * opens the same search sheet the bar does. `open(name)` takes "search",
 * "help" or "bell"; outside the shell it does nothing.
 */
export const SheetContext = createContext(() => {});

export const useSheet = () => useContext(SheetContext);
