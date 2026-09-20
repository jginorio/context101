/**
 * Which connector trees appear under Knowledge → Sources.
 *
 * Hide-empty (#29) only looked at folders from one `sources/` listing.
 * That drops Google Docs when the KB has the file and the connector is
 * CONNECTED (item_count > 0) but `sources/` has no `docs/` CommonPrefix
 * — the Platea Analytics case: retrieve ranks
 * `sources/docs/<slug>/content.md` while the sidebar showed only GitHub.
 *
 * Compact-folders (#30) is unrelated: it joins paths *inside* an opened
 * repo, not which type headers render.
 */

import {
  CONNECTOR_TYPES,
  isConnectorType,
  type ConnectorType,
} from "@/lib/connectors/contract";
import { PROVIDER_GROUPS, type ProviderGroup } from "@/lib/source-providers";

export type SourceConnectorHint = {
  type: string;
  status?: string | null;
  item_count?: number | null;
};

/** True when the connector row says a sync wrote content. */
export function connectorHasSyncedContent(
  connector: SourceConnectorHint
): boolean {
  return (connector.item_count ?? 0) > 0;
}

/**
 * Types to render in the Sources tree.
 *
 * A type is visible when `sources/<type>/` exists **or** a connector of
 * that type has `item_count > 0`. Pending / empty connectors stay hidden.
 */
export function visibleConnectorTypes(opts: {
  sourceFolders: Iterable<string>;
  connectors?: Iterable<SourceConnectorHint> | null;
}): ConnectorType[] {
  const visible = new Set<string>();
  for (const name of opts.sourceFolders) {
    if (isConnectorType(name)) visible.add(name);
  }
  for (const connector of opts.connectors ?? []) {
    if (
      isConnectorType(connector.type) &&
      connectorHasSyncedContent(connector)
    ) {
      visible.add(connector.type);
    }
  }
  return CONNECTOR_TYPES.filter((type) => visible.has(type));
}

export type VisibleProviderGroup = ProviderGroup & { types: ConnectorType[] };

/** Provider sections that have at least one visible type (Google fans out). */
export function visibleProviderGroups(
  types: readonly ConnectorType[]
): VisibleProviderGroup[] {
  const set = new Set(types);
  return PROVIDER_GROUPS.map((group) => ({
    ...group,
    types: group.types.filter((type) => set.has(type)),
  })).filter((group) => group.types.length > 0);
}
