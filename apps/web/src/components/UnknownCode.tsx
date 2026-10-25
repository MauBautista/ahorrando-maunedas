import { Link } from 'react-router';

/** A scanned code that is not in the catalog: S-13 and S-05 do not create products, so it points to the editor. */
export function UnknownCode({ code }: { code: string }) {
  return (
    <p role="status" className="text-on-surface-variant">
      El código {code} no está en tu catálogo.{' '}
      <Link to={`/productos/nuevo?codigo=${code}`} className="font-medium text-primary underline">
        Darlo de alta
      </Link>
    </p>
  );
}
