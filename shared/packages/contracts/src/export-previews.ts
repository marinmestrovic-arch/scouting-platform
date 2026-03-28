import { z } from "zod";

import { dropdownValueFieldKeySchema } from "./dropdown-values";

export const exportPreviewColumnSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  required: z.boolean().default(false),
  editable: z.boolean().default(false),
  fieldType: z.enum(["text", "dropdown", "readonly"]).default("text"),
  dropdownFieldKey: dropdownValueFieldKeySchema.nullable().default(null),
});

export const exportPreviewValidationIssueSchema = z.object({
  rowId: z.string().trim().min(1),
  columnKey: z.string().trim().min(1),
  message: z.string().trim().min(1),
});

export const exportPreviewRowSchema = z.object({
  id: z.string().trim().min(1),
  rowKey: z.string().trim().min(1),
  channelId: z.uuid(),
  channelTitle: z.string(),
  values: z.record(z.string(), z.string()),
});

export const exportPreviewDefaultsSchema = z.record(z.string(), z.string());

export const exportPreviewDropdownOptionsSchema = z.record(
  dropdownValueFieldKeySchema,
  z.array(z.string()),
);

export const hubspotPrepUpdateDefaultsSchema = z.object({
  currency: z.string(),
  dealType: z.string(),
  activationType: z.string(),
  influencerType: z.string(),
  influencerVertical: z.string(),
  countryRegion: z.string(),
  language: z.string(),
});

export const hubspotPrepRowOverrideValuesSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().optional(),
  currency: z.string().optional(),
  dealType: z.string().optional(),
  activationType: z.string().optional(),
  influencerType: z.string().optional(),
  influencerVertical: z.string().optional(),
  countryRegion: z.string().optional(),
  language: z.string().optional(),
});

export const hubspotPrepClearFieldSchema = z.object({
  rowKey: z.string().trim().min(1),
  field: z.enum([
    "firstName",
    "lastName",
    "email",
    "currency",
    "dealType",
    "activationType",
    "influencerType",
    "influencerVertical",
    "countryRegion",
    "language",
  ]),
});

export const hubspotPrepBulkRowOverrideSchema = z.object({
  rowKey: z.string().trim().min(1),
  values: hubspotPrepRowOverrideValuesSchema,
});

export const hubspotPrepUpdateRequestSchema = z.object({
  defaults: hubspotPrepUpdateDefaultsSchema,
  rowOverrides: z.array(hubspotPrepBulkRowOverrideSchema),
  clearedFields: z.array(hubspotPrepClearFieldSchema),
});

export const hubspotExportPreviewSchema = z.object({
  run: z.object({
    id: z.uuid(),
    name: z.string(),
    campaignName: z.string().nullable(),
  }),
  columns: z.array(exportPreviewColumnSchema),
  requiredColumnKeys: z.array(z.string()),
  defaults: exportPreviewDefaultsSchema,
  dropdownOptions: exportPreviewDropdownOptionsSchema,
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
export type ExportPreviewDropdownOptions = z.infer<typeof exportPreviewDropdownOptionsSchema>;
export type HubspotPrepUpdateDefaults = z.infer<typeof hubspotPrepUpdateDefaultsSchema>;
export type HubspotPrepRowOverrideValues = z.infer<typeof hubspotPrepRowOverrideValuesSchema>;
export type HubspotPrepClearField = z.infer<typeof hubspotPrepClearFieldSchema>;
export type HubspotPrepBulkRowOverride = z.infer<typeof hubspotPrepBulkRowOverrideSchema>;
export type HubspotPrepUpdateRequest = z.infer<typeof hubspotPrepUpdateRequestSchema>;
export type HubspotExportPreview = z.infer<typeof hubspotExportPreviewSchema>;
export type CsvExportPreview = z.infer<typeof csvExportPreviewSchema>;
