import { z } from "zod";

export const dropdownValueFieldKeySchema = z.enum([
  "currency",
  "dealType",
  "activationType",
  "influencerType",
  "influencerVertical",
  "countryRegion",
  "language",
]);

export const dropdownValueSchema = z.object({
  id: z.uuid(),
  fieldKey: dropdownValueFieldKeySchema,
  value: z.string().trim().min(1).max(200),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const listDropdownValuesResponseSchema = z.object({
  items: z.array(dropdownValueSchema),
});

export const updateDropdownValuesRequestSchema = z.object({
  fieldKey: dropdownValueFieldKeySchema,
  values: z.array(z.string().trim().min(1).max(200)).max(500),
});

export type DropdownValueFieldKey = z.infer<typeof dropdownValueFieldKeySchema>;
export type DropdownValue = z.infer<typeof dropdownValueSchema>;
export type ListDropdownValuesResponse = z.infer<typeof listDropdownValuesResponseSchema>;
export type UpdateDropdownValuesRequest = z.infer<typeof updateDropdownValuesRequestSchema>;
