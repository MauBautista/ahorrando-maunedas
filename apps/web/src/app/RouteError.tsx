/** A page that failed to load or render: the way back is reloading. */
export function RouteError() {
  return (
    <div role="alert" className="grid min-h-dvh place-content-center gap-4 p-4 text-center">
      <p>Algo salió mal al abrir esta pantalla.</p>
      <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
        Recargar
      </button>
    </div>
  );
}
