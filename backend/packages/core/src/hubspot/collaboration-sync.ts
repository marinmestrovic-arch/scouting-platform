import { Prisma } from "@prisma/client";
import { prisma, type DbTransactionClient } from "@scouting-platform/db";
import {
  batchReadHubspotObjects,
  fetchHubspotAssociations,
  type HubspotObjectRecord,
} from "@scouting-platform/integrations";

import { ServiceError } from "../errors";

const DEAL_PROPERTIES = [
  "dealname",
  "amount",
  "deal_currency_code",
  "pipeline",
  "dealstage",
  "hubspot_owner_id",
  "closedate",
  "createdate",
] as const;

export type HubspotCollaborationSyncConfig = Readonly<{
  contactWorkedWithProperty: string;
  clientObjectType: string;
  campaignObjectType: string;
  activationObjectType: string;
  activationNameProperty: string;
  activationTypeProperty: string | null;
  activationUrlProperty: string | null;
  activationPublicationDateProperty: string | null;
}>;

type ContactLink = Readonly<{
  id: string;
  hubspotObjectId: string;
}>;

export type HubspotCollaborationSnapshot = Readonly<{
  contactLinks: readonly ContactLink[];
  contacts: readonly HubspotObjectRecord[];
  contactDealIds: ReadonlyMap<string, readonly string[]>;
  deals: readonly HubspotObjectRecord[];
  dealClientIds: ReadonlyMap<string, readonly string[]>;
  dealCampaignIds: ReadonlyMap<string, readonly string[]>;
  dealActivationIds: ReadonlyMap<string, readonly string[]>;
  activations: readonly HubspotObjectRecord[];
}>;

export type HubspotCollaborationSyncResult = Readonly<{
  dealMirrorUpsertCount: number;
  activationMirrorUpsertCount: number;
}>;

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function unique(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))];
}

function scalarProperty(record: HubspotObjectRecord, propertyName: string): string | null {
  const value = record.properties[propertyName];
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function parseHubspotDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const milliseconds = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date;
}

function observedAt(record: HubspotObjectRecord): Date | null {
  return parseHubspotDate(record.updatedAt)
    ?? parseHubspotDate(scalarProperty(record, "hs_lastmodifieddate"));
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function readJsonObject(value: Prisma.JsonValue | null): Prisma.JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Prisma.JsonObject
    : {};
}

async function batchReadAll(input: {
  objectType: string;
  recordIds: readonly string[];
  properties: readonly string[];
}): Promise<HubspotObjectRecord[]> {
  if (input.recordIds.length === 0) {
    return [];
  }

  const active = (
    await Promise.all(
      chunks(unique(input.recordIds), 100).map((recordIds) =>
        batchReadHubspotObjects({
          objectType: input.objectType,
          recordIds,
          properties: input.properties,
        })),
    )
  ).flat();
  const byId = new Map(active.map((record) => [record.id, record]));
  const missingIds = unique(input.recordIds).filter((recordId) => !byId.has(recordId));

  if (missingIds.length > 0) {
    const archived = (
      await Promise.all(
        chunks(missingIds, 100).map((recordIds) =>
          batchReadHubspotObjects({
            objectType: input.objectType,
            recordIds,
            properties: input.properties,
            archived: true,
          })),
      )
    ).flat();
    for (const record of archived) {
      byId.set(record.id, record);
    }
  }

  const unresolved = unique(input.recordIds).filter((recordId) => !byId.has(recordId));
  if (unresolved.length > 0) {
    throw new ServiceError(
      "HUBSPOT_COLLABORATION_RECORDS_INCOMPLETE",
      502,
      `HubSpot did not return ${unresolved.length} requested ${input.objectType} record${unresolved.length === 1 ? "" : "s"}`,
    );
  }

  return [...byId.values()];
}

async function readAssociations(input: {
  fromObjectType: string;
  toObjectType: string;
  objectIds: readonly string[];
}): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  const objectIds = unique(input.objectIds);
  for (const objectId of objectIds) {
    result.set(objectId, []);
  }
  for (const objectIdChunk of chunks(objectIds, 1_000)) {
    const page = await fetchHubspotAssociations({
      fromObjectType: input.fromObjectType,
      toObjectType: input.toObjectType,
      objectIds: objectIdChunk,
    });
    for (const objectId of objectIdChunk) {
      result.set(objectId, unique(page.get(objectId) ?? []));
    }
  }
  return result;
}

export async function loadHubspotCollaborationSnapshot(input: {
  hubspotPortalId: string;
  config: HubspotCollaborationSyncConfig;
}): Promise<HubspotCollaborationSnapshot> {
  const contactLinks = await prisma.hubspotContactLink.findMany({
    where: {
      hubspotPortalId: input.hubspotPortalId,
      archived: false,
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      hubspotObjectId: true,
    },
  });
  if (contactLinks.length === 0) {
    return {
      contactLinks,
      contacts: [],
      contactDealIds: new Map(),
      deals: [],
      dealClientIds: new Map(),
      dealCampaignIds: new Map(),
      dealActivationIds: new Map(),
      activations: [],
    };
  }

  const contactObjectIds = contactLinks.map((link) => link.hubspotObjectId);
  const [contacts, contactDealIds] = await Promise.all([
    batchReadAll({
      objectType: "contacts",
      recordIds: contactObjectIds,
      properties: [input.config.contactWorkedWithProperty],
    }),
    readAssociations({
      fromObjectType: "contacts",
      toObjectType: "deals",
      objectIds: contactObjectIds,
    }),
  ]);
  const dealIds = unique([...contactDealIds.values()].flat());
  if (dealIds.length === 0) {
    return {
      contactLinks,
      contacts,
      contactDealIds,
      deals: [],
      dealClientIds: new Map(),
      dealCampaignIds: new Map(),
      dealActivationIds: new Map(),
      activations: [],
    };
  }

  const [deals, dealClientIds, dealCampaignIds, dealActivationIds] = await Promise.all([
    batchReadAll({
      objectType: "deals",
      recordIds: dealIds,
      properties: DEAL_PROPERTIES,
    }),
    readAssociations({
      fromObjectType: "deals",
      toObjectType: input.config.clientObjectType,
      objectIds: dealIds,
    }),
    readAssociations({
      fromObjectType: "deals",
      toObjectType: input.config.campaignObjectType,
      objectIds: dealIds,
    }),
    readAssociations({
      fromObjectType: "deals",
      toObjectType: input.config.activationObjectType,
      objectIds: dealIds,
    }),
  ]);
  const activationIds = unique([...dealActivationIds.values()].flat());
  const activationProperties = unique([
    input.config.activationNameProperty,
    input.config.activationTypeProperty ?? "",
    input.config.activationUrlProperty ?? "",
    input.config.activationPublicationDateProperty ?? "",
  ]);
  const activations = await batchReadAll({
    objectType: input.config.activationObjectType,
    recordIds: activationIds,
    properties: activationProperties,
  });

  return {
    contactLinks,
    contacts,
    contactDealIds,
    deals,
    dealClientIds,
    dealCampaignIds,
    dealActivationIds,
    activations,
  };
}

export async function persistHubspotCollaborationSnapshot(input: {
  tx: DbTransactionClient;
  hubspotPortalId: string;
  config: HubspotCollaborationSyncConfig;
  snapshot: HubspotCollaborationSnapshot;
  observedAt: Date;
}): Promise<HubspotCollaborationSyncResult> {
  const contactsById = new Map(input.snapshot.contacts.map((record) => [record.id, record]));
  for (const contactLink of input.snapshot.contactLinks) {
    const contact = contactsById.get(contactLink.hubspotObjectId);
    if (!contact) {
      throw new ServiceError(
        "HUBSPOT_COLLABORATION_CONTACT_MISSING",
        502,
        `HubSpot contact ${contactLink.hubspotObjectId} was not returned during collaboration sync`,
      );
    }
    const existing = await input.tx.hubspotContactLink.findUnique({
      where: { id: contactLink.id },
      select: { mirrorProperties: true },
    });
    await input.tx.hubspotContactLink.update({
      where: { id: contactLink.id },
      data: {
        mirrorProperties: toJsonValue({
          ...readJsonObject(existing?.mirrorProperties ?? null),
          [input.config.contactWorkedWithProperty]: scalarProperty(
            contact,
            input.config.contactWorkedWithProperty,
          ),
        }),
        lastObservedHubspotUpdatedAt: observedAt(contact) ?? input.observedAt,
      },
    });
  }

  const dealMirrorIds = new Map<string, string>();
  for (const deal of input.snapshot.deals) {
    const dealName = scalarProperty(deal, "dealname") ?? `HubSpot deal ${deal.id}`;
    const mirror = await input.tx.hubspotDealMirror.upsert({
      where: {
        hubspotPortalId_hubspotObjectId: {
          hubspotPortalId: input.hubspotPortalId,
          hubspotObjectId: deal.id,
        },
      },
      create: {
        hubspotPortalId: input.hubspotPortalId,
        hubspotObjectId: deal.id,
        dealName,
        amount: scalarProperty(deal, "amount"),
        currencyCode: scalarProperty(deal, "deal_currency_code"),
        pipelineId: scalarProperty(deal, "pipeline"),
        stageId: scalarProperty(deal, "dealstage"),
        ownerId: scalarProperty(deal, "hubspot_owner_id"),
        closeDate: parseHubspotDate(scalarProperty(deal, "closedate")),
        hubspotCreatedAt: parseHubspotDate(scalarProperty(deal, "createdate"))
          ?? parseHubspotDate(deal.createdAt),
        lastObservedHubspotUpdatedAt: observedAt(deal) ?? input.observedAt,
        mirrorProperties: toJsonValue(deal.properties),
        archived: deal.archived,
      },
      update: {
        dealName,
        amount: scalarProperty(deal, "amount"),
        currencyCode: scalarProperty(deal, "deal_currency_code"),
        pipelineId: scalarProperty(deal, "pipeline"),
        stageId: scalarProperty(deal, "dealstage"),
        ownerId: scalarProperty(deal, "hubspot_owner_id"),
        closeDate: parseHubspotDate(scalarProperty(deal, "closedate")),
        hubspotCreatedAt: parseHubspotDate(scalarProperty(deal, "createdate"))
          ?? parseHubspotDate(deal.createdAt),
        lastObservedHubspotUpdatedAt: observedAt(deal) ?? input.observedAt,
        mirrorProperties: toJsonValue(deal.properties),
        archived: deal.archived,
      },
      select: { id: true },
    });
    dealMirrorIds.set(deal.id, mirror.id);
  }

  const activationMirrorIds = new Map<string, string>();
  for (const activation of input.snapshot.activations) {
    const name = scalarProperty(activation, input.config.activationNameProperty)
      ?? `HubSpot activation ${activation.id}`;
    const mirror = await input.tx.hubspotActivationMirror.upsert({
      where: {
        hubspotPortalId_hubspotObjectId: {
          hubspotPortalId: input.hubspotPortalId,
          hubspotObjectId: activation.id,
        },
      },
      create: {
        hubspotPortalId: input.hubspotPortalId,
        hubspotObjectId: activation.id,
        name,
        activationType: input.config.activationTypeProperty
          ? scalarProperty(activation, input.config.activationTypeProperty)
          : null,
        activationUrl: input.config.activationUrlProperty
          ? scalarProperty(activation, input.config.activationUrlProperty)
          : null,
        publicationDate: input.config.activationPublicationDateProperty
          ? parseHubspotDate(scalarProperty(
              activation,
              input.config.activationPublicationDateProperty,
            ))
          : null,
        lastObservedHubspotUpdatedAt: observedAt(activation) ?? input.observedAt,
        mirrorProperties: toJsonValue(activation.properties),
        archived: activation.archived,
      },
      update: {
        name,
        activationType: input.config.activationTypeProperty
          ? scalarProperty(activation, input.config.activationTypeProperty)
          : null,
        activationUrl: input.config.activationUrlProperty
          ? scalarProperty(activation, input.config.activationUrlProperty)
          : null,
        publicationDate: input.config.activationPublicationDateProperty
          ? parseHubspotDate(scalarProperty(
              activation,
              input.config.activationPublicationDateProperty,
            ))
          : null,
        lastObservedHubspotUpdatedAt: observedAt(activation) ?? input.observedAt,
        mirrorProperties: toJsonValue(activation.properties),
        archived: activation.archived,
      },
      select: { id: true },
    });
    activationMirrorIds.set(activation.id, mirror.id);
  }

  const clients = await input.tx.client.findMany({
    where: {
      hubspotPortalId: input.hubspotPortalId,
      hubspotObjectType: input.config.clientObjectType,
      hubspotObjectId: { in: unique([...input.snapshot.dealClientIds.values()].flat()) },
    },
    select: { id: true, hubspotObjectId: true },
  });
  const campaigns = await input.tx.campaign.findMany({
    where: {
      hubspotPortalId: input.hubspotPortalId,
      hubspotObjectType: input.config.campaignObjectType,
      hubspotObjectId: { in: unique([...input.snapshot.dealCampaignIds.values()].flat()) },
    },
    select: { id: true, hubspotObjectId: true },
  });
  const clientIdsByHubspotId = new Map(clients.flatMap((client) =>
    client.hubspotObjectId ? [[client.hubspotObjectId, client.id] as const] : []));
  const campaignIdsByHubspotId = new Map(campaigns.flatMap((campaign) =>
    campaign.hubspotObjectId ? [[campaign.hubspotObjectId, campaign.id] as const] : []));

  for (const contactLink of input.snapshot.contactLinks) {
    const dealIds = input.snapshot.contactDealIds.get(contactLink.hubspotObjectId) ?? [];
    const mirrorIds = dealIds.map((dealId) => dealMirrorIds.get(dealId)).filter(
      (value): value is string => Boolean(value),
    );
    await input.tx.hubspotContactDealAssociation.deleteMany({
      where: {
        hubspotContactLinkId: contactLink.id,
        ...(mirrorIds.length > 0
          ? { hubspotDealMirrorId: { notIn: mirrorIds } }
          : {}),
      },
    });
    for (const hubspotDealMirrorId of mirrorIds) {
      await input.tx.hubspotContactDealAssociation.upsert({
        where: {
          hubspotContactLinkId_hubspotDealMirrorId: {
            hubspotContactLinkId: contactLink.id,
            hubspotDealMirrorId,
          },
        },
        create: { hubspotContactLinkId: contactLink.id, hubspotDealMirrorId, observedAt: input.observedAt },
        update: { observedAt: input.observedAt },
      });
    }
  }

  for (const deal of input.snapshot.deals) {
    const hubspotDealMirrorId = dealMirrorIds.get(deal.id)!;
    const clientHubspotIds = input.snapshot.dealClientIds.get(deal.id) ?? [];
    const campaignHubspotIds = input.snapshot.dealCampaignIds.get(deal.id) ?? [];
    const activationHubspotIds = input.snapshot.dealActivationIds.get(deal.id) ?? [];
    const clientIds = clientHubspotIds.map((id) => clientIdsByHubspotId.get(id)).filter(
      (value): value is string => Boolean(value),
    );
    const campaignIds = campaignHubspotIds.map((id) => campaignIdsByHubspotId.get(id)).filter(
      (value): value is string => Boolean(value),
    );
    const activationIds = activationHubspotIds.map((id) => activationMirrorIds.get(id)).filter(
      (value): value is string => Boolean(value),
    );

    if (clientIds.length !== clientHubspotIds.length || campaignIds.length !== campaignHubspotIds.length) {
      throw new ServiceError(
        "HUBSPOT_COLLABORATION_REFERENCE_MISSING",
        502,
        `HubSpot Deal ${deal.id} references a Client or Campaign that is not synchronized locally`,
      );
    }

    await input.tx.hubspotDealClientAssociation.deleteMany({
      where: { hubspotDealMirrorId, ...(clientIds.length > 0 ? { clientId: { notIn: clientIds } } : {}) },
    });
    await input.tx.hubspotDealCampaignAssociation.deleteMany({
      where: { hubspotDealMirrorId, ...(campaignIds.length > 0 ? { campaignId: { notIn: campaignIds } } : {}) },
    });
    await input.tx.hubspotDealActivationAssociation.deleteMany({
      where: {
        hubspotDealMirrorId,
        ...(activationIds.length > 0
          ? { hubspotActivationMirrorId: { notIn: activationIds } }
          : {}),
      },
    });

    for (const clientId of clientIds) {
      await input.tx.hubspotDealClientAssociation.upsert({
        where: { hubspotDealMirrorId_clientId: { hubspotDealMirrorId, clientId } },
        create: { hubspotDealMirrorId, clientId, observedAt: input.observedAt },
        update: { observedAt: input.observedAt },
      });
    }
    for (const campaignId of campaignIds) {
      await input.tx.hubspotDealCampaignAssociation.upsert({
        where: { hubspotDealMirrorId_campaignId: { hubspotDealMirrorId, campaignId } },
        create: { hubspotDealMirrorId, campaignId, observedAt: input.observedAt },
        update: { observedAt: input.observedAt },
      });
    }
    for (const hubspotActivationMirrorId of activationIds) {
      await input.tx.hubspotDealActivationAssociation.upsert({
        where: {
          hubspotDealMirrorId_hubspotActivationMirrorId: {
            hubspotDealMirrorId,
            hubspotActivationMirrorId,
          },
        },
        create: { hubspotDealMirrorId, hubspotActivationMirrorId, observedAt: input.observedAt },
        update: { observedAt: input.observedAt },
      });
    }
  }

  return {
    dealMirrorUpsertCount: input.snapshot.deals.length,
    activationMirrorUpsertCount: input.snapshot.activations.length,
  };
}
