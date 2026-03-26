import { z } from "zod";

export const exportPreviewColumnSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  required: z.boolean().default(false),
  editable: z.boolean().default(false),
});

export const exportPreviewValidationIssueSchema = z.object({
  rowId: z.string().trim().min(1),
  columnKey: z.string().trim().min(1),
  message: z.string().trim().min(1),
});

export const exportPreviewRowSchema = z.object({
  id: z.string().trim().min(1),
  channelId: z.uuid(),
  channelTitle: z.string(),
  values: z.record(z.string(), z.string()),
});

export const exportPreviewDefaultsSchema = z.record(z.string(), z.string());

export const hubspotExportPreviewSchema = z.object({
  run: z.object({
    id: z.uuid(),
    name: z.string(),
    campaignName: z.string().nullable(),
  }),
  columns: z.array(exportPreviewColumnSchema),
  requiredColumnKeys: z.array(z.string()),
  defaults: exportPreviewDefaultsSchema,
  rows: z.array(exportPreviewRowSchema),
  validationIssues: z.array(exportPreviewValidationIssueSchema),
});

export const csvExportPreviewSchema = z.object({
  run: z.object({
    id: z.uuid(),
    name: z.string(),
    campaignName: z.string().nullable(),
  }),
  columns: z.array(exportPreviewColumnSchema),
  rows: z.array(exportPreviewRowSchema),
});

export type ExportPreviewColumn = z.infer<typeof exportPreviewColumnSchema>;
export type ExportPreviewValidationIssue = z.infer<typeof exportPreviewValidationIssueSchema>;
export type ExportPreviewRow = z.infer<typeof exportPreviewRowSchema>;
export type HubspotExportPreview = z.infer<typeof hubspotExportPreviewSchema>;
export type CsvExportPreview = z.infer<typeof csvExportPreviewSchema>;
