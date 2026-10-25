/** A screen whose task is still ahead (T-161 to T-166). */
export function ComingSoon({ title }: { title: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h1 className="text-title">{title}</h1>
      <p className="text-on-surface-variant">Esta pantalla llega pronto.</p>
    </section>
  );
}
