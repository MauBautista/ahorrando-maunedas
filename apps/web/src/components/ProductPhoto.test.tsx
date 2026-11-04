import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProductPhoto } from './ProductPhoto';

const image = {
  image_id: 'i',
  thumb_url: 'https://x/thumb.webp',
  processed_url: 'https://x/processed.webp',
  original_url: 'https://x/original.jpg',
  license: null,
  attribution: null,
  updated_at: 1,
  enhance_pending: false,
  adopt: null,
  background: '#FFFFFF',
};

describe('ProductPhoto (10 §1)', () => {
  it('uses the thumbnail in lists and the processed photo big, falling back to the original', () => {
    expect(render(<ProductPhoto image={image} name="Leche" />).container.querySelector('img')!.src).toBe(
      'https://x/thumb.webp',
    );
    expect(
      render(<ProductPhoto image={image} name="Leche" large />).container.querySelector('img')!.src,
    ).toBe('https://x/processed.webp');
    const onlyOriginal = { ...image, thumb_url: null, processed_url: null };
    expect(
      render(<ProductPhoto image={onlyOriginal} name="Leche" />).container.querySelector('img')!.src,
    ).toBe('https://x/original.jpg');
  });

  it("shows a photo without background on its edit's color", () => {
    const img = render(
      <ProductPhoto image={{ ...image, background: '#000000' }} name="Leche" large />,
    ).container.querySelector('img')!;
    expect(img.style.backgroundColor).toBe('rgb(0, 0, 0)');
    expect(
      render(<ProductPhoto image={image} name="Leche" />).container.querySelector('img')!.style
        .backgroundColor,
    ).toBe('rgb(255, 255, 255)');
  });

  it('shows the initial without a photo or when it cannot load', () => {
    expect(render(<ProductPhoto image={null} name="leche" />).container.textContent).toBe('L');
    const { container } = render(<ProductPhoto image={image} name="queso" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.textContent).toBe('Q');
  });
});
