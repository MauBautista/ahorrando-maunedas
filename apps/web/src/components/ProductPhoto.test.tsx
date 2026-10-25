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

  it('shows the initial without a photo or when it cannot load', () => {
    expect(render(<ProductPhoto image={null} name="leche" />).container.textContent).toBe('L');
    const { container } = render(<ProductPhoto image={image} name="queso" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.textContent).toBe('Q');
  });
});
