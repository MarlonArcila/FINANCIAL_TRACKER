export function LoadingScreen({ label = "Cargando…" }: { label?: string }) {
  return (
    <main className="center-screen" aria-busy="true">
      <div className="spinner" aria-hidden="true" />
      <p>{label}</p>
    </main>
  );
}
