// Test-only relocation at the real shell RPC seam.
export function relocateShellArtifacts(command, fixtureRoot) {
  // Relocate only the shipped transport's artifacts, never fixture payloads
  // whose absolute Linux paths may already start with /tmp/.
  return command.replace(/\/tmp\/(?=(?:ghprs\.|ghaggregate\.|gt\$\$\.sh))/g, `${fixtureRoot}/`)
}
