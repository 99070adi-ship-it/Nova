interface Props {
  title: string;
  phase: string;
}

export default function PlaceholderPage({ title, phase }: Props) {
  return (
    <div>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-neutral-500">Built in {phase}.</p>
    </div>
  );
}
