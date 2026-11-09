import Image from 'next/image';

/** Honest, user-approved placeholder; not a photo or a loading indicator. */
export function CatalogImage() {
  return (
    <span className="catalog-image">
      <Image src="/images/item-placeholder.svg" width={320} height={180} alt="" unoptimized />
      <span className="catalog-image-label">Foto belum tersedia</span>
    </span>
  );
}
