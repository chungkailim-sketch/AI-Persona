import { describe, expect, it } from 'vitest';
import { marketsMentioned } from '@/roundtable/selection';

const MARKETS = ['Indonesia', 'Germany', 'Saudi Arabia', 'United States', 'Brazil'];

describe('markets a roundtable question names', () => {
  it('finds a market by name or demonym', () => {
    expect(marketsMentioned('How big is the luxury industry in Indonesia?', MARKETS)).toEqual(['Indonesia']);
    expect(marketsMentioned('Would Indonesian shoppers buy a Chinese luxury brand?', MARKETS)).toEqual(['Indonesia']);
    expect(marketsMentioned('Compare German and Brazilian attitudes to premium beauty', MARKETS)).toEqual(['Germany', 'Brazil']);
    expect(marketsMentioned('Which categories would Saudi consumers try?', MARKETS)).toEqual(['Saudi Arabia']);
    expect(marketsMentioned('What do American buyers think?', MARKETS)).toEqual(['United States']);
  });

  it('names nothing for a general question, and does not match inside other words', () => {
    expect(marketsMentioned('In the next year, which categories would you try a Chinese brand in?', MARKETS)).toEqual([]);
    expect(marketsMentioned('Is the brand German-engineered or merely Germane?', ['Germany'])).toEqual(['Germany']);
    expect(marketsMentioned('Brazilnut snacks', ['Brazil'])).toEqual([]);
  });
});
