import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

// Screens are lazy chunks: the first one of a file loads slowly while every suite runs at once (findBy*, waitFor).
configure({ asyncUtilTimeout: 5000 });
