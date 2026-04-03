import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import process from "node:process";

import {
  AdvancedReportRequestStatus,
  ChannelEnrichmentStatus,
  Role,
  RunRequestStatus,
  RunResultSource,
} from "@prisma/client";

import {
  createRunRequest,
  listChannels,
  listRecentRuns,
  requestChannelLlmEnrichment,
  setUserYoutubeApiKey,
  stopRunsQueue,
} from "../backend/packages/core/src";
import { hashPassword } from "../backend/packages/core/src/auth/password";
import { disconnectPrisma, prisma } from "../backend/packages/db/src";

type ScriptConfig = Readonly<{
  channelCount: number;
  managerCount: number;
  label: string;
  cleanupOnly: boolean;
  json: boolean;
  queueWaitTimeoutMs: number;
}>;

type SyntheticManager = Readonly<{
  id: string;
  email: string;
  name: string;
}>;

type SeededScenario = Readonly<{
  managers: readonly SyntheticManager[];
  campaignId: string;
  channelIds: readonly string[];
  searchQuery: string;
}>;

type Sample<T = undefined> = Readonly<{
  durationMs: number;
  ok: boolean;
  value?: T;
  error?: string;
}>;

type Summary = Readonly<{
  count: number;
  okCount: number;
  errorCount: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
}>;

type QueueSummary = Readonly<{
  measuredCount: number;
  pendingCount: number;
  p95Ms: number | null;
  maxMs: number | null;
}>;

const ACCEPTANCE_THRESHOLDS = {
  catalogP95Ms: 500,
  dashboardP95Ms: 500,
  concurrentFailures: 0,
  runQueueStartLatencyMs: 120_000,
} as const;

const DEFAULT_CHANNEL_COUNT = 10_000;
const DEFAULT_MANAGER_COUNT = 20;
const DEFAULT_QUEUE_WAIT_TIMEOUT_MS = 120_000;
const CHANNEL_INSERT_BATCH_SIZE = 500;
const BASELINE_RUNS_PER_MANAGER = 5;
const ENRICHMENT_REQUESTS_PER_MANAGER = 2;

function getFlagValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const argument = process.argv.slice(2).find((value) => value.startsWith(prefix));

  return argument ? argument.slice(prefix.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer but received "${value}"`);
  }

  return parsed;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

function getScriptConfig(): ScriptConfig {
  const label = getFlagValue("label")?.trim() || "capacity-check";

  return {
    channelCount: parsePositiveInteger(getFlagValue("channels"), DEFAULT_CHANNEL_COUNT),
    managerCount: parsePositiveInteger(getFlagValue("managers"), DEFAULT_MANAGER_COUNT),
    label,
    cleanupOnly: hasFlag("cleanup-only"),
    json: hasFlag("json"),
    queueWaitTimeoutMs: parsePositiveInteger(
      getFlagValue("queue-timeout-ms"),
      DEFAULT_QUEUE_WAIT_TIMEOUT_MS,
    ),
  };
}

function percentile(values: readonly number[], ratio: number): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((ratio / 100) * sorted.length) - 1),
  );
  const value = sorted[index];

  return value === undefined ? null : Math.round(value);
}

function summarizeSamples(samples: readonly Sample[]): Summary {
  const successfulDurations = samples
    .filter((sample) => sample.ok)
    .map((sample) => Math.round(sample.durationMs));

  return {
    count: samples.length,
    okCount: successfulDurations.length,
    errorCount: samples.length - successfulDurations.length,
    p50Ms: percentile(successfulDurations, 50),
    p95Ms: percentile(successfulDurations, 95),
    p99Ms: percentile(successfulDurations, 99),
    maxMs:
      successfulDurations.length > 0
        ? Math.max(...successfulDurations)
        : null,
  };
}

async function measure<T>(operation: () => Promise<T>): Promise<Sample<T>> {
  const startedAt = performance.now();

  try {
    const value = await operation();

    return {
      durationMs: performance.now() - startedAt,
      ok: true,
      value,
    };
  } catch (error) {
    return {
      durationMs: performance.now() - startedAt,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function getManagerEmail(label: string, index: number): string {
  return `${slugify(label)}+manager-${index + 1}@capacity.synthetic`;
}

function getManagerName(index: number): string {
  return `Capacity Manager ${String(index + 1).padStart(2, "0")}`;
}

function getChannelIdPrefix(label: string): string {
  return `UC-${slugify(label).toUpperCase().replaceAll("-", "")}-`;
}

async function cleanupSyntheticData(config: ScriptConfig): Promise<void> {
  const managerEmails = Array.from({ length: config.managerCount }, (_, index) =>
    getManagerEmail(config.label, index),
  );
  const managers = await prisma.user.findMany({
    where: {
      email: {
        in: managerEmails,
      },
    },
    select: {
      id: true,
    },
  });
  const managerIds = managers.map((manager) => manager.id);
  const channels = await prisma.channel.findMany({
    where: {
      youtubeChannelId: {
        startsWith: getChannelIdPrefix(config.label),
      },
    },
    select: {
      id: true,
    },
  });
  const channelIds = channels.map((channel) => channel.id);
  const runRequests = managerIds.length
    ? await prisma.runRequest.findMany({
        where: {
          requestedByUserId: {
            in: managerIds,
          },
        },
        select: {
          id: true,
        },
      })
    : [];
  const runRequestIds = runRequests.map((runRequest) => runRequest.id);

  if (runRequestIds.length > 0) {
    await prisma.runResult.deleteMany({
      where: {
        runRequestId: {
          in: runRequestIds,
        },
      },
    });
    await prisma.runRequest.deleteMany({
      where: {
        id: {
          in: runRequestIds,
        },
      },
    });
  }

  if (channelIds.length > 0) {
    await prisma.advancedReportRequest.deleteMany({
      where: {
        channelId: {
          in: channelIds,
        },
      },
    });
    await prisma.channelEnrichment.deleteMany({
      where: {
        channelId: {
          in: channelIds,
        },
      },
    });
    await prisma.channelYoutubeContext.deleteMany({
      where: {
        channelId: {
          in: channelIds,
        },
      },
    });
    await prisma.channelProviderPayload.deleteMany({
      where: {
        channelId: {
          in: channelIds,
        },
      },
    });
    await prisma.channelInsight.deleteMany({
      where: {
        channelId: {
          in: channelIds,
        },
      },
    });
    await prisma.channelManualOverride.deleteMany({
      where: {
        channelId: {
          in: channelIds,
        },
      },
    });
    await prisma.channelContact.deleteMany({
      where: {
        channelId: {
          in: channelIds,
        },
      },
    });
    await prisma.channelMetric.deleteMany({
      where: {
        channelId: {
          in: channelIds,
        },
      },
    });
    await prisma.channel.deleteMany({
      where: {
        id: {
          in: channelIds,
        },
      },
    });
  }

  if (managerIds.length > 0) {
    await prisma.savedSegment.deleteMany({
      where: {
        userId: {
          in: managerIds,
        },
      },
    });
    await prisma.userProviderCredential.deleteMany({
      where: {
        userId: {
          in: managerIds,
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        id: {
          in: managerIds,
        },
      },
    });
  }

  await prisma.campaign.deleteMany({
    where: {
      name: `${config.label} Campaign`,
    },
  });
  await prisma.client.deleteMany({
    where: {
      name: `${config.label} Client`,
    },
  });
  await prisma.market.deleteMany({
    where: {
      name: `${config.label} Market`,
    },
  });
}

async function seedSyntheticManagers(config: ScriptConfig): Promise<readonly SyntheticManager[]> {
  const passwordHash = await hashPassword("CapacityCheckPassword123");
  const managers: SyntheticManager[] = [];

  for (let index = 0; index < config.managerCount; index += 1) {
    const manager = await prisma.user.create({
      data: {
        email: getManagerEmail(config.label, index),
        name: getManagerName(index),
        role: Role.USER,
        passwordHash,
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        name: true,
      },
    });

    await setUserYoutubeApiKey({
      userId: manager.id,
      rawKey: `synthetic-youtube-key-${index + 1}`,
      actorUserId: manager.id,
    });

    managers.push(manager);
  }

  return managers;
}

async function seedSyntheticCampaign(
  config: ScriptConfig,
  managers: readonly SyntheticManager[],
): Promise<string> {
  const client = await prisma.client.create({
    data: {
      name: `${config.label} Client`,
    },
    select: {
      id: true,
    },
  });
  const market = await prisma.market.create({
    data: {
      name: `${config.label} Market`,
    },
    select: {
      id: true,
    },
  });
  const campaign = await prisma.campaign.create({
    data: {
      name: `${config.label} Campaign`,
      clientId: client.id,
      marketId: market.id,
      month: "APRIL",
      year: 2026,
      isActive: true,
      createdByUserId: managers[0]?.id ?? null,
    },
    select: {
      id: true,
    },
  });

  return campaign.id;
}

async function seedSyntheticChannels(
  config: ScriptConfig,
  managers: readonly SyntheticManager[],
): Promise<readonly string[]> {
  const channelIds: string[] = [];
  const channelIdPrefix = getChannelIdPrefix(config.label);
  const searchQuery = `${config.label} gaming`;
  const startedAt = Date.now();

  for (const channelIndexes of chunk(
    Array.from({ length: config.channelCount }, (_, index) => index),
    CHANNEL_INSERT_BATCH_SIZE,
  )) {
    const channelRows: Array<{
      id: string;
      youtubeChannelId: string;
      title: string;
      handle: string;
      description: string;
      createdAt: Date;
      updatedAt: Date;
    }> = [];
    const enrichmentRows: Array<{
      channelId: string;
      status: ChannelEnrichmentStatus;
      requestedByUserId: string;
      requestedAt: Date;
      completedAt?: Date | null;
      lastError?: string | null;
      summary?: string | null;
      topics?: string[];
      brandFitNotes?: string | null;
      createdAt: Date;
      updatedAt: Date;
    }> = [];
    const advancedReportRows: Array<{
      id: string;
      channelId: string;
      requestedByUserId: string;
      status: AdvancedReportRequestStatus;
      completedAt?: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }> = [];

    for (const channelIndex of channelIndexes) {
      const channelId = randomUUID();
      const createdAt = new Date(startedAt - channelIndex * 60_000);
      const managerId = managers[channelIndex % managers.length]?.id;

      if (!managerId) {
        throw new Error("Expected at least one synthetic manager");
      }

      channelIds.push(channelId);
      channelRows.push({
        id: channelId,
        youtubeChannelId: `${channelIdPrefix}${String(channelIndex + 1).padStart(5, "0")}`,
        title:
          channelIndex % 5 === 0
            ? `${searchQuery} creator ${channelIndex + 1}`
            : `${config.label} lifestyle creator ${channelIndex + 1}`,
        handle: `@${slugify(config.label)}-creator-${channelIndex + 1}`,
        description: `Synthetic capacity-check creator ${channelIndex + 1}`,
        createdAt,
        updatedAt: createdAt,
      });

      if (channelIndex % 11 === 0) {
        enrichmentRows.push({
          channelId,
          status: ChannelEnrichmentStatus.QUEUED,
          requestedByUserId: managerId,
          requestedAt: createdAt,
          createdAt,
          updatedAt: createdAt,
        });
      } else if (channelIndex % 5 === 0) {
        enrichmentRows.push({
          channelId,
          status: ChannelEnrichmentStatus.FAILED,
          requestedByUserId: managerId,
          requestedAt: createdAt,
          completedAt: new Date(createdAt.getTime() + 60_000),
          lastError: "Synthetic quota failure",
          createdAt,
          updatedAt: createdAt,
        });
      } else if (channelIndex % 3 === 0) {
        enrichmentRows.push({
          channelId,
          status: ChannelEnrichmentStatus.COMPLETED,
          requestedByUserId: managerId,
          requestedAt: createdAt,
          completedAt: new Date(createdAt.getTime() + 60_000),
          summary: "Synthetic enrichment summary",
          topics: ["gaming", "review"],
          brandFitNotes: "Synthetic brand fit",
          createdAt,
          updatedAt: createdAt,
        });
      }

      if (channelIndex % 4 === 0) {
        advancedReportRows.push({
          id: randomUUID(),
          channelId,
          requestedByUserId: managerId,
          status:
            channelIndex % 8 === 0
              ? AdvancedReportRequestStatus.COMPLETED
              : AdvancedReportRequestStatus.PENDING_APPROVAL,
          completedAt:
            channelIndex % 8 === 0 ? new Date(createdAt.getTime() + 120_000) : null,
          createdAt,
          updatedAt: createdAt,
        });
      }
    }

    await prisma.channel.createMany({
      data: channelRows,
    });

    if (enrichmentRows.length > 0) {
      await prisma.channelEnrichment.createMany({
        data: enrichmentRows,
      });
    }

    if (advancedReportRows.length > 0) {
      await prisma.advancedReportRequest.createMany({
        data: advancedReportRows,
      });
    }
  }

  return channelIds;
}

async function seedBaselineRuns(
  config: ScriptConfig,
  managers: readonly SyntheticManager[],
  campaignId: string,
  channelIds: readonly string[],
): Promise<void> {
  const runRows: Array<{
    id: string;
    requestedByUserId: string;
    name: string;
    query: string;
    target: number;
    status: RunRequestStatus;
    lastError?: string | null;
    createdAt: Date;
    updatedAt: Date;
    startedAt?: Date | null;
    completedAt?: Date | null;
    campaignId: string;
    client: string;
    market: string;
    campaignManagerUserId: string;
  }> = [];
  const resultRows: Array<{
    runRequestId: string;
    channelId: string;
    rank: number;
    source: RunResultSource;
  }> = [];

  managers.forEach((manager, managerIndex) => {
    for (let runIndex = 0; runIndex < BASELINE_RUNS_PER_MANAGER; runIndex += 1) {
      const id = randomUUID();
      const createdAt = new Date(Date.now() - (managerIndex * BASELINE_RUNS_PER_MANAGER + runIndex) * 90_000);
      const statusCycle = [
        RunRequestStatus.COMPLETED,
        RunRequestStatus.RUNNING,
        RunRequestStatus.QUEUED,
        RunRequestStatus.FAILED,
        RunRequestStatus.COMPLETED,
      ] as const;
      const status = statusCycle[runIndex % statusCycle.length];

      runRows.push({
        id,
        requestedByUserId: manager.id,
        name: `${config.label} baseline run ${managerIndex + 1}-${runIndex + 1}`,
        query: runIndex % 2 === 0 ? `${config.label} gaming` : `${config.label} lifestyle`,
        target: 50,
        status,
        lastError: status === RunRequestStatus.FAILED ? "Synthetic discovery failure" : null,
        createdAt,
        updatedAt: createdAt,
        startedAt: status === RunRequestStatus.QUEUED ? null : createdAt,
        completedAt:
          status === RunRequestStatus.COMPLETED || status === RunRequestStatus.FAILED
            ? new Date(createdAt.getTime() + 60_000)
            : null,
        campaignId,
        client: managerIndex % 2 === 0 ? "Sony" : "LEGO",
        market: runIndex % 2 === 0 ? "DACH" : "Nordics",
        campaignManagerUserId: manager.id,
      });

      if (status === RunRequestStatus.COMPLETED && channelIds.length >= 2) {
        resultRows.push(
          {
            runRequestId: id,
            channelId: channelIds[(managerIndex + runIndex) % channelIds.length],
            rank: 1,
            source: RunResultSource.CATALOG,
          },
          {
            runRequestId: id,
            channelId: channelIds[(managerIndex + runIndex + 1) % channelIds.length],
            rank: 2,
            source: RunResultSource.DISCOVERY,
          },
        );
      }
    }
  });

  await prisma.runRequest.createMany({
    data: runRows,
  });

  if (resultRows.length > 0) {
    await prisma.runResult.createMany({
      data: resultRows,
    });
  }
}

async function seedScenario(config: ScriptConfig): Promise<SeededScenario> {
  await cleanupSyntheticData(config);

  const managers = await seedSyntheticManagers(config);
  const campaignId = await seedSyntheticCampaign(config, managers);
  const channelIds = await seedSyntheticChannels(config, managers);
  await seedBaselineRuns(config, managers, campaignId, channelIds);

  return {
    managers,
    campaignId,
    channelIds,
    searchQuery: `${config.label} gaming`,
  };
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function waitForRunStarts(
  runIds: readonly string[],
  timeoutMs: number,
): Promise<QueueSummary> {
  const pendingIds = new Set(runIds);
  const latencies: number[] = [];
  const deadline = Date.now() + timeoutMs;

  while (pendingIds.size > 0 && Date.now() < deadline) {
    const runs = await prisma.runRequest.findMany({
      where: {
        id: {
          in: [...pendingIds],
        },
      },
      select: {
        id: true,
        createdAt: true,
        startedAt: true,
      },
    });

    for (const run of runs) {
      if (!run.startedAt) {
        continue;
      }

      pendingIds.delete(run.id);
      latencies.push(run.startedAt.getTime() - run.createdAt.getTime());
    }

    if (pendingIds.size > 0) {
      await sleep(1_000);
    }
  }

  return {
    measuredCount: latencies.length,
    pendingCount: pendingIds.size,
    p95Ms: percentile(latencies, 95),
    maxMs: latencies.length > 0 ? Math.max(...latencies) : null,
  };
}

function printHumanSummary(input: {
  config: ScriptConfig;
  seededScenario?: SeededScenario;
  catalogFirstPage: Summary;
  catalogSearch: Summary;
  catalogFilteredSearch: Summary;
  dashboardRefresh: Summary;
  runCreation: Summary;
  enrichmentBurst: Summary;
  runQueueStart: QueueSummary;
  totalFailures: number;
}): void {
  process.stdout.write(`Capacity check label: ${input.config.label}\n`);
  process.stdout.write(
    `Seeded ${input.config.channelCount} channels for ${input.config.managerCount} managers.\n`,
  );

  const sections = [
    ["Catalog first page", input.catalogFirstPage],
    ["Catalog search", input.catalogSearch],
    ["Catalog filtered search", input.catalogFilteredSearch],
    ["Dashboard refresh", input.dashboardRefresh],
    ["Run creation burst", input.runCreation],
    ["Enrichment request burst", input.enrichmentBurst],
  ] as const;

  for (const [label, summary] of sections) {
    process.stdout.write(
      `${label}: count=${summary.count} ok=${summary.okCount} errors=${summary.errorCount} p95=${summary.p95Ms ?? "n/a"}ms p99=${summary.p99Ms ?? "n/a"}ms max=${summary.maxMs ?? "n/a"}ms\n`,
    );
  }

  process.stdout.write(
    `Run queue start: measured=${input.runQueueStart.measuredCount} pending=${input.runQueueStart.pendingCount} p95=${input.runQueueStart.p95Ms ?? "n/a"}ms max=${input.runQueueStart.maxMs ?? "n/a"}ms\n`,
  );
  process.stdout.write(
    `Thresholds: catalog/dashboard p95 <= ${ACCEPTANCE_THRESHOLDS.catalogP95Ms}ms, failures <= ${ACCEPTANCE_THRESHOLDS.concurrentFailures}, run queue start <= ${ACCEPTANCE_THRESHOLDS.runQueueStartLatencyMs}ms\n`,
  );
  process.stdout.write(`Total failed operations: ${input.totalFailures}\n`);
}

async function main(): Promise<void> {
  const config = getScriptConfig();

  if (config.cleanupOnly) {
    await cleanupSyntheticData(config);
    process.stdout.write(`Cleaned synthetic capacity-check data for label "${config.label}".\n`);
    return;
  }

  const seededScenario = await seedScenario(config);

  const catalogFirstPageSamples = await Promise.all(
    seededScenario.managers.map(() =>
      measure(() =>
        listChannels({
          page: 1,
          pageSize: 20,
        }),
      ),
    ),
  );
  const catalogSearchSamples = await Promise.all(
    seededScenario.managers.map(() =>
      measure(() =>
        listChannels({
          page: 1,
          pageSize: 20,
          query: seededScenario.searchQuery,
        }),
      ),
    ),
  );
  const catalogFilteredSearchSamples = await Promise.all(
    seededScenario.managers.map(() =>
      measure(() =>
        listChannels({
          page: 1,
          pageSize: 20,
          query: seededScenario.searchQuery,
          enrichmentStatus: ["failed"],
        }),
      ),
    ),
  );
  const dashboardRefreshSamples = await Promise.all(
    seededScenario.managers.map((manager) =>
      measure(() =>
        listRecentRuns({
          userId: manager.id,
          role: "user",
          limit: 50,
        }),
      ),
    ),
  );
  const runCreationSamples = await Promise.all(
    seededScenario.managers.map((manager, index) =>
      measure(() =>
        createRunRequest({
          userId: manager.id,
          name: `${config.label} burst run ${index + 1}`,
          query: seededScenario.searchQuery,
          target: 50,
          metadata: {
            campaignId: seededScenario.campaignId,
          },
        }),
      ),
    ),
  );

  const overlappingChannelIds = seededScenario.channelIds.slice(
    0,
    Math.max(1, Math.min(10, seededScenario.channelIds.length)),
  );
  const enrichmentBurstSamples = await Promise.all(
    seededScenario.managers.flatMap((manager, managerIndex) =>
      Array.from({ length: ENRICHMENT_REQUESTS_PER_MANAGER }, (_, enrichmentIndex) => {
        const channelId =
          overlappingChannelIds[
            (managerIndex + enrichmentIndex) % overlappingChannelIds.length
          ];

        if (!channelId) {
          throw new Error("Expected an overlapping enrichment channel id");
        }

        return measure(() =>
          requestChannelLlmEnrichment({
            channelId,
            requestedByUserId: manager.id,
          }),
        );
      }),
    ),
  );

  const createdRunIds = runCreationSamples
    .filter((sample): sample is Sample<{ runId: string }> => sample.ok && Boolean(sample.value))
    .map((sample) => sample.value?.runId)
    .filter((runId): runId is string => typeof runId === "string");
  const runQueueStart = await waitForRunStarts(createdRunIds, config.queueWaitTimeoutMs);

  const catalogFirstPage = summarizeSamples(catalogFirstPageSamples);
  const catalogSearch = summarizeSamples(catalogSearchSamples);
  const catalogFilteredSearch = summarizeSamples(catalogFilteredSearchSamples);
  const dashboardRefresh = summarizeSamples(dashboardRefreshSamples);
  const runCreation = summarizeSamples(runCreationSamples);
  const enrichmentBurst = summarizeSamples(enrichmentBurstSamples);
  const totalFailures =
    catalogFirstPage.errorCount +
    catalogSearch.errorCount +
    catalogFilteredSearch.errorCount +
    dashboardRefresh.errorCount +
    runCreation.errorCount +
    enrichmentBurst.errorCount;

  const report = {
    generatedAt: new Date().toISOString(),
    config,
    thresholds: ACCEPTANCE_THRESHOLDS,
    catalogFirstPage,
    catalogSearch,
    catalogFilteredSearch,
    dashboardRefresh,
    runCreation,
    enrichmentBurst,
    runQueueStart,
    totalFailures,
    evaluation: {
      catalogFirstPageP95Ok:
        (catalogFirstPage.p95Ms ?? Number.POSITIVE_INFINITY) <=
        ACCEPTANCE_THRESHOLDS.catalogP95Ms,
      catalogSearchP95Ok:
        (catalogSearch.p95Ms ?? Number.POSITIVE_INFINITY) <=
        ACCEPTANCE_THRESHOLDS.catalogP95Ms,
      catalogFilteredSearchP95Ok:
        (catalogFilteredSearch.p95Ms ?? Number.POSITIVE_INFINITY) <=
        ACCEPTANCE_THRESHOLDS.catalogP95Ms,
      dashboardP95Ok:
        (dashboardRefresh.p95Ms ?? Number.POSITIVE_INFINITY) <=
        ACCEPTANCE_THRESHOLDS.dashboardP95Ms,
      noFailedRequests:
        totalFailures <= ACCEPTANCE_THRESHOLDS.concurrentFailures,
      runQueueStartP95Ok:
        runQueueStart.pendingCount === 0 &&
        (runQueueStart.p95Ms ?? Number.POSITIVE_INFINITY) <=
          ACCEPTANCE_THRESHOLDS.runQueueStartLatencyMs,
    },
  };

  if (config.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  printHumanSummary({
    config,
    seededScenario,
    catalogFirstPage,
    catalogSearch,
    catalogFilteredSearch,
    dashboardRefresh,
    runCreation,
    enrichmentBurst,
    runQueueStart,
    totalFailures,
  });
}

void main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stopRunsQueue();
    await disconnectPrisma();
  });
