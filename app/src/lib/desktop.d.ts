// The Electron preload script (electron/preload.cjs) adds `window.ssbills`.
// It is undefined when the UI runs in a plain browser (`npm run dev`), where the app uses mock data.
export interface SsbillsApi {
  isDesktop: true;
  /** Calls a database method in the main process. Rejects with the database's error message. */
  call<T = unknown>(name: string, arg?: unknown): Promise<T>;
  /** Printing through the Windows printer driver (electron/print.cjs). */
  print<T = unknown>(name: "listPrinters" | "printHtml" | "savePdf", arg?: unknown): Promise<T>;
}

declare global {
  interface Window {
    ssbills?: SsbillsApi;
  }
}
