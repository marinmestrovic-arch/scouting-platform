import React, { useEffect, useState } from "react";
import {
  Alert,
  Flex,
  Link,
  LoadingSpinner,
  Text,
  hubspot,
} from "@hubspot/ui-extensions";

const CONTEXT_ENDPOINT =
  "https://scouting.example.com/api/integrations/hubspot/extension/context";

hubspot.extend(({ context }) => <ScoutingContextCard context={context} />);

function formatMetric(value) {
  return value ?? "Not available";
}

function ScoutingContextCard({ context }) {
  const [state, setState] = useState({ status: "loading", data: null, error: null });

  useEffect(() => {
    let active = true;

    async function loadContext() {
      const objectId = context?.crm?.objectId;
      const objectType = context?.crm?.objectTypeId;

      if (!objectId || !objectType) {
        throw new Error("HubSpot did not supply CRM record context.");
      }

      const url = new URL(CONTEXT_ENDPOINT);
      url.searchParams.set("objectId", String(objectId));
      url.searchParams.set("objectType", String(objectType));

      const response = await hubspot.fetch(url.toString(), {
        method: "GET",
        timeout: 10_000,
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Unable to load Scouting Platform context.");
      }

      if (active) {
        setState({ status: "ready", data: payload, error: null });
      }
    }

    loadContext().catch((error) => {
      if (active) {
        setState({
          status: "error",
          data: null,
          error: error instanceof Error ? error.message : "Unable to load context.",
        });
      }
    });

    return () => {
      active = false;
    };
  }, [context?.crm?.objectId, context?.crm?.objectTypeId]);

  if (state.status === "loading") {
    return <LoadingSpinner label="Loading Scouting Platform context" />;
  }

  if (state.status === "error") {
    return <Alert title="Scouting Platform unavailable">{state.error}</Alert>;
  }

  const { creator, run, sync } = state.data;

  if (!creator && !run) {
    return (
      <Flex direction="column" gap="small">
        <Text>No linked Scouting Platform record was found.</Text>
        <Text>Sync the creator or run from Scouting Platform, then refresh this card.</Text>
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="medium">
      {creator ? (
        <Flex direction="column" gap="extra-small">
          <Text format={{ fontWeight: "bold" }}>{creator.name}</Text>
          <Text>{creator.handle || "No social handle"}</Text>
          <Text>Followers: {formatMetric(creator.followers)}</Text>
          <Text>Average views: {formatMetric(creator.averageViews)}</Text>
          <Text>
            Engagement: {creator.engagementRate === null ? "Not available" : `${creator.engagementRate}%`}
          </Text>
          {creator.platformUrl ? (
            <Link href={creator.platformUrl}>Open creator in Scouting Platform</Link>
          ) : null}
        </Flex>
      ) : null}

      {run ? (
        <Flex direction="column" gap="extra-small">
          <Text format={{ fontWeight: "bold" }}>{run.name}</Text>
          <Text>{run.campaignName || "No campaign name"}</Text>
          <Text>{run.assessmentSummary || "No assessment summary available"}</Text>
          <Link href={run.platformUrl}>Open run in Scouting Platform</Link>
        </Flex>
      ) : null}

      <Flex direction="column" gap="extra-small">
        <Text format={{ fontWeight: "bold" }}>Synchronization</Text>
        <Text>Status: {sync.status}</Text>
        <Text>Last success: {sync.lastSuccessfulSyncAt || "Not yet synchronized"}</Text>
      </Flex>
    </Flex>
  );
}
