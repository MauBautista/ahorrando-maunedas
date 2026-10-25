import { Link } from 'react-router';
import { useMe } from '../auth/useSession';

/** W-02: the greeting and the big actions of Inicio (05 §5 S-02); the lists arrive with T-162. */
export function HomePage() {
  const { data } = useMe();
  const name = data?.user.display_name.split(' ')[0] ?? '';
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-display">Hola, {name}</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Link to="/compras/nueva" className="action">
          Nueva compra
        </Link>
        <Link to="/compras/nueva?ticket=1" className="action">
          Foto de ticket
        </Link>
        <Link to="/anaquel/nuevo" className="action">
          Precio de anaquel
        </Link>
        <Link to="/catalogo" className="action">
          Catálogo
        </Link>
      </div>
    </section>
  );
}
