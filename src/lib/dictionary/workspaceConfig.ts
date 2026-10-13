/**
 * The workspace configuration with the framework's "Data & Tools" rail switched off in every tier. The rail renders a
 * dictionary panel that parses the classic node-keyed shape, so it cannot show the DDv2 dictionary; the native
 * dictionary is offered as a drawer instead. Returns a copy; the input is not modified.
 */
export function withoutFrameworkDictionary<T extends { tierConfiguration?: Record<string, object> }>(configuration: T): T {
  const tiers = configuration.tierConfiguration ?? {};
  const next = Object.fromEntries(
    Object.entries(tiers).map(([name, tier]) => [name, { ...tier, dataAndTools: { ...(tier as { dataAndTools?: object }).dataAndTools, enabled: false } }]),
  );
  return { ...configuration, tierConfiguration: next };
}
