interface Props {
  configuration: Record<string, unknown>;
}

export default function BrandStory({ configuration }: Props) {
  const heading = configuration.heading as string | undefined;
  const body = configuration.body as string | undefined;

  if (!heading && !body) return null;

  return (
    <section className="mx-auto max-w-2xl px-6 py-16 text-center">
      {heading && <h2 className="text-2xl font-semibold">{heading}</h2>}
      {body && <p className="mt-4 text-neutral-600">{body}</p>}
    </section>
  );
}
