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

export const HUBSPOT_SYNCED_DROPDOWN_FIELD_KEYS = [
  "currency",
  "dealType",
  "activationType",
  "countryRegion",
  "language",
] as const;

export const hubspotSyncedDropdownFieldKeySchema = z.enum(HUBSPOT_SYNCED_DROPDOWN_FIELD_KEYS);

export const PLATFORM_MANAGED_DROPDOWN_FIELD_KEYS = [
  "influencerType",
  "influencerVertical",
] as const;

export const platformManagedDropdownFieldKeySchema = z.enum(PLATFORM_MANAGED_DROPDOWN_FIELD_KEYS);

// These values mirror the current HubSpot taxonomy, but the platform owns them directly
// so CSV import and HubSpot preparation do not depend on connector sync.
export const PLATFORM_MANAGED_DROPDOWN_VALUES = {
  influencerType: [
    "Male",
    "Female",
    "Couple",
    "Family",
    "Team",
    "Animation",
    "Kids",
    "Faceless",
    "Duo",
  ],
  influencerVertical: [
    "Abandoned Places",
    "Adventure",
    "Animals",
    "Animations",
    "Anime",
    "Art",
    "ASMR",
    "Astrology",
    "Aviation",
    "Books",
    "Budgeting",
    "Cars",
    "Chess",
    "Commentary",
    "Conspiracy",
    "Construction",
    "Cosplay",
    "Crimes",
    "Cybersecurity",
    "Cycling",
    "Dance",
    "DIY",
    "Documentary",
    "Editing",
    "Education",
    "Engineering",
    "Entertainment",
    "Environment",
    "Family",
    "Fashion",
    "Finance",
    "Fishing",
    "Fitness",
    "Food",
    "Football",
    "Gaming",
    "Guitars",
    "Health",
    "History",
    "Home Decor",
    "Home Renovation",
    "Humor",
    "Hunting",
    "Infotainment",
    "Interview",
    "Journalism",
    "Just Chatting",
    "Kids",
    "Lego",
    "Lifestyle",
    "Minecraft",
    "Motivation",
    "Movies",
    "Music",
    "Mystery",
    "News",
    "Outdoor",
    "Painting",
    "Parenting",
    "Pets",
    "Photography",
    "Plants",
    "Podcast",
    "Pokemon Cards",
    "Politics",
    "Pop Culture",
    "Reviews",
    "Science",
    "Society",
    "Sport",
    "TCG",
    "Tech",
    "Travel",
    "Variety",
    "Vlog",
    "Yoga",
    "Beauty",
  ],
} as const satisfies Record<
  z.infer<typeof platformManagedDropdownFieldKeySchema>,
  readonly string[]
>;

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

export const syncHubspotDropdownValuesResponseSchema = listDropdownValuesResponseSchema;

export type DropdownValueFieldKey = z.infer<typeof dropdownValueFieldKeySchema>;
export type HubspotSyncedDropdownFieldKey = z.infer<typeof hubspotSyncedDropdownFieldKeySchema>;
export type PlatformManagedDropdownFieldKey = z.infer<typeof platformManagedDropdownFieldKeySchema>;
export type DropdownValue = z.infer<typeof dropdownValueSchema>;
export type ListDropdownValuesResponse = z.infer<typeof listDropdownValuesResponseSchema>;
export type UpdateDropdownValuesRequest = z.infer<typeof updateDropdownValuesRequestSchema>;
