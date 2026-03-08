import Link from "next/link";

type ChannelDetailShellProps = Readonly<{
  channelId: string;
}>;

type PlaceholderSection = Readonly<{
  id: string;
  title: string;
  description: string;
  fields: ReadonlyArray<{
    label: string;
    value: string;
  }>;
}>;

const PLACEHOLDER_SECTIONS: ReadonlyArray<PlaceholderSection> = [
  {
    id: "channel-detail-shell-identity",
    title: "Identity",
    description: "Resolved title, handle, thumbnail, and description appear once live channel data lands in Week 2.",
    fields: [
      {
        label: "Channel title",
        value: "Available when live channel data lands in Week 2.",
      },
      {
        label: "Public handle",
        value: "Available when live channel data lands in Week 2.",
      },
      {
        label: "Thumbnail and description",
        value: "Available when live channel data lands in Week 2.",
      },
    ],
  },
  {
    id: "channel-detail-shell-catalog-metadata",
    title: "Catalog metadata",
    description: "Week 1 keeps the route structure visible without implying catalog fields are loaded yet.",
    fields: [
      {
        label: "Catalog status",
        value: "Scaffold only in Week 1.",
      },
      {
        label: "Timestamps and provenance",
        value: "Available once live channel data lands in Week 2.",
      },
      {
        label: "Manual overrides",
        value: "Manual override context and controls stay deferred to later milestones.",
      },
    ],
  },
  {
    id: "channel-detail-shell-enrichment",
    title: "Enrichment and workflow",
    description: "Enrichment status, operator actions, and workflow context stay deferred to later milestones.",
    fields: [
      {
        label: "Enrichment state",
        value: "Visible once enrichment UI lands in later milestones.",
      },
      {
        label: "Requests and follow-up actions",
        value: "Enrichment actions arrive in later milestones.",
      },
      {
        label: "Editing and review tools",
        value: "Editing workflows stay deferred to later milestones.",
      },
    ],
  },
];

export function ChannelDetailShell({ channelId }: ChannelDetailShellProps) {
  return (
    <div className="channel-detail-shell">
      <Link className="channel-detail-shell__back-link" href="/catalog">
        Back to catalog
      </Link>

      <section aria-labelledby="channel-detail-shell-overview-heading" className="channel-detail-shell__intro">
        <div className="channel-detail-shell__intro-copy">
          <h2 id="channel-detail-shell-overview-heading">Week 1 detail scaffold</h2>
          <p>
            This Week 1 shell is intentionally static. Live channel data lands in Week 2. Enrichment and editing
            workflows stay deferred to later milestones.
          </p>
        </div>

        <dl className="channel-detail-shell__route-meta">
          <div>
            <dt>Catalog record ID</dt>
            <dd>
              <code>{channelId}</code>
            </dd>
          </div>
        </dl>
      </section>

      <div className="channel-detail-shell__grid">
        {PLACEHOLDER_SECTIONS.map((section) => (
          <section
            key={section.id}
            aria-labelledby={`${section.id}-heading`}
            className="channel-detail-shell__panel"
          >
            <header>
              <h2 id={`${section.id}-heading`}>{section.title}</h2>
              <p>{section.description}</p>
            </header>

            <dl className="channel-detail-shell__details">
              {section.fields.map((field) => (
                <div key={field.label}>
                  <dt>{field.label}</dt>
                  <dd>{field.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
