type RouteScaffoldListProps = Readonly<{
  heading: string;
  paths: readonly string[];
}>;

export function RouteScaffoldList({ heading, paths }: RouteScaffoldListProps) {
  if (paths.length === 0) {
    return null;
  }

  return (
    <section className="route-scaffold" aria-label={heading}>
      <h2 className="route-scaffold__title">{heading}</h2>
      <ul className="route-scaffold__list">
        {paths.map((path) => (
          <li key={path}>
            <code>{path}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}
