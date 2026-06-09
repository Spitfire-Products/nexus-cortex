/**
 * Extension types for Nexus Cortex CLI
 */

export interface ExtensionUpdateInfo {
  id: string;
  name: string;
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  changelog?: string;
}
