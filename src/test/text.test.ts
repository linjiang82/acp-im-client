import { describe, it, expect } from 'vitest';
import { splitText } from '../utils/text.js';

describe('splitText', () => {
  it('should not split short text', () => {
    const text = 'Hello world';
    expect(splitText(text, 20)).toEqual(['Hello world']);
  });

  it('should split long text', () => {
    const text = '1234567890';
    expect(splitText(text, 5)).toEqual(['12345', '67890']);
  });

  it('should split at newline if possible', () => {
    const text = 'Hello\nworld';
    expect(splitText(text, 8)).toEqual(['Hello', 'world']);
  });

  it('should split at max length if no newline found', () => {
    const text = 'Helloworld';
    expect(splitText(text, 5)).toEqual(['Hello', 'world']);
  });
});
