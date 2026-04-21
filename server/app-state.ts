/**
 * Shared boot-readiness flag — readable by route handlers without importing server/index.ts.
 */
export let appReady = false;
export function setAppReady(): void {
  appReady = true;
}
